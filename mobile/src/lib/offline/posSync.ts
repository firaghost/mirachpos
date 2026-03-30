import { supabase } from '@/lib/supabase'
import { upsertProducts, upsertTables, upsertOrdersIndex, enqueueOp, getOutboxBatch, bumpOutboxTryCount, markOutboxProcessed } from '@/lib/db'

async function isOnline(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { error } = await supabase.from('profiles').select('id').limit(1)
    return !error
  } catch {
    return false
  }
}

export async function downsyncBranchData(branchId: string) {
  // Products
  try {
    const { data } = await supabase
      .from('products')
      .select('id, name, price, category, image_url, updated_at')
      .eq('branch_id', branchId)
      .eq('is_available', true)
      .order('name', { ascending: true })
    const rows = (data ?? []).map((p: any) => ({
      id: String(p.id),
      name: String(p.name || 'Item'),
      price: Number(p.price ?? 0),
      category_id: (p.category as string | null) ?? null,
      image_url: (p.image_url as string | null) ?? null,
      updated_at: (p.updated_at as string | null) ?? null,
    }))
    if (rows.length) await upsertProducts(rows)
  } catch {}
  // Tables
  try {
    const { data } = await supabase
      .from('tables')
      .select('id, name, status')
      .eq('branch_id', branchId)
    const rows = (data ?? []).map((t: any) => ({ id: String(t.id), branch_id: branchId, name: String(t.name || 'Table'), status: (t.status as string | null) ?? null }))
    if (rows.length) await upsertTables(rows)
  } catch {}
  // Recent unpaid orders index for PaymentScreen offline list
  try {
    const { data } = await supabase
      .from('orders')
      .select('id, status, payment_status, total_amount, created_at, table_id')
      .eq('branch_id', branchId)
      .neq('payment_status', 'paid')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(150)
    const rows = (data ?? []).map((o: any) => ({
      id: String(o.id),
      branch_id: branchId,
      table_id: (o.table_id as string | null) ?? null,
      status: (o.status as string | null) ?? null,
      payment_status: (o.payment_status as string | null) ?? null,
      total: Number(o.total_amount ?? 0),
      created_at: String(o.created_at || new Date().toISOString()),
    }))
    if (rows.length) await upsertOrdersIndex(rows)
  } catch {}
}

export async function processOutboxOnce() {
  const online = await isOnline()
  if (!online) return { processed: 0 }
  const batch = await getOutboxBatch(25)
  let processed = 0
  for (const row of batch) {
    const { id, op } = row
    let payload: any
    try { payload = JSON.parse(row.payload) } catch { payload = null }
    try {
      if (op === 'create') {
        await performCreate(payload)
      } else if (op === 'edit') {
        await performEdit(payload)
      } else if (op === 'cancel') {
        await performCancel(payload)
      } else if (op === 'pay') {
        await performPay(payload)
      }
      await markOutboxProcessed(id)
      processed++
    } catch (e) {
      await bumpOutboxTryCount(id)
      break
    }
  }
  return { processed }
}

async function withProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No auth')
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, branch_id, organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.branch_id) throw new Error('No branch')
  return { user, profile }
}

function toItemsPayload(items: Array<{ productId: string; name: string; price: number; quantity: number; modifiers?: string[]; note?: string }>) {
  return items.map((it) => {
    const mods = [...(it.modifiers ?? [])]
    if ((it.note ?? '').trim().length > 0) mods.push(`note:${(it.note ?? '').trim()}`)
    return {
      product_id: it.productId,
      quantity: it.quantity,
      unit_price: it.price,
      total_price: it.price * it.quantity,
      modifiers: mods,
      status: 'pending' as const,
    }
  })
}

async function performCreate(p: any) {
  const { profile } = await withProfile()
  const { data: shift } = await supabase
    .from('shifts')
    .select('id')
    .eq('branch_id', (profile as any).branch_id)
    .eq('status', 'OPEN')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      branch_id: (profile as any).branch_id,
      staff_id: (profile as any).id,
      table_id: p.tableId,
      shift_id: shift?.id || null,
      status: 'pending',
      total_amount: p.totals.total,
      tax_amount: p.totals.tax,
      discount_amount: 0,
      payment_status: 'unpaid',
      is_guest: p.guest?.isGuest || null,
      customer_name: p.guest?.isGuest && p.guest?.name ? p.guest.name.trim() : null,
    })
    .select('id')
    .single()
  if (orderError || !order) throw orderError
  const rows = toItemsPayload(p.items)
  const { error: itemsError } = await supabase.from('order_items').insert(rows.map((r) => ({ ...r, order_id: order.id })))
  if (itemsError) throw itemsError
}

async function performEdit(p: any) {
  const { profile } = await withProfile()
  const { error: updErr } = await supabase
    .from('orders')
    .update({
      table_id: p.tableId,
      total_amount: p.totals.total,
      tax_amount: p.totals.tax,
      discount_amount: 0,
      is_guest: p.guest?.isGuest || null,
      customer_name: p.guest?.isGuest && p.guest?.name ? p.guest.name.trim() : null,
    })
    .eq('id', p.orderId)
  if (updErr) throw updErr
  const { error: delErr } = await supabase.from('order_items').delete().eq('order_id', p.orderId)
  if (delErr) throw delErr
  const rows = toItemsPayload(p.items)
  const { error: insErr } = await supabase.from('order_items').insert(rows.map((r) => ({ ...r, order_id: p.orderId })))
  if (insErr) throw insErr
}

async function performCancel(p: any) {
  const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', p.orderId)
  if (error) throw error
}

async function performPay(p: any) {
  let upErr: any = null
  try {
    const { error } = await supabase.from('orders').update({ payment_status: 'paid', payment_method: p.method }).eq('id', p.orderId)
    upErr = error
  } catch (e: any) { upErr = e }
  if (upErr) {
    const msg = String(upErr?.message ?? '')
    if (/(payment_method|42703|enum)/i.test(msg)) {
      const { error } = await supabase.from('orders').update({ payment_status: 'paid' }).eq('id', p.orderId)
      if (error) throw error
    } else {
      throw upErr
    }
  }
}
