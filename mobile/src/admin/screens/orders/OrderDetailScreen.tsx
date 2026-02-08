import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native'
import { useRoute, useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function OrderDetailScreen() {
  const route = useRoute<any>()
  const nav = useNavigation<any>()
  const orderParam: any = (route.params as any)?.order || null
  const orderId = String(route.params?.orderId || route.params?.id || orderParam?.id || '')
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [header, setHeader] = useState<any>(null)
  const [items, setItems] = useState<Array<{ name: string; qty: number; price: number }>>([])
  const [staffName, setStaffName] = useState<string>('')
  const [collectorName, setCollectorName] = useState<string>('')
  const [tableName, setTableName] = useState<string>('')
  const [timeline, setTimeline] = useState<Array<{ when: string; reason: string }>>([])
  const [approveBusy, setApproveBusy] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id
        let branchId: string | null = orderParam?.branch_id ?? null
        if (!branchId && uid) {
          const { data: prof } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle()
          branchId = (prof as any)?.branch_id ?? null
        }

        // Show what we have immediately
        if (orderParam) setHeader(orderParam)

        // Fetch order; scope by branch when we have it, fallback to id-only
        let ordResp: any = null
        if (branchId) {
          const { data } = await supabase
            .from('orders')
            .select('id, status, total_amount, discount_amount, tax_amount, created_at, staff_id, table_id, payment_method, order_type, branch_id, collected_by')
            .eq('id', orderId)
            .eq('branch_id', branchId)
            .maybeSingle()
          ordResp = data
        }
        if (!ordResp) {
          const { data } = await supabase
            .from('orders')
            .select('id, status, total_amount, discount_amount, tax_amount, created_at, staff_id, table_id, payment_method, order_type, branch_id, collected_by')
            .eq('id', orderId)
            .maybeSingle()
          ordResp = data
        }

        const ord = ordResp
        // If we don't have any header at all (no route order and no DB row), show error
        if (!ord && !orderParam) {
          setHeader(null)
          setError('Order not found')
          setLoading(false)
          return
        }

        // Prefer fresh DB row, otherwise keep the route order
        if (ord) setHeader(ord)

        const { data: its } = await supabase
          .from('order_items')
          .select('product_id, quantity, unit_price, total_price, products(name)')
          .eq('order_id', orderId)
        const mapped = (its ?? []).map((r: any) => ({
          name: (r?.products?.name as string) || (r?.product_id as string) || 'Item',
          qty: Number(r?.quantity ?? 0),
          price: Number(r?.total_price ?? (Number(r?.unit_price ?? 0) * Number(r?.quantity ?? 0))),
        }))
        setItems(mapped)

        const headerNow: any = ord || orderParam
        if ((headerNow as any)?.staff_id) {
          const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', (headerNow as any).staff_id).maybeSingle()
          setStaffName(((prof as any)?.full_name as string) || '')
        }
        if ((headerNow as any)?.collected_by) {
          const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', (headerNow as any).collected_by).maybeSingle()
          setCollectorName(((prof as any)?.full_name as string) || String((headerNow as any)?.collected_by))
        }
        if ((headerNow as any)?.table_id) {
          const { data: tbl } = await supabase.from('tables').select('name').eq('id', (headerNow as any).table_id).maybeSingle()
          setTableName(((tbl as any)?.name as string) || '')
        }

        // Timeline / events from change logs (if table exists)
        try {
          const { data: logs } = await supabase
            .from('order_change_logs')
            .select('created_at, reason')
            .eq('order_id', orderId)
            .order('created_at', { ascending: false })
          const ev = (logs ?? []).map((r: any) => ({
            when: new Date(r.created_at as string).toLocaleString(),
            reason: String(r.reason || '').replace(/_/g, ' '),
          }))
          setTimeline(ev)
        } catch {}
      } catch (e: any) {
        setError(e?.message || 'Failed to load order')
      } finally {
        setLoading(false)
      }
    })()
  }, [orderId])

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: AdminColors.bg },
    headerBar: { height: 50, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: AdminColors.border },
    title: { color: AdminColors.text, fontWeight: '800' },
    link: { color: AdminColors.accent, fontWeight: '600' },
    card: { backgroundColor: AdminColors.card, borderRadius: 14, borderWidth: 1, borderColor: AdminColors.border, padding: 12, marginBottom: 12 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    label: { color: AdminColors.subtext, fontSize: 12 },
    value: { color: AdminColors.text, fontSize: 14, fontWeight: '700' },
    sectionTitle: { color: AdminColors.text, fontWeight: '700', marginBottom: 6, marginTop: 6, paddingHorizontal: 2 },
    sub: { color: AdminColors.subtext, fontSize: 12 },
    error: { color: AdminColors.danger },
  }), [isDark, insets.top, insets.bottom])

  if (loading) return <View style={styles.center}><ActivityIndicator color={AdminColors.accent} /></View>
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
  if (!header) return <View style={styles.center}><Text style={styles.sub}>Order not found{orderId ? ` (#${orderId.slice(0,6)})` : ''}</Text></View>

  const status = String(header.status || '-')
  const total = Number(header.total_amount ?? 0)
  const discount = Number(header.discount_amount ?? 0)
  const tax = Number(header.tax_amount ?? 0)
  const created = header.created_at ? new Date(header.created_at as string).toLocaleString() : ''
  const payment = String(header.payment_method || '-').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
  const isTakeaway = !header.table_id || String(header.order_type || '').toLowerCase() === 'takeaway'

  const staffDisplay = staffName || (header?.staff_id ? `#${String(header.staff_id).slice(0,6)}` : '-')
  const subtotalFromItems = items.reduce((s, it) => s + Number(it.price || 0), 0)
  const subtotalBase = total - tax + discount
  const subtotal = subtotalFromItems > 0 ? subtotalFromItems : subtotalBase
  const taxDerived = Math.max(0, total - (subtotal - discount))
  const shownTax = (tax && tax > 0) ? tax : taxDerived

  // Approvals placeholders: show buttons if a void or discount request is present in timeline
  const hasVoidReq = timeline.some((t) => /void\s*request/i.test(t.reason))
  const hasDiscReq = timeline.some((t) => /discount\s*request/i.test(t.reason))

  const approveVoid = async () => {
    try {
      setApproveBusy(true)
      // Try update to voided; on failure gracefully log approval only
      let upErr: any = null
      try { const { error } = await supabase.from('orders').update({ status: 'voided' as any }).eq('id', orderId); upErr = error } catch (e: any) { upErr = e }
      await supabase.from('order_change_logs').insert({ order_id: orderId, reason: 'void_approved', previous_items: [], new_items: [] })
      if (!upErr) { nav.goBack() }
    } finally { setApproveBusy(false) }
  }
  const rejectVoid = async () => {
    try { setApproveBusy(true); await supabase.from('order_change_logs').insert({ order_id: orderId, reason: 'void_rejected', previous_items: [], new_items: [] }); nav.goBack() } finally { setApproveBusy(false) }
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={styles.link}>Back</Text></TouchableOpacity>
        <Text style={styles.title}>Order #{String(header.id).slice(0,6)}</Text>
        {isTakeaway ? (
          <View style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: AdminColors.accent, borderRadius: 999 }}>
            <Text style={{ color: '#1a1a1a', fontWeight: '800', fontSize: 12 }}>Takeaway</Text>
          </View>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <View style={styles.card}> 
          <View style={styles.row}><Text style={styles.label}>Status</Text><Text style={styles.value}>{status}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Table</Text><Text style={styles.value}>{isTakeaway ? 'Takeaway' : (tableName || header.table_id || '-')}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Waiter</Text><Text style={styles.value}>{staffDisplay}</Text></View>
          {!!collectorName && (<View style={styles.row}><Text style={styles.label}>Collected by</Text><Text style={styles.value}>{collectorName}</Text></View>)}
          <View style={styles.row}><Text style={styles.label}>Payment</Text><Text style={styles.value}>{payment}</Text></View>
          {!!created && (<View style={styles.row}><Text style={styles.label}>Created</Text><Text style={styles.value}>{created}</Text></View>)}
        </View>

        <Text style={styles.sectionTitle}>Items</Text>
        <View style={styles.card}> 
          {items.length === 0 ? (
            <Text style={styles.sub}>No items</Text>
          ) : (
            items.map((it, idx) => (
              <View key={idx} style={[styles.row, { paddingVertical: 8 }]}> 
                <Text style={[styles.value, { flex: 1 }]}>{it.name}</Text>
                <Text style={[styles.sub, { width: 40, textAlign: 'center' }]}>x{it.qty}</Text>
                <Text style={[styles.value, { width: 90, textAlign: 'right' }]}>{it.price.toFixed(2)} ETB</Text>
              </View>
            ))
          )}
        </View>

        {(hasVoidReq || hasDiscReq) && (
          <View>
            <Text style={styles.sectionTitle}>Approvals</Text>
            <View style={styles.card}>
              {hasVoidReq && (
                <View style={[styles.row, { gap: 12 }]}> 
                  <Text style={styles.value}>Void request</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity onPress={approveVoid} disabled={approveBusy}><Text style={[styles.link, { opacity: approveBusy ? 0.6 : 1 }]}>Approve</Text></TouchableOpacity>
                    <TouchableOpacity onPress={rejectVoid} disabled={approveBusy}><Text style={[styles.link, { opacity: approveBusy ? 0.6 : 1 }]}>Reject</Text></TouchableOpacity>
                  </View>
                </View>
              )}
              {hasDiscReq && (
                <Text style={styles.sub}>Discount request — approval flow coming soon</Text>
              )}
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>Totals</Text>
        <View style={styles.card}> 
          <View style={styles.row}><Text style={styles.label}>Subtotal</Text><Text style={styles.value}>{subtotal.toFixed(2)} ETB</Text></View>
          <View style={styles.row}><Text style={styles.label}>Tax</Text><Text style={styles.value}>{shownTax.toFixed(2)} ETB</Text></View>
          <View style={styles.row}><Text style={styles.label}>Discount</Text><Text style={styles.value}>-{discount.toFixed(2)} ETB</Text></View>
          <View style={[styles.row, { marginTop: 6 }]}><Text style={[styles.label, { fontWeight: '700' }]}>Total</Text><Text style={[styles.value, { fontWeight: '800' }]}>{total.toFixed(2)} ETB</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Timeline</Text>
        <View style={styles.card}>
          {timeline.length === 0 ? (
            <Text style={styles.sub}>No events</Text>
          ) : (
            timeline.map((ev, idx) => (
              <View key={idx} style={styles.row}> 
                <Text style={[styles.sub, { flex: 1 }]}>{ev.when}</Text>
                <Text style={styles.value}>{ev.reason}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  )
}
