import { supabase } from '@/lib/supabase'
import { enqueueOp as enqueueSqliteOp } from '@/lib/db'
import { processOutboxOnce } from '@/lib/offline/posSync'

// Lightweight offline queue: rely on SQLite outbox as the single source of truth
// We keep minimal in-memory id generation; persistence happens only in SQLite.

export type QueueOp =
  | {
      id: string
      type: 'create'
      createdAt: number
      payload: {
        tableId: string | null
        items: Array<{ productId: string; name: string; price: number; quantity: number; modifiers?: string[]; note?: string }>
        totals: { subtotal: number; tax: number; total: number }
        guest: { isGuest: boolean | null; name: string | null }
      }
    }
  | {
      id: string
      type: 'edit'
      createdAt: number
      payload: {
        orderId: string
        tableId: string | null
        items: Array<{ productId: string; name: string; price: number; quantity: number; modifiers?: string[]; note?: string }>
        totals: { subtotal: number; tax: number; total: number }
        guest: { isGuest: boolean | null; name: string | null }
      }
    }
  | {
      id: string
      type: 'cancel'
      createdAt: number
      payload: { orderId: string }
    }
  | {
      id: string
      type: 'pay'
      createdAt: number
      payload: {
        orderId: string
        method: 'cash' | 'telebirr' | 'bank' | 'split'
        guest: { isGuest: boolean; name: string | null }
      }
    }

async function load(): Promise<QueueOp[]> { return [] }
async function save(_list: QueueOp[]) { /* no-op */ }

export async function enqueue(op: QueueOp) {
  // Directly enqueue to SQLite outbox for durability
  try { await enqueueSqliteOp(op.type, op.payload) } catch {}
}

export function newId() {
  // Simple id
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function isOnline(): Promise<boolean> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error) return false
    // attempt a lightweight ping
    await supabase.from('orders').select('id').limit(1)
    return !!user
  } catch {
    return false
  }
}

export async function processQueue() { return processOutboxOnce() }

async function withProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No auth')
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, branch_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.branch_id) throw new Error('No branch')
  return { user, profile }
}

function toItemsPayload(items: QueueOp extends infer T ? T extends { payload: { items: infer U } } ? U : never : never) {
  const rows = (items as any[]).map((it) => {
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
  return rows
}

async function performCreate(op: Extract<QueueOp, { type: 'create' }>) {
  const { profile } = await withProfile()
  const payload = op.payload
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      branch_id: (profile as any).branch_id,
      staff_id: (profile as any).id,
      table_id: payload.tableId,
      status: 'pending',
      total_amount: payload.totals.total,
      tax_amount: payload.totals.tax,
      discount_amount: 0,
      payment_status: 'unpaid',
      is_guest: payload.guest.isGuest || null,
      customer_name: payload.guest.isGuest && payload.guest.name ? payload.guest.name.trim() : null,
    })
    .select('id')
    .single()
  if (orderError || !order) throw orderError
  const rows = toItemsPayload(payload.items)
  const { error: itemsError } = await supabase.from('order_items').insert(rows.map((r) => ({ ...r, order_id: order.id })))
  if (itemsError) throw itemsError

  try {
    const productIds = Array.from(new Set(payload.items.map((i) => i.productId)))
    if (productIds.length > 0) {
      const { data: recipeRows, error: recipeError } = await supabase
        .from('recipes')
        .select('product_id, inventory_item_id, quantity_required, yield_loss_percentage')
        .in('product_id', productIds)
      if (!recipeError && recipeRows && recipeRows.length > 0) {
        const inventoryIds = Array.from(new Set(recipeRows.map((r: any) => r.inventory_item_id as string)))
        const { data: inventoryItems, error: inventoryError } = await supabase
          .from('inventory_items')
          .select('id, current_stock')
          .in('id', inventoryIds)
        if (!inventoryError && inventoryItems) {
          const quantityByInventory = new Map<string, number>()
          payload.items.forEach((orderItem) => {
            const recipesForProduct = recipeRows.filter((r: any) => r.product_id === orderItem.productId)
            recipesForProduct.forEach((r: any) => {
              const baseQty = Number(r.quantity_required ?? 0) * orderItem.quantity
              const yieldLoss = Number(r.yield_loss_percentage ?? 0)
              const factor = 1 + yieldLoss / 100
              const totalQty = baseQty * factor
              if (totalQty <= 0) return
              const key = r.inventory_item_id as string
              const existing = quantityByInventory.get(key) ?? 0
              quantityByInventory.set(key, existing + totalQty)
            })
          })
          const stockMovementsPayload: any[] = []
          for (const [inventoryItemId, totalQty] of quantityByInventory.entries()) {
            stockMovementsPayload.push({
              inventory_item_id: inventoryItemId,
              branch_id: (profile as any).branch_id,
              movement_type: 'out',
              quantity: totalQty,
              reason: 'Sale deduction',
              related_order_id: order.id,
              created_by: (profile as any).id,
            })
          }
          if (stockMovementsPayload.length > 0) {
            const { error: movementError } = await supabase.from('stock_movements').insert(stockMovementsPayload)
            if (!movementError) {
              for (const inv of inventoryItems as any[]) {
                const key = inv.id as string
                const deduct = quantityByInventory.get(key) ?? 0
                if (deduct <= 0) continue
                const current = Number(inv.current_stock ?? 0)
                const next = current - deduct
                const { error: updateError } = await supabase
                  .from('inventory_items')
                  .update({ current_stock: next })
                  .eq('id', key)
                  .eq('branch_id', (profile as any).branch_id)
                if (updateError) {
                  console.warn('Inventory update failed for', key, updateError?.message)
                  break
                }
              }
            }
          }
        }
      }
    }
  } catch {}
}

