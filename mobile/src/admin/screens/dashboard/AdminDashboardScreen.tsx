import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { AdminColors } from '../../theme/colors'
import { useAppTheme } from '../../../theme/ThemeProvider'
import * as SecureStore from 'expo-secure-store'
import { useResponsive } from '@/hooks/useResponsive'

// Lightweight utils
function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d }
function endOfToday() { const d = new Date(); d.setHours(23,59,59,999); return d }
const fmtCurrency = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'ETB', maximumFractionDigits: 2 }).format(n) } catch { return `ETB ${n.toFixed(2)}` }
}
const fmtNumber = (n: number) => new Intl.NumberFormat(undefined).format(n)

// Fetch branch and today data
async function fetchDashboard() {
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return { branchId: null, branchName: null, orders: [], logs: [], staffers: [] as Array<{ id: string; full_name: string }> }
  const { data: profile } = await supabase
    .from('profiles')
    .select('branch_id')
    .eq('id', uid)
    .maybeSingle()
  let branchId = (profile as any)?.branch_id ?? null
  try {
    const override = await SecureStore.getItemAsync('admin_active_branch_id')
    if (override && override.length > 0) branchId = override
  } catch {}
  const from = startOfToday().toISOString()
  const to = endOfToday().toISOString()
  if (!branchId) return { branchId: null, branchName: null, orders: [], logs: [], staffers: [] as Array<{ id: string; full_name: string }> }

  const { data: orders } = await supabase
    .from('orders')
    .select('id, status, total_amount, discount_amount, payment_status, payment_method, created_at, staff_id, is_guest, collected_by')
    .eq('branch_id', branchId)
    .gte('created_at', from)
    .lte('created_at', to)

  const { data: logs } = await supabase
    .from('order_change_logs')
    .select('created_at, reason, order_id, staff_id')
    .eq('branch_id', branchId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false })

  const orderStaff = ((orders ?? []) as any[]).map(o => o?.staff_id).filter(Boolean)
  const logsStaff = ((logs ?? []) as any[]).map((r: any) => r?.staff_id).filter(Boolean)
  const ids = Array.from(new Set([ ...orderStaff, ...logsStaff ])) as string[]
  const { data: staffersDirect } = ids.length > 0
    ? await supabase.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] as any[] }
  const { data: staffersBranch } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('branch_id', branchId)
    .limit(200)
  const toPair = (s: any) => [String(s.id), s] as [string, any]
  const pairsDirect = ((staffersDirect ?? []) as any[]).map(toPair)
  const pairsBranch = ((staffersBranch ?? []) as any[]).map(toPair)
  const staffersMap = new Map<string, any>([...pairsDirect, ...pairsBranch])
  const staffers = Array.from(staffersMap.values())
  const displayName = (s: any) => (s?.full_name as string) || ''
  const staffMap = Object.fromEntries(Array.from(staffersMap.values()).map((s: any) => [String(s.id), displayName(s) || String(s.id)]))

  // Branch name
  const { data: branchRow } = await supabase
    .from('branches')
    .select('name')
    .eq('id', branchId)
    .maybeSingle()
  const branchName = (branchRow as any)?.name ?? branchId

  return { branchId, branchName, orders: orders ?? [], logs: logs ?? [], staffers, staffMap }
}

