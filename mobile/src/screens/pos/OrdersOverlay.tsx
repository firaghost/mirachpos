import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl, ActivityIndicator, ScrollView, Dimensions, TouchableWithoutFeedback, TextInput } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { getUnpaidOrdersLocal, getOrderItemsLocal, upsertOrderItems } from '@/lib/db'
import { enqueue, newId } from '@/lib/offlineQueue'
import { useUiStore } from '@/state/uiStore'
import { useMobileOrderStore } from '@/state/orderStore'
import { ConfirmSheet } from '@/components/ui/confirm-sheet'
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'

export interface OrdersOverlayProps {
  visible: boolean
  onClose: () => void
}

type OrderRow = {
  id: string
  status: string
  total_amount: number
  created_at: string
  table_id: string | null
  customer_name?: string | null
  is_guest?: boolean | null
  staff_id?: string | null
}

async function fetchOrders(): Promise<OrderRow[]> {
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) {
    const local = await getUnpaidOrdersLocal(null, null)
    return (local ?? []).map((o) => ({ id: o.id, status: (o.status as any) || 'pending', total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null })) as any
  }
  const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', user.id).maybeSingle()
  const branchId = profile?.branch_id
  if (!branchId) {
    const local = await getUnpaidOrdersLocal(null, user.id as any)
    return (local ?? []).map((o) => ({ id: o.id, status: (o.status as any) || 'pending', total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null })) as any
  }
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, status, total_amount, created_at, table_id, customer_name, is_guest, staff_id, payment_status')
      .eq('branch_id', branchId)
      .eq('staff_id', user.id as any)
      .order('created_at', { ascending: false })
      .limit(150)
    if (error) throw error
    return (data ?? []) as OrderRow[]
  } catch {
    const local = await getUnpaidOrdersLocal(branchId as any, user.id as any)
    return (local ?? []).map((o) => ({ id: o.id, status: (o.status as any) || 'pending', total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null })) as any
  }
}

async function fetchOrderItems(orderId: string) {
  try {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, product_id, quantity, unit_price, total_price, modifiers, products(name)')
      .eq('order_id', orderId)
    if (error) throw error
    const rows = (data ?? []) as Array<{
      id: string
      product_id: string
      quantity: number
      unit_price: number
      total_price: number
      modifiers?: string[] | null
      products?: { name?: string | null } | null
    }>
    try {
      await upsertOrderItems(rows.map((r: any) => ({ id: String(r.id), order_id: orderId, product_id: String(r.product_id), qty: Number(r.quantity ?? 0), price: Number(r.unit_price ?? 0), total: Number(r.total_price ?? 0), note: null })))
    } catch {}
    return rows
  } catch {
    const rows = await getOrderItemsLocal(orderId)
    return rows.map((r) => ({ id: r.id, product_id: r.product_id, quantity: Number(r.qty ?? 0), unit_price: Number(r.price ?? 0), total_price: Number(r.total ?? 0), modifiers: [], products: { name: r.product_id } }))
  }
}