async function performPay(op: Extract<QueueOp, { type: 'pay' }>) {
  const { profile, user } = await withProfile()
  const p = op.payload
  // Update order payment
  let upErr: any = null
  try {
    const { error } = await supabase
      .from('orders')
      .update({ payment_status: 'paid', payment_method: p.method })
      .eq('id', p.orderId)
    upErr = error
  } catch (e: any) { upErr = e }
  if (upErr) {
    const msg = String(upErr?.message ?? '')
    const enumInvalid = /invalid\s+input\s+value\s+for\s+enum/i.test(msg)
    const columnMissing = /(column\s+payment_method|does not exist|unknown column|42703)/i.test(msg)
    if (enumInvalid || columnMissing) {
      const { error: fallbackErr } = await supabase
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('id', p.orderId)
      if (fallbackErr) throw fallbackErr
    } else {
      throw upErr
    }
  }

  // Audit log
  try {
    await supabase.from('order_change_logs').insert({
      order_id: p.orderId,
      branch_id: (profile as any).branch_id,
      staff_id: (user as any)?.id,
      previous_items: [],
      new_items: [],
      reason: `payment:${p.method}`,
    })
  } catch {}

  // Optional guest record
  try {
    if (p.guest?.isGuest) {
      await supabase.from('guest_visits').insert({
        guest_id: null,
        branch_id: (profile as any).branch_id,
        order_id: p.orderId,
        amount_consumed: null,
        is_paid_by_guest: true,
        covered_by_org: false,
      })
    }
  } catch {}

  // Free table(s)
  try {
    const { data: ord } = await supabase
      .from('orders')
      .select('table_id')
      .eq('id', p.orderId)
      .maybeSingle()
    const baseId = (ord as any)?.table_id as string | null
    const { data: extras } = await supabase
      .from('order_tables')
      .select('table_id')
      .eq('order_id', p.orderId)
    const ids = Array.from(new Set([baseId, ...((extras ?? []).map((r: any) => r.table_id as string))].filter(Boolean))) as string[]
    if (ids.length > 0) {
      await supabase.from('tables').update({ status: 'available' }).in('id', ids)
    }
  } catch {}
}