export function AdminDashboardScreen() {
  useAppTheme()
  const insets = useSafeAreaInsets()
  const { data, isLoading, refetch, isRefetching } = useQuery({ queryKey: ['admin_dashboard_today'], queryFn: fetchDashboard, refetchInterval: 15000 })
  const [refreshing, setRefreshing] = useState(false)
  const { spacing, font, maxContentWidth } = useResponsive()

  // Top waiter label (name) resolved independently to avoid UID fallbacks elsewhere
  const [topWaiterName, setTopWaiterName] = useState<string>('—')

  const staffName = useMemo(() => {
    const map = new Map<string, string>(Object.entries((data as any)?.staffMap ?? {}))
    ;((data?.staffers ?? []) as any[]).forEach((s: any) => {
      if (!map.has(String(s.id))) map.set(String(s.id), (s?.full_name as string) || String(s.id))
    })
    return (id?: string | null) => (id ? (map.get(String(id)) || String(id)) : '—')
  }, [data?.staffMap, data?.staffers])

  // Helpers
  const netOf = (o: any) => Number(o.total_amount ?? 0) - Number(o.discount_amount ?? 0)
  const effectiveOrders = useMemo(() => (data?.orders ?? []).filter((o: any) => String(o.status || '').toLowerCase() !== 'cancelled'), [data?.orders])
  const allOrders = useMemo(() => (data?.orders ?? []) as any[], [data?.orders])
  const isCanceled = (o: any) => {
    const s = String(o.status || '').toLowerCase()
    return s === 'cancelled' || s === 'canceled' || s === 'void' || s === 'voided' || s === 'refunded'
  }

  // Payments derived from logs (handles split partials)
  const paymentRows = useMemo(() => {
    const rows: Array<{ time: string; orderId: string; method: string; amount: number; staff: string; reference?: string | null } > = []
    const byId = new Map<string, any>()
    ;(effectiveOrders as any[]).forEach(o => byId.set(o.id, o))
    for (const r of (data?.logs ?? []) as any[]) {
      const reason = String(r.reason || '')
      const ord = byId.get(r.order_id)
      if (!ord || ord.is_guest) continue
      if (reason.startsWith('payment-partial:')) {
        const parts = reason.split(':')
        const method = parts[1] || 'cash'
        const amt = parseFloat(parts[2] || '0')
        const ref = (parts[3] && parts[3].length > 0) ? parts[3] : null
        rows.push({ time: new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), orderId: r.order_id, method, amount: Number.isFinite(amt) ? amt : 0, staff: staffName((ord as any).collected_by || r.staff_id), reference: ref })
      } else if (reason.startsWith('payment:split:close')) {
        // ignore
      } else if (reason.startsWith('payment:')) {
        const parts = reason.split(':')
        const method = parts[1] || 'cash'
        const ref = (parts[2] && parts[2].length > 0) ? parts[2] : null
        rows.push({ time: new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), orderId: r.order_id, method, amount: netOf(ord), staff: staffName((ord as any).collected_by || r.staff_id), reference: ref })
      }
    }
    return rows
  }, [data?.logs, effectiveOrders, staffName])

  // Aggregates
  // Completed orders only for sales (exclude pending/preparing/etc.)
  const completedOrders = useMemo(() => (allOrders as any[]).filter(o => String(o.status || '').toLowerCase() === 'completed'), [allOrders])
  const completedGross = useMemo(() => (completedOrders as any[]).reduce((s, o) => s + Number(o.total_amount || 0), 0), [completedOrders])
  const orderNetSales = useMemo(() => (completedOrders as any[]).reduce((s, o) => s + netOf(o), 0), [completedOrders])
  // Net sales (paid only) by order.payment_status
  const paidOrders = useMemo(() => (allOrders as any[]).filter(o => String((o as any).payment_status || '').toLowerCase() === 'paid'), [allOrders])
  const orderNetPaid = useMemo(() => (paidOrders as any[]).reduce((s, o) => s + netOf(o), 0), [paidOrders])
  // Split guest vs normal (completed only to align with sales)
  const guestOrders = useMemo(() => (completedOrders as any[]).filter(o => !!(o as any).is_guest), [completedOrders])
  const normalOrders = useMemo(() => (completedOrders as any[]).filter(o => !(o as any).is_guest), [completedOrders])
  const guestNet = useMemo(() => (guestOrders as any[]).reduce((s, o) => s + netOf(o), 0), [guestOrders])
  const normalNet = useMemo(() => (normalOrders as any[]).reduce((s, o) => s + netOf(o), 0), [normalOrders])
  // Canceled breakdown (for display only; not included in sales)
  const canceledOrders = useMemo(() => (allOrders as any[]).filter((o) => isCanceled(o)), [allOrders])
  const canceledCount = useMemo(() => canceledOrders.length, [canceledOrders])
  const canceledGross = useMemo(() => (canceledOrders as any[]).reduce((s, o) => s + Number(o.total_amount || 0), 0), [canceledOrders])
  // Collected payments (may lag behind orders)
  const netSales = useMemo(() => paymentRows.reduce((s, r) => s + Number(r.amount || 0), 0), [paymentRows])
  const byMethod = useMemo(() => {
    const agg = new Map<string, number>()
    for (const r of paymentRows) agg.set(r.method, (agg.get(r.method) ?? 0) + Number(r.amount || 0))
    return Array.from(agg.entries()).sort((a,b) => b[1] - a[1])
  }, [paymentRows])
  const byStaff = useMemo(() => {
    const agg = new Map<string, number>()
    for (const r of paymentRows) agg.set(r.staff, (agg.get(r.staff) ?? 0) + Number(r.amount || 0))
    return Array.from(agg.entries()).sort((a,b) => b[1] - a[1])
  }, [paymentRows])
  const ordersCount = useMemo(() => (completedOrders as any[]).length, [completedOrders])
  const cashPaymentsCount = useMemo(() => paymentRows.filter(r => String(r.method).toLowerCase() === 'cash').length, [paymentRows])
  useEffect(() => {
    (async () => {
      try {
        const counts = new Map<string, number>()
        ;(completedOrders as any[]).forEach((o: any) => {
          const sid = String(o?.staff_id || '')
          if (!sid) return
          counts.set(sid, (counts.get(sid) ?? 0) + 1)
        })
        let bestId: string | null = null
        let best = -1
        counts.forEach((v, k) => { if (v > best) { best = v; bestId = k } })
        if (!bestId) { setTopWaiterName('—'); return }
        const local = ((data?.staffers ?? []) as any[]).find((p: any) => String(p.id) === String(bestId))
        const localName = (local?.full_name as string | undefined)
        if (localName && localName.trim().length > 0) { setTopWaiterName(localName); return }
        // Fallback: fetch profile name directly
        const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', bestId).maybeSingle()
        const nm = ((prof as any)?.full_name as string | undefined) || String(bestId)
        setTopWaiterName(nm)
      } catch {
        setTopWaiterName('—')
      }
    })()
  }, [completedOrders, data?.staffers])

  // Alerts
  const alerts = useMemo(() => {
    const list: string[] = []
    // frequent cancels/edits
    const cancelsBy = new Map<string, number>()
    const editsBy = new Map<string, number>()
    for (const r of (data?.logs ?? []) as any[]) {
      const reason = String(r.reason || '')
      if (reason === 'cancel') cancelsBy.set(r.staff_id, (cancelsBy.get(r.staff_id) ?? 0) + 1)
      if (reason === 'edit') editsBy.set(r.staff_id, (editsBy.get(r.staff_id) ?? 0) + 1)
    }
    cancelsBy.forEach((v, k) => { if (v >= 3) list.push(`${staffName(k)} cancelled ${v} orders today — unusual, please review.`) })
    editsBy.forEach((v, k) => { if (v >= 5) list.push(`${staffName(k)} edited ${v} orders today — check for mistakes or abuse.`) })
    // high discounts
    for (const o of effectiveOrders as any[]) {
      const total = Number(o.total_amount ?? 0)
      const disc = Number(o.discount_amount ?? 0)
      if (total > 0 && (disc / total) >= 0.3) list.push(`High discount of ${Math.round((disc/total)*100)}% on order #${String(o.id).slice(0,6)} — verify approval.`)
    }
    // out-of-hours payments
    for (const r of paymentRows) {
      const h = (() => { try { return parseInt(r.time.split(':')[0], 10) } catch { return 12 } })()
      if (h < 6 || h > 23) list.push(`Payment at ${r.time} by ${r.staff} — outside usual hours.`)
    }
    return list
  }, [data?.logs, effectiveOrders, paymentRows, staffName])

  const onRefresh = async () => {
    setRefreshing(true)
    try { await refetch() } finally { setRefreshing(false) }
  }

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8), alignItems: 'center' },
    header: { paddingHorizontal: Math.round(spacing.sm), paddingBottom: Math.round(spacing.xs), width: '100%', maxWidth: maxContentWidth },
    title: { color: AdminColors.text, fontSize: font.h2, fontWeight: '800' },
    section: { marginHorizontal: Math.round(spacing.sm), marginTop: Math.round(spacing.sm), backgroundColor: AdminColors.card, borderRadius: Math.max(10, Math.round(spacing.sm)), borderWidth: 1, borderColor: AdminColors.border, padding: Math.round(spacing.sm) },
    sectionTitle: { color: AdminColors.text, fontWeight: '700', marginBottom: Math.round(spacing.xs), fontSize: font.body },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Math.round(spacing.xs) },
    label: { color: AdminColors.subtext, fontSize: font.small },
    value: { color: AdminColors.text, fontSize: font.body, fontWeight: '700' },
    sub: { color: AdminColors.subtext, fontSize: font.small },
    divider: { height: 1, backgroundColor: AdminColors.border, marginVertical: Math.round(spacing.xs) },
    empty: { color: AdminColors.subtext, fontSize: font.small },
    // Summary grid
    summary: { marginHorizontal: Math.round(spacing.sm), marginTop: Math.round(spacing.sm) },
    summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Math.round(spacing.xs) },
    summaryCard: { flexGrow: 1, flexBasis: '48%', backgroundColor: AdminColors.card, borderRadius: Math.max(10, Math.round(spacing.sm)), borderWidth: 1, borderColor: AdminColors.border, paddingVertical: Math.round(spacing.xs + 6), paddingHorizontal: Math.round(spacing.sm) },
    summaryLabel: { color: AdminColors.subtext, fontSize: font.small },
    summaryValue: { color: AdminColors.text, fontSize: font.h3, fontWeight: '800', marginTop: 4 },
  }), [insets.top, insets.bottom, spacing, font, maxContentWidth])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.sub}>Today · {data?.branchName ? `Branch ${data.branchName}` : 'Branch -'}</Text>
      </View>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing || isRefetching} onRefresh={onRefresh} tintColor={AdminColors.accent} />} contentContainerStyle={{ width: '100%', alignSelf: 'center', maxWidth: maxContentWidth }}>
        {/* Summary */}
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Sales (completed · gross)</Text>
              <Text style={styles.summaryValue}>{fmtCurrency(completedGross)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Completed orders</Text>
              <Text style={styles.summaryValue}>{fmtNumber(ordersCount)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Cash payments</Text>
              <Text style={styles.summaryValue}>{fmtNumber(cashPaymentsCount)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Top waiter</Text>
              <Text style={styles.summaryValue}>{topWaiterName}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily sales</Text>
          <View style={styles.row}><Text style={styles.label}>Order gross (completed)</Text><Text style={styles.value}>{fmtCurrency(completedGross)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Order net (completed)</Text><Text style={styles.value}>{fmtCurrency(orderNetSales)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Net sales (paid only)</Text><Text style={styles.value}>{fmtCurrency(orderNetPaid)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Collected payments</Text><Text style={styles.value}>{fmtCurrency(netSales)}</Text></View>
          <View style={styles.divider} />
          <Text style={styles.label}>Canceled orders</Text>
          <View style={styles.row}><Text style={styles.value}>Count</Text><Text style={styles.value}>{fmtNumber(canceledCount)}</Text></View>
          <View style={styles.row}><Text style={styles.value}>Gross</Text><Text style={styles.value}>{fmtCurrency(canceledGross)}</Text></View>
          <View style={styles.divider} />
          <Text style={styles.label}>By customer type</Text>
          <View style={styles.row}><Text style={styles.value}>Regular</Text><Text style={styles.value}>{fmtCurrency(normalNet)}</Text></View>
          <View style={styles.row}><Text style={styles.value}>Guest</Text><Text style={styles.value}>{fmtCurrency(guestNet)}</Text></View>
          <View style={styles.divider} />
          <Text style={styles.label}>By payment method</Text>
          {byMethod.length === 0 ? (
            <Text style={styles.empty}>No payments yet</Text>
          ) : byMethod.map(([m, amt]) => (
            <View key={m} style={styles.row}><Text style={styles.value}>{m}</Text><Text style={styles.value}>{fmtCurrency(amt)}</Text></View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Waiter collections</Text>
          {byStaff.length === 0 ? (
            <Text style={styles.empty}>No collections yet</Text>
          ) : byStaff.map(([name, amt]) => (
            <View key={name} style={styles.row}><Text style={styles.value}>{name}</Text><Text style={styles.value}>{fmtCurrency(amt)}</Text></View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Manual confirmations</Text>
          {(paymentRows.length === 0) ? (
            <Text style={styles.empty}>No confirmations yet</Text>
          ) : paymentRows.slice(0, 12).map((r, idx) => (
            <View key={idx} style={styles.row}>
              <Text style={styles.label}>{r.time} · {r.method} · #{r.orderId.slice(0,6)}{r.reference ? ` · ${r.reference}` : ''}</Text>
              <Text style={styles.value}>{fmtCurrency(r.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suspicious activity</Text>
          {alerts.length === 0 ? (
            <Text style={styles.empty}>No flags today</Text>
          ) : alerts.map((a, i) => (
            <View key={i} style={{ paddingVertical: 4 }}>
              <Text style={styles.label}>• {a}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