export function OrdersOverlay({ visible, onClose }: OrdersOverlayProps) {
  useAppTheme()
  const [selected, setSelected] = useState<OrderRow | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchOrderItems>>>([])
  const [branchId, setBranchId] = useState<string | null>(null)
  const { data: orders, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 10000,
  })
  const [myId, setMyId] = useState<string | null>(null)
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map())
  const [tableNames, setTableNames] = useState<Map<string, string>>(new Map())
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'preparing' | 'takeaway' | 'completed' | 'cancelled'>('all')
  const [timeFilter, setTimeFilter] = useState<'today' | 'past'>('today')

  // Realtime: auto-refresh when orders change in my branch
  useEffect(() => {
    let ch: any = null
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', user.id).maybeSingle()
        const bid = (profile as any)?.branch_id as string | null
        if (!bid) return
        ch = supabase
          .channel('mobile_orders_overlay_auto')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${bid}` }, async () => {
            try { await refetch() } catch {}
          })
          .subscribe()
      } catch {}
    })()
    return () => { try { if (ch) supabase.removeChannel(ch) } catch {} }
  }, [refetch])
  const focusOrderId = useUiStore((s) => s.focusOrderId)
  const closeOrders = useUiStore((s) => s.closeOrders)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const setEditingOrder = useUiStore((s) => s.setEditingOrder)
  const requestFinalizeOpen = useUiStore((s) => s.requestFinalizeOpen)

  const replaceItems = useMobileOrderStore((s) => s.replaceItems)
  const setTable = useMobileOrderStore((s) => s.setTable)
  const setIsGuest = useMobileOrderStore((s) => s.setIsGuest)
  const setGuestName = useMobileOrderStore((s) => s.setGuestName)
  const setCartNote = useMobileOrderStore((s) => s.setCartNote)
  const setCouponCode = useMobileOrderStore((s) => s.setCouponCode)

  const [cancelling, setCancelling] = useState(false)
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<OrderRow | null>(null)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [savingCancel, setSavingCancel] = useState(false)
  const [orderExtras, setOrderExtras] = useState<{ instructions?: string | null; discount_amount?: number | null; tax_amount?: number | null }>({})

  const openOrder = async (o: OrderRow) => {
    setSelected(o)
    setItems([])
    setItemsError(null)
    setItemsLoading(true)
    try {
      const data = await fetchOrderItems(o.id)
      setItems(data)
      try {
        const { data: hdr } = await supabase
          .from('orders')
          .select('instructions, discount_amount, tax_amount')
          .eq('id', o.id)
          .maybeSingle()
        setOrderExtras({
          instructions: (hdr as any)?.instructions ?? null,
          discount_amount: (hdr as any)?.discount_amount ?? null,
          tax_amount: (hdr as any)?.tax_amount ?? null,
        })
      } catch {}
    } catch (e: any) {
      setItemsError(e?.message ?? 'Failed to load items')
    } finally {
      setItemsLoading(false)
    }
  }

  const beginCancelWithReason = (o: OrderRow) => {
    setCancelTarget(o)
    setCancelReason('')
    setReasonOpen(true)
  }

  const confirmCancelWithReason = async () => {
    const o = cancelTarget
    if (!o) { setReasonOpen(false); return }
    try {
      setSavingCancel(true)
      // 1) Update order status; attempt to save reason to orders.cancel_reason if exists
      try {
        const { error: upErr } = await supabase.from('orders').update({ status: 'cancelled', cancel_reason: cancelReason }).eq('id', o.id)
        if (upErr) {
          const msg = String(upErr?.message || '')
          if (/(cancel_reason|column|does not exist|unknown column|42703)/i.test(msg)) {
            const { error: up2 } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', o.id)
            if (up2) throw up2
          } else {
            throw upErr
          }
        }
      } catch (e: any) { throw e }

      // 2) Audit log
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id ?? null
        let bId: string | null = null
        if (uid) {
          const { data: prof } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle()
          bId = (prof as any)?.branch_id ?? null
        }
        await supabase.from('order_change_logs').insert({
          order_id: o.id,
          branch_id: bId,
          staff_id: uid,
          previous_items: (items ?? []).map((it: any) => ({ name: it?.products?.name ?? it.product_id, quantity: it.quantity, modifiers: ((it.modifiers as string[] | null) ?? []).filter(Boolean) })),
          new_items: [],
          reason: cancelReason || 'cancel',
        })
      } catch {}

      // 3) Free tables
      try {
        const baseId = o.table_id as string | null
        const { data: extras } = await supabase.from('order_tables').select('table_id').eq('order_id', o.id)
        const ids = Array.from(new Set([baseId, ...((extras ?? []).map((r: any) => r.table_id as string))].filter(Boolean))) as string[]
        if (ids.length > 0) await supabase.from('tables').update({ status: 'available' }).in('id', ids)
      } catch {}

      setSelected(null)
      await refetch()
    } finally {
      setSavingCancel(false)
      setReasonOpen(false)
      setCancelTarget(null)
      setCancelReason('')
    }
  }

  const width = Math.min(420, Math.round(Dimensions.get('window').width * 0.9))
  const insets = useSafeAreaInsets()

  const focusApplied = useRef<string | null>(null)
  useEffect(() => {
    if (!visible) return
    if (!focusOrderId) return
    if (focusApplied.current === focusOrderId) return
    const o = (orders ?? []).find((x) => x.id === focusOrderId)
    if (o) {
      setSelected(o)
      focusApplied.current = focusOrderId
    }
  }, [visible, focusOrderId, orders])
  useEffect(() => {
    if (!visible) {
      focusApplied.current = null
      setSelected(null)
    }
  }, [visible])

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id ?? null
        setMyId(uid)
        if (uid) {
          const { data: prof } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle()
          setBranchId((prof as any)?.branch_id ?? null)
        }
      } catch {}
    })()
  }, [])

  const myOrders = useMemo(() => {
    const all = (orders ?? []) as OrderRow[]
    const mine = myId ? all.filter((o) => o.staff_id === myId) : []
    return [...mine].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 30)
  }, [orders, myId])

  const visibleOrders = useMemo(() => {
    return ((orders ?? []) as OrderRow[])
  }, [orders])

  const filteredOrders = useMemo(() => {
    // status filtering
    const base = statusFilter === 'all'
      ? visibleOrders
      : visibleOrders.filter((o) => (o.status || '').toLowerCase().includes(statusFilter))
    // time filtering (local time)
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (timeFilter === 'today') {
      return base.filter((o) => new Date(o.created_at) >= startOfToday)
    }
    // past
    return base.filter((o) => new Date(o.created_at) < startOfToday)
  }, [visibleOrders, statusFilter, timeFilter])

  const subtotal = useMemo(() => {
    try {
      return (items ?? []).reduce((s: number, it: any) => s + Number(it?.total_price ?? ((it?.unit_price ?? 0) * (it?.quantity ?? 0))), 0)
    } catch { return 0 }
  }, [items])
  const discount = Number(orderExtras?.discount_amount ?? 0) || 0
  const tax = Number(orderExtras?.tax_amount ?? 0) || 0
  const grand = useMemo(() => {
    const fallback = Math.max(0, subtotal - discount + tax)
    return Number.isFinite(Number(selected?.total_amount)) ? Number(selected?.total_amount) : fallback
  }, [selected?.total_amount, subtotal, discount, tax])

  // Live updates when orders change in this branch
  useEffect(() => {
    if (!visible || !branchId) return
    const channel = supabase
      .channel('orders_overlay')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, () => {
        refetch()
      })
      .subscribe()
    return () => { try { supabase.removeChannel(channel) } catch {} }
  }, [visible, branchId, refetch])

  // Pull-to-refresh for both list and detail
  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await refetch()
      if (selected) {
        try {
          setItemsLoading(true)
          const data = await fetchOrderItems(selected.id)
          setItems(data)
        } catch (e: any) {
          setItemsError(e?.message ?? 'Failed to load items')
        } finally {
          setItemsLoading(false)
        }
      }
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const ids = Array.from(new Set(((orders ?? []) as OrderRow[]).map((o) => o.staff_id).filter(Boolean))) as string[]
        if (ids.length === 0) { setStaffNames(new Map()); return }
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        const map = new Map<string, string>()
        ;(profs ?? []).forEach((p: any) => map.set(p.id as string, (p.full_name as string) || p.id))
        setStaffNames(map)
      } catch {}
    })()
  }, [orders])

  // Load table names for the orders in view
  useEffect(() => {
    (async () => {
      try {
        const tids = Array.from(new Set(((orders ?? []) as OrderRow[]).map((o) => o.table_id).filter(Boolean))) as string[]
        if (tids.length === 0) { setTableNames(new Map()); return }
        const { data: trows } = await supabase.from('tables').select('id, name').in('id', tids)
        const map = new Map<string, string>()
        ;(trows ?? []).forEach((t: any) => map.set(t.id as string, (t.name as string) || t.id))
        setTableNames(map)
      } catch {}
    })()
  }, [orders])

  // Helpers: edit/cancel
  const startEdit = async (o: OrderRow) => {
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('product_id, quantity, unit_price, modifiers, products(name)')
      .eq('order_id', o.id)
    const mapped = (itemRows ?? []).map((row: any) => {
      const rawMods = ((row.modifiers as string[] | null) ?? []).filter(Boolean)
      const noteTag = rawMods.find((m) => typeof m === 'string' && m.startsWith('note:')) as string | undefined
      const note = noteTag ? noteTag.slice(5) : ''
      const mods = rawMods.filter((m) => !(typeof m === 'string' && m.startsWith('note:')))
      return {
        id: Math.random().toString(36).slice(2),
        productId: row.product_id as string,
        name: (row.products?.name as string) ?? 'Item',
        price: Number(row.unit_price ?? 0),
        quantity: Number(row.quantity ?? 1),
        modifiers: mods,
        note,
      }
    })
    // Set table context FIRST for dine-in; for takeaway (null table), avoid wiping items
    if (o.table_id) {
      const tname = tableNames.get(o.table_id || '') || null
      setTable(o.table_id, tname)
    }
    replaceItems(mapped as any)
    setIsGuest(Boolean(o.is_guest))
    setGuestName(o.customer_name ?? '')
    // Load header extras (instructions/coupon) best-effort
    try {
      const { data: hdr } = await supabase
        .from('orders')
        .select('instructions, coupon_code')
        .eq('id', o.id)
        .maybeSingle()
      const note = (hdr as any)?.instructions as string | null
      const coupon = (hdr as any)?.coupon_code as string | null
      if (typeof note === 'string') setCartNote(note)
      if (typeof coupon === 'string') setCouponCode(coupon)
    } catch {}
    setActiveTab('POS')
    setEditingOrder(o.id)
    requestFinalizeOpen()
    onClose(); closeOrders()
  }

  const cancelOrder = async (o: OrderRow) => {
    setCancelTarget(o)
    setConfirmCancelOpen(true)
  }
  const markComplete = async (o: OrderRow) => {
    try {
      const { error: upErr } = await supabase.from('orders').update({ status: 'completed' }).eq('id', o.id)
      if (!upErr) await refetch()
    } catch {}
  }

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { onClose(); closeOrders() }}>
      <View style={styles.backdrop}>
        <TouchableWithoutFeedback onPress={() => { onClose(); closeOrders() }}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>
        <View style={[styles.panel, { width, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12), backgroundColor: AdminColors.card }]}>
          <View style={[styles.header, { borderColor: AdminColors.border }]}>
            {selected ? (
              <TouchableOpacity onPress={() => { setReasonOpen(false); setSelected(null) }}>
                <Text style={[styles.link, { color: AdminColors.accent }]}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 40 }} />
            )}
            <Text style={[styles.title, { color: AdminColors.text }]}>Orders list</Text>
            <TouchableOpacity onPress={() => { onClose(); closeOrders() }}><Text style={[styles.link, { color: AdminColors.accent }]}>Close</Text></TouchableOpacity>
          </View>
          {/* Time filter chips */}
          <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={() => setTimeFilter('today')} style={[styles.statusChip, { backgroundColor: timeFilter === 'today' ? AdminColors.accent : 'transparent', borderColor: timeFilter === 'today' ? AdminColors.accent : AdminColors.border }]}>
                <Text style={[styles.statusChipText, { color: timeFilter === 'today' ? '#1a1a1a' : AdminColors.subtext }]}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTimeFilter('past')} style={[styles.statusChip, { backgroundColor: timeFilter === 'past' ? AdminColors.accent : 'transparent', borderColor: timeFilter === 'past' ? AdminColors.accent : AdminColors.border }]}>
                <Text style={[styles.statusChipText, { color: timeFilter === 'past' ? '#1a1a1a' : AdminColors.subtext }]}>Past</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            {selected ? (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                <View style={[styles.tableCard, { borderColor: AdminColors.border, backgroundColor: AdminColors.card }]}>
                  <View style={styles.tableCardHeader}>
                    <View>
                      <Text style={[styles.tableCardTitle, { color: AdminColors.text }]}>
                        {selected.table_id ? `Table ${tableNames.get(selected.table_id || '') || (selected.table_id || '').slice(0, 4)}` : 'Takeaway'}
                      </Text>
                      <Text style={[styles.tableCardTime, { color: AdminColors.subtext }]}>
                        {`Placed ${new Date(selected.created_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                      </Text>
                    </View>
                    <View>
                      {(/cancel/i.test(selected.status || '')) ? (
                        <View style={[styles.pillBtn, { backgroundColor: AdminColors.danger }]}><Text style={[styles.pillBtnText, { color: '#fff' }]}>Canceled</Text></View>
                      ) : (/complete|closed/i.test(selected.status || '')) ? (
                        <View style={[styles.pillBtn, { backgroundColor: AdminColors.surface }]}><Text style={[styles.pillBtnText, { color: AdminColors.text }]}>Completed</Text></View>
                      ) : (
                        <View style={[styles.pillBtn, { backgroundColor: AdminColors.warning }]}><Text style={[styles.pillBtnText, { color: '#1a1a1a' }]}>Active</Text></View>
                      )}
                    </View>
                  </View>
                  <View style={{ marginTop: 6 }}>
                    <Text style={{ color: AdminColors.subtext, fontSize: 12 }}>
                      Order ID: <Text style={{ color: AdminColors.text, fontWeight: '700' }}>{String(selected.id).slice(0, 8)}</Text>
                    </Text>
                    <Text style={{ color: AdminColors.subtext, fontSize: 12 }}>
                      Staff: <Text style={{ color: AdminColors.text, fontWeight: '600' }}>{staffNames.get(selected.staff_id || '') || 'You'}</Text>
                    </Text>
                    <Text style={{ color: AdminColors.subtext, fontSize: 12 }}>
                      Amount: <Text style={{ color: AdminColors.text, fontWeight: '700' }}>{Number(selected.total_amount ?? 0).toFixed(2)}</Text>
                    </Text>
                  </View>
                  <View style={{ marginTop: 12 }}>
                    {(itemsError) ? (
                      <Text style={{ color: '#b91c1c' }}>{itemsError}</Text>
                    ) : itemsLoading ? (
                      <ActivityIndicator />
                    ) : (
                      <>
                        {(items ?? []).map((it: any, idx: number) => (
                          <View key={idx} style={[styles.itemRow, { borderColor: AdminColors.border }]}> 
                            <Text style={{ color: AdminColors.text, fontWeight: '600' }}>{(it?.products?.name as string) || it.product_id}</Text>
                            <Text style={{ color: AdminColors.subtext }}>
                              {(() => {
                                const raw = ((it?.modifiers as string[] | null) ?? []).filter(Boolean) as string[]
                                const noteTag = raw.find((m) => typeof m === 'string' && m.startsWith('note:')) as string | undefined
                                const note = noteTag ? noteTag.slice(5) : ''
                                const mods = raw.filter((m) => !(typeof m === 'string' && m.startsWith('note:')))
                                const base = `x${it.quantity} - ${Number(it.total_price ?? ((it.unit_price ?? 0) * (it.quantity ?? 1))).toFixed(2)}`
                                const modTxt = mods.length ? ` · ${mods.join(', ')}` : ''
                                const noteTxt = note ? ` · Note: ${note}` : ''
                                return `${base}${modTxt}${noteTxt}`
                              })()}
                            </Text>
                          </View>
                        ))}
                      </>
                    )}
                  </View>
                  {/* Order instructions and totals */}
                  {!!orderExtras?.instructions && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={[styles.metaLabel, { color: AdminColors.subtext }]}>Instructions</Text>
                      <Text style={{ color: AdminColors.text }}>{orderExtras.instructions}</Text>
                    </View>
                  )}
                  <View style={{ marginTop: 12, borderTopWidth: 1, borderColor: AdminColors.border, paddingTop: 10 }}>
                    <View style={styles.metaRow}>
                      <Text style={[styles.metaLabel, { color: AdminColors.subtext }]}>Subtotal</Text>
                      <Text style={{ color: AdminColors.text, fontWeight: '700' }}>{subtotal.toFixed(2)}</Text>
                    </View>
                    {discount > 0 ? (
                      <View style={styles.metaRow}>
                        <Text style={[styles.metaLabel, { color: AdminColors.subtext }]}>Discount</Text>
                        <Text style={{ color: AdminColors.text, fontWeight: '700' }}>- {discount.toFixed(2)}</Text>
                      </View>
                    ) : null}
                    {tax > 0 ? (
                      <View style={styles.metaRow}>
                        <Text style={[styles.metaLabel, { color: AdminColors.subtext }]}>Tax</Text>
                        <Text style={{ color: AdminColors.text, fontWeight: '700' }}>{tax.toFixed(2)}</Text>
                      </View>
                    ) : null}
                    <View style={[styles.metaRow, { marginTop: 6 }]}>
                      <Text style={[styles.metaLabel, { color: AdminColors.text, fontWeight: '700' }]}>Total</Text>
                      <Text style={{ color: AdminColors.text, fontWeight: '800' }}>{grand.toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.sticky, { backgroundColor: AdminColors.card, borderTopWidth: 1, borderColor: AdminColors.border, paddingHorizontal: 16, paddingTop: 12 }]}>
                  {/^(pending|preparing|confirmed|takeaway)$/i.test(selected.status || '') ? (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={[styles.pillBtn, { backgroundColor: AdminColors.accent }]} onPress={() => startEdit(selected)}>
                        <Text style={[styles.pillBtnText, { color: '#1a1a1a' }]}>Continue editing</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.pillBtn, { backgroundColor: AdminColors.danger }]} onPress={() => beginCancelWithReason(selected)}>
                        <Text style={[styles.pillBtnText, { color: '#fff' }]}>Cancel order</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (/cancel/i.test(selected.status || '')) ? (
                    <View style={[styles.pillBtn, { backgroundColor: AdminColors.danger }]}><Text style={[styles.pillBtnText, { color: '#fff' }]}>Canceled</Text></View>
                  ) : (
                    <View style={[styles.pillBtn, { backgroundColor: AdminColors.surface }]}><Text style={[styles.pillBtnText, { color: AdminColors.text }]}>Completed</Text></View>
                  )}
                </View>
              </ScrollView>
            ) : isLoading ? (
              <View style={{ padding: 16 }}>
                {[...Array(6)].map((_, i) => (
                  <View key={i} style={styles.skelCard} />
                ))}
              </View>
            ) : (
              <FlatList
                data={filteredOrders}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 16, paddingBottom: 16 }}
                refreshing={refreshing}
                onRefresh={onRefresh}
                renderItem={({ item: o }) => {
                  const time = new Date(o.created_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  const isEditable = /^(pending|preparing|confirmed|takeaway)$/i.test(o.status || '')
                  const label = o.table_id ? `Table ${tableNames.get(o.table_id || '') || (o.table_id || '').slice(0, 4)}` : 'Takeaway'
                  return (
                    <View style={[styles.listRow, { borderColor: AdminColors.border }]}> 
                      <TouchableOpacity style={{ flex: 1 }} onPress={() => openOrder(o)}>
                        <Text style={[styles.listTitle, { color: AdminColors.text }]}>{label}</Text>
                        <Text style={[styles.listSub, { color: AdminColors.subtext }]}>Placed at {time}</Text>
                      </TouchableOpacity>
                      {isEditable ? (
                        <TouchableOpacity style={[styles.pillBtn, { backgroundColor: AdminColors.accent }]} onPress={() => startEdit(o)}>
                          <Text style={[styles.pillBtnText, { color: '#1a1a1a' }]}>Continue editing</Text>
                        </TouchableOpacity>
                      ) : (/cancel/i.test(o.status || '')) ? (
                        <View style={[styles.pillBtn, { backgroundColor: AdminColors.danger }]}>
                          <Text style={[styles.pillBtnText, { color: '#fff' }]}>Canceled</Text>
                        </View>
                      ) : (/complete|closed/i.test(o.status || '')) ? (
                        <View style={[styles.pillBtn, { backgroundColor: AdminColors.surface }]}>
                          <Text style={[styles.pillBtnText, { color: AdminColors.text }]}>Completed</Text>
                        </View>
                      ) : (
                        <TouchableOpacity style={[styles.pillBtn, styles.pillBtnSecondary, { borderColor: AdminColors.border }]} onPress={() => markComplete(o)}>
                          <Text style={[styles.pillBtnText, { color: AdminColors.subtext }]}>Mark complete</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )
                }}
                ListEmptyComponent={<Text style={{ color: AdminColors.subtext }}>No orders</Text>}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>

    <ConfirmSheet
      open={confirmCancelOpen}
      title="Cancel order"
      description="Are you sure you want to cancel this order?"
      confirmLabel={cancelling ? 'Please wait…' : 'Yes, cancel'}
      cancelLabel="No"
      loading={cancelling}
      onOpenChange={setConfirmCancelOpen}
      onConfirm={async () => {
        const o = cancelTarget
        if (!o) { setConfirmCancelOpen(false); return }
        try {
          setCancelling(true)
          const { error: upErr } = await supabase
            .from('orders')
            .update({ status: 'cancelled' })
            .eq('id', o.id)
          if (upErr) throw upErr
          try {
            const { data: { session } } = await supabase.auth.getSession()
            const uid = session?.user?.id
            let branchId: string | null = null
            if (uid) {
              const { data: prof } = await supabase.from('profiles').select('id, branch_id').eq('id', uid).maybeSingle()
              branchId = (prof as any)?.branch_id ?? null
            }
            const prevForLog = (items ?? []).map((it: any) => ({
              name: it?.products?.name ?? it.product_id,
              quantity: it.quantity,
              modifiers: ((it.modifiers as string[] | null) ?? []).filter(Boolean),
            }))
            await supabase.from('order_change_logs').insert({
              order_id: o.id,
              branch_id: branchId,
              staff_id: uid ?? null,
              previous_items: prevForLog,
              new_items: [],
              reason: 'cancel',
            })
          } catch { }
          // Best-effort: free table(s) associated with this order
          try {
            const baseId = o.table_id as string | null
            const { data: extras } = await supabase
              .from('order_tables')
              .select('table_id')
              .eq('order_id', o.id)
            const ids = Array.from(new Set([baseId, ...((extras ?? []).map((r: any) => r.table_id as string))].filter(Boolean))) as string[]
            if (ids.length > 0) {
              await supabase.from('tables').update({ status: 'available' }).in('id', ids)
            }
          } catch {}
          setSelected(null)
          refetch()
        } catch (e: any) {
          const msg = e?.message ?? ''
          const maybeOffline = /network|fetch|timeout|offline/i.test(String(msg))
          if (maybeOffline) {
            try {
              await enqueue({ id: newId(), type: 'cancel', createdAt: Date.now(), payload: { orderId: o.id } })
              setSelected(null)
              refetch()
            } catch {}
          }
        } finally {
          setCancelling(false)
          setConfirmCancelOpen(false)
          setCancelTarget(null)
        }
      }}
    />

    {/* Cancel reason modal */}
    <Modal transparent visible={reasonOpen} animationType="fade" onRequestClose={() => setReasonOpen(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: Math.min(420, Math.round(Dimensions.get('window').width * 0.9)), backgroundColor: AdminColors.card, borderRadius: 12, borderWidth: 1, borderColor: AdminColors.border, padding: 16 }}>
          <Text style={{ fontWeight: '700', color: AdminColors.text, marginBottom: 8 }}>Cancel order</Text>
          <Text style={{ color: AdminColors.subtext, marginBottom: 8 }}>Please enter a reason. This will be recorded for reports and audit log.</Text>
          <TextInput
            placeholder="Reason for cancellation"
            placeholderTextColor={AdminColors.subtext}
            value={cancelReason}
            onChangeText={setCancelReason}
            style={{ borderWidth: 1, borderColor: AdminColors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: AdminColors.text }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <TouchableOpacity onPress={() => setReasonOpen(false)} style={[styles.pillBtn, styles.pillBtnSecondary, { borderColor: AdminColors.border }]}>
              <Text style={[styles.pillBtnText, { color: AdminColors.subtext }]}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={!cancelReason.trim() || savingCancel} onPress={confirmCancelWithReason} style={[styles.pillBtn, styles.pillBtnDanger, (!cancelReason.trim() || savingCancel) ? { opacity: 0.6 } : null]}>
              <Text style={[styles.pillBtnText, { color: '#fff' }]}>{savingCancel ? 'Please wait…' : 'Confirm cancel'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </>
  )
}

function badgeStyle(status: string) {
  switch ((status || '').toLowerCase()) {
    case 'pending':
      return styles.badgePending
    case 'preparing':
    case 'in_progress':
      return styles.badgeInProgress
    case 'takeaway':
    case 'completed':
    case 'closed':
      return styles.badgeDone
    case 'cancelled':
    case 'canceled':
      return styles.badgeDefault
    default:
      return styles.badgeDefault
  }
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'flex-end', justifyContent: 'flex-start' },
  panel: { height: '100%', backgroundColor: '#fff', borderTopLeftRadius: 16, borderBottomLeftRadius: 16, overflow: 'hidden' },
  header: { height: 52, borderBottomWidth: 1, borderColor: '#eee', alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
  title: { fontWeight: '700', color: '#2C1810' },
  link: { color: '#2C1810', fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 12, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#eee', marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#2C1810' },
  cardSub: { fontSize: 12, color: '#666' },
  cardAmt: { fontSize: 14, fontWeight: '700' },
  badge: { marginTop: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', fontSize: 11, color: '#fff', textTransform: 'capitalize' },
  badgePending: { backgroundColor: '#f59e0b' },
  badgeInProgress: { backgroundColor: '#3b82f6' },
  badgeDone: { backgroundColor: '#16a34a' },
  badgeDefault: { backgroundColor: '#6b7280' },
  metaLabel: { fontSize: 12, color: '#666' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#f1f1f1' },
  editBtn: { backgroundColor: '#2C1810', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  editBtnText: { color: '#fff', fontWeight: '700' },
  cancelBtn: { backgroundColor: '#b91c1c', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  cancelBtnText: { color: '#fff', fontWeight: '700' },
  sticky: { backgroundColor: '#fff', paddingBottom: 8 },
  statusChip: { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e0e0e0', height: 32, paddingHorizontal: 10, borderRadius: 16, marginRight: 8, alignItems: 'center', justifyContent: 'center' },
  statusChipActive: { backgroundColor: '#2C1810', borderColor: '#2C1810' },
  statusChipText: { fontSize: 12, color: '#666', fontWeight: '600', textTransform: 'capitalize' },
  statusChipTextActive: { color: '#fff' },
  skelCard: { height: 64, borderRadius: 8, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#eee', marginBottom: 10 },
  tableCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  tableCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tableCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2C1810',
    marginBottom: 4,
  },
  tableCardTime: {
    fontSize: 13,
    color: '#666',
  },
  tableCardButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  tableCardButtonDark: {
    backgroundColor: '#2C1810',
    borderColor: '#2C1810',
  },
  tableCardButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2C1810',
  },
  tableCardButtonTextLight: {
    color: '#fff',
  },
  // New simplified list styles
  
  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1 },
  listTitle: { fontSize: 14, fontWeight: '700' },
  listSub: { fontSize: 12 },
  pillBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillBtnSecondary: { backgroundColor: 'transparent', borderWidth: 1 },
  pillBtnDanger: { backgroundColor: '#b91c1c' },
  pillBtnMuted: { backgroundColor: '#e5e7eb' },
  pillBtnText: { fontSize: 12, fontWeight: '700' },
})