async function performEdit(op: Extract<QueueOp, { type: 'edit' }>) {
  const { profile } = await withProfile()
  const p = op.payload

  // Log previous/new
  let prevForLog: Array<{ name: string; quantity: number; modifiers: string[] }> = []
  try {
    const { data: prevRows } = await supabase
      .from('order_items')
      .select('quantity, modifiers, products(name)')
      .eq('order_id', p.orderId)
    prevForLog = (prevRows ?? []).map((r: any) => ({
      name: (r?.products?.name as string) ?? 'Item',
      quantity: Number(r?.quantity ?? 0),
      modifiers: ((r?.modifiers as string[]) ?? []).filter(Boolean),
    }))
  } catch {}
  const newForLog = p.items.map((it) => ({ name: it.name, quantity: it.quantity, modifiers: (it.modifiers ?? []).filter(Boolean) }))
  await supabase.from('order_change_logs').insert({
    order_id: p.orderId,
    branch_id: (profile as any).branch_id,
    staff_id: (profile as any).id,
    previous_items: prevForLog,
    new_items: newForLog,
    reason: 'edit',
  })

  // Update header and replace items
  const { error: updErr } = await supabase
    .from('orders')
    .update({
      table_id: p.tableId,
      total_amount: p.totals.total,
      tax_amount: p.totals.tax,
      discount_amount: 0,
      is_guest: p.guest.isGuest || null,
      customer_name: p.guest.isGuest && p.guest.name ? p.guest.name.trim() : null,
    })
    .eq('id', p.orderId)
  if (updErr) throw updErr

  const { error: delErr } = await supabase.from('order_items').delete().eq('order_id', p.orderId)
  if (delErr) throw delErr
  const rows = toItemsPayload(p.items)
  const { error: insErr } = await supabase.from('order_items').insert(rows.map((r) => ({ ...r, order_id: p.orderId })))
  if (insErr) throw insErr

  // Inventory delta: compare previous vs new quantities per product and adjust stock
  try {
    // Build product deltas
    const prevQty = new Map<string, number>()
    try {
      const { data: prevRows } = await supabase
        .from('order_items')
        .select('product_id, quantity')
        .eq('order_id', p.orderId)
      ;(prevRows ?? []).forEach((r: any) => prevQty.set(r.product_id as string, Number(r.quantity ?? 0)))
    } catch {}
    const nextQty = new Map<string, number>()
    p.items.forEach((it) => nextQty.set(it.productId, (nextQty.get(it.productId) ?? 0) + it.quantity))
    const productIds = Array.from(new Set([...prevQty.keys(), ...nextQty.keys()]))
    if (productIds.length > 0) {
      const { data: recipeRows } = await supabase
        .from('recipes')
        .select('product_id, inventory_item_id, quantity_required, yield_loss_percentage')
        .in('product_id', productIds)
      if (recipeRows && recipeRows.length > 0) {
        const inventoryIds = Array.from(new Set(recipeRows.map((r: any) => r.inventory_item_id as string)))
        const { data: inventoryItems } = await supabase
          .from('inventory_items')
          .select('id, current_stock')
          .in('id', inventoryIds)
        const deltaByInventory = new Map<string, number>()
        for (const pid of productIds) {
          const before = prevQty.get(pid) ?? 0
          const after = nextQty.get(pid) ?? 0
          const diff = after - before // positive => extra consumption, negative => restock
          if (diff === 0) continue
          const rowsForProduct = recipeRows.filter((r: any) => r.product_id === pid)
          rowsForProduct.forEach((r: any) => {
            const base = Number(r.quantity_required ?? 0) * Math.abs(diff)
            const loss = Number(r.yield_loss_percentage ?? 0)
            const qty = base * (1 + loss / 100)
            if (qty <= 0) return
            const key = r.inventory_item_id as string
            const existing = deltaByInventory.get(key) ?? 0
            deltaByInventory.set(key, existing + (diff > 0 ? -qty : qty))
          })
        }
        // Write movements and update stock
        const movements: any[] = []
        for (const [invId, dQty] of deltaByInventory.entries()) {
          if (dQty === 0) continue
          movements.push({
            inventory_item_id: invId,
            branch_id: (profile as any).branch_id,
            movement_type: dQty < 0 ? 'out' : 'in',
            quantity: Math.abs(dQty),
            reason: 'Order edit adjustment',
            related_order_id: p.orderId,
            created_by: (profile as any).id,
          })
        }
        if (movements.length > 0) {
          await supabase.from('stock_movements').insert(movements)
          if (inventoryItems) {
            for (const inv of inventoryItems as any[]) {
              const key = inv.id as string
              const d = deltaByInventory.get(key) ?? 0
              if (d === 0) continue
              const next = Number(inv.current_stock ?? 0) + d
              await supabase
                .from('inventory_items')
                .update({ current_stock: next })
                .eq('id', key)
                .eq('branch_id', (profile as any).branch_id)
            }
          }
        }
      }
    }
  } catch {}
}

async function performCancel(op: Extract<QueueOp, { type: 'cancel' }>) {
  const { profile, user } = await withProfile()
  const o = op.payload
  const { error: upErr } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', o.orderId)
  if (upErr) throw upErr
  // log
  try {
    const { data: items } = await supabase.from('order_items').select('quantity, modifiers, products(name)').eq('order_id', o.orderId)
    const prevForLog = (items ?? []).map((it: any) => ({
      name: it?.products?.name ?? 'Item',
      quantity: Number(it?.quantity ?? 0),
      modifiers: ((it?.modifiers as string[] | null) ?? []).filter(Boolean),
    }))
    await supabase.from('order_change_logs').insert({
      order_id: o.orderId,
      branch_id: (profile as any).branch_id,
      staff_id: user.id,
      previous_items: prevForLog,
      new_items: [],
      reason: 'cancel',
    })
  } catch {}

  // Restock consumed inventory for this order
  try {
    const { data: rows } = await supabase
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', o.orderId)
    const productIds = Array.from(new Set((rows ?? []).map((r: any) => r.product_id as string)))
    if (productIds.length > 0) {
      const { data: recipeRows } = await supabase
        .from('recipes')
        .select('product_id, inventory_item_id, quantity_required, yield_loss_percentage')
        .in('product_id', productIds)
      if (recipeRows && recipeRows.length > 0) {
        const inventoryIds = Array.from(new Set(recipeRows.map((r: any) => r.inventory_item_id as string)))
        const { data: inventoryItems } = await supabase
          .from('inventory_items')
          .select('id, current_stock')
          .in('id', inventoryIds)
        const restockByInventory = new Map<string, number>()
        ;(rows ?? []).forEach((r: any) => {
          const qty = Number(r.quantity ?? 0)
          const rr = recipeRows.filter((x: any) => x.product_id === r.product_id)
          rr.forEach((x: any) => {
            const base = Number(x.quantity_required ?? 0) * qty
            const loss = Number(x.yield_loss_percentage ?? 0)
            const total = base * (1 + loss / 100)
            const key = x.inventory_item_id as string
            restockByInventory.set(key, (restockByInventory.get(key) ?? 0) + total)
          })
        })
        const movements: any[] = []
        for (const [invId, qty] of restockByInventory.entries()) {
          if (qty <= 0) continue
          movements.push({
            inventory_item_id: invId,
            branch_id: (profile as any).branch_id,
            movement_type: 'in',
            quantity: qty,
            reason: 'Order cancelled (restock)',
            related_order_id: o.orderId,
            created_by: (profile as any).id,
          })
        }
        if (movements.length > 0) {
          await supabase.from('stock_movements').insert(movements)
          if (inventoryItems) {
            for (const inv of inventoryItems as any[]) {
              const key = inv.id as string
              const qty = restockByInventory.get(key) ?? 0
              if (qty <= 0) continue
              const next = Number(inv.current_stock ?? 0) + qty
              await supabase
                .from('inventory_items')
                .update({ current_stock: next })
                .eq('id', key)
                .eq('branch_id', (profile as any).branch_id)
            }
          }
        }
      }
    }
  } catch {}
}
