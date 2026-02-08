import React, { useMemo, useState, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { AdminColors } from '../theme/colors'
import { KpiCard } from '../components/cards/KpiCard'
import { ApexChart } from '../components/charts/ApexChart'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppTheme } from '../../theme/ThemeProvider'
import { registerAndSyncDeviceToken } from '@/lib/notifications'
import { BrandTitle } from '@/components/BrandTitle'
import { useResponsive } from '@/hooks/useResponsive'
import { NotificationsBell } from '@/admin/components/NotificationsBell'

type Range = 'today' | '7d' | '30d'

function windowFor(range: Range) {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)
  if (range === 'today') {
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
  } else if (range === '7d') {
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
  } else {
    start.setDate(now.getDate() - 29)
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
  }
  return { start, end }
}

function useKpis(range: Range) {
  return useQuery({
    queryKey: ['admin_kpis', range],
    queryFn: async () => {
      const { start, end } = windowFor(range)

      // Identify branch
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id || null
      let branchId: string | null = null
      if (uid) {
        const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle()
        branchId = (profile as any)?.branch_id ?? null
      }

      // Orders in window
      let oq = supabase
        .from('orders')
        .select('id, total_amount, status, table_id, created_at')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
      if (branchId) oq = oq.eq('branch_id', branchId)
      const { data: orders } = await oq
      const rows = orders ?? []
      const statusOf = (s?: string | null) => String(s || '').toLowerCase()
      const activeOrders = rows.filter((o: any) => ['pending','preparing','served','confirmed'].includes(statusOf(o.status))).length
      const sales = rows
        .filter((o: any) => statusOf(o.status) === 'completed')
        .reduce((s: number, o: any) => s + Number(o.total_amount ?? 0), 0)

      // Tables status (current)
      let tq = supabase.from('tables').select('status')
      if (branchId) tq = tq.eq('branch_id', branchId)
      const { data: tables } = await tq
      const trows = tables ?? []
      const freeTables = trows.filter((t: any) => String(t?.status || '').toLowerCase() === 'available').length
      const occupiedTables = trows.filter((t: any) => String(t?.status || '').toLowerCase() === 'occupied').length

      // Low stock count (current)
      let iq = supabase.from('inventory_items').select('current_stock, low_stock_threshold')
      if (branchId) iq = iq.eq('branch_id', branchId as any)
      const { data: inv } = await iq
      const lowStock = (inv ?? []).filter((it: any) => {
        const cur = Number(it.current_stock ?? 0)
        const thr = Number(it.low_stock_threshold ?? 0)
        return thr > 0 && cur <= thr
      }).length

      // Offline terminals: last_seen older than 5 minutes or status != 'online'
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      let dq = supabase.from('devices').select('status, last_seen_at')
      if (branchId) dq = dq.eq('branch_id', branchId)
      const { data: devs } = await dq
      const offlineTerminals = (devs ?? []).filter((d: any) => {
        const st = String(d?.status || '')
        const last = d?.last_seen_at ? new Date(d.last_seen_at as string).toISOString() : null
        return st.toLowerCase() !== 'online' || (last && last < fiveMinAgo)
      }).length

      return { sales, activeOrders, freeTables, occupiedTables, lowStock, offlineTerminals }
    },
    refetchInterval: 15000,
  })
}

export function HomeScreen() {
  const [range, setRange] = useState<Range>('today')
  const { data, refetch: refetchKpis, isFetching: isFetchingKpis } = useKpis(range)
  const insets = useSafeAreaInsets()
  const { isDark } = useAppTheme()
  const { spacing, font, maxContentWidth } = useResponsive()

  // Ensure push token is registered when Admin Home mounts (dev/preview/prod builds)
  useEffect(() => {
    ;(async () => { try { await registerAndSyncDeviceToken() } catch {} })()
  }, [])

  // Hourly sales (today)
  const hourly = useQuery({
    queryKey: ['admin_hourly_sales'],
    queryFn: async () => {
      const now = new Date()
      const start = new Date(now); start.setHours(0,0,0,0)
      const end = new Date(now); end.setHours(23,59,59,999)
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id || null
      let branchId: string | null = null
      if (uid) { const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle(); branchId = (profile as any)?.branch_id ?? null }
      let q = supabase.from('orders').select('total_amount, created_at, status')
        .gte('created_at', start.toISOString()).lte('created_at', end.toISOString())
      if (branchId) q = q.eq('branch_id', branchId)
      const { data: rows } = await q
      const buckets: Record<string, number> = {}
      ;(rows ?? []).filter((o:any)=>String(o?.status||'').toLowerCase()==='completed').forEach((o: any) => {
        const d = new Date(o.created_at as string)
        const h = `${d.getHours().toString().padStart(2,'0')}:00`
        buckets[h] = (buckets[h] ?? 0) + Number(o.total_amount ?? 0)
      })
      const labels = Array.from({ length: 24 }).map((_,h)=>`${h.toString().padStart(2,'0')}:00`)
      const data = labels.map((l) => (buckets[l] ?? 0))
      return { categories: labels, series: [{ name: 'Sales', data }] }
    },
    staleTime: 15000,
  })

  // Best sellers (by selected range)
  const best = useQuery({
    queryKey: ['admin_best_sellers', range],
    queryFn: async () => {
      const { start, end } = windowFor(range)
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id || null
      let branchId: string | null = null
      if (uid) { const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle(); branchId = (profile as any)?.branch_id ?? null }
      // Step 1: fetch orders in range (and branch) and filter to completed-like
      let oq = supabase
        .from('orders')
        .select('id, status')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
      if (branchId) oq = oq.eq('branch_id', branchId)
      const { data: orders } = await oq
      const orderIds = (orders ?? [])
        .filter((o:any)=>{
          const s = String(o?.status||'').toLowerCase()
          return s === 'completed' || s === 'paid'
        })
        .map((o: any) => String(o.id))
      if (orderIds.length === 0) return { categories: [], series: [{ name: 'Units', data: [] }] }
      // Step 2: aggregate items by product
      const { data: items } = await supabase
        .from('order_items')
        .select('product_id, quantity, order_id')
        .in('order_id', orderIds)
      // Aggregate
      const map = new Map<string, { name: string; qty: number }>()
      ;(items ?? []).forEach((r: any) => {
        const id = String(r.product_id)
        const prev = map.get(id) || { name: id, qty: 0 }
        map.set(id, { name: prev.name, qty: prev.qty + Number(r.quantity ?? 0) })
      })
      // Resolve names
      const prodIds = Array.from(map.keys())
      if (prodIds.length > 0) {
        const { data: prods } = await supabase.from('products').select('id, name').in('id', prodIds as any)
        const nameById = new Map<string, string>()
        ;(prods ?? []).forEach((p: any) => nameById.set(String(p.id), String(p?.name || p?.id)))
        for (const [id, v] of map) {
          const nm = nameById.get(id)
          if (nm) map.set(id, { name: nm, qty: v.qty })
        }
      }
      const sorted = Array.from(map.entries()).sort((a,b)=>b[1].qty-a[1].qty).slice(0,8)
      const categories = sorted.map(([_,v])=> v.name.length>12 ? v.name.slice(0,11)+'…' : v.name)
      const data = sorted.map(([_,v])=> v.qty)
      return { categories, series: [{ name: 'Units', data }] }
    },
    staleTime: 15000,
  })

  // Weekly Trend (always last 7 days), consistent across filters
  const weekly = useQuery({
    queryKey: ['admin_weekly_sales_fixed'],
    queryFn: async () => {
      const now = new Date()
      const start = new Date(now); start.setDate(now.getDate()-6); start.setHours(0,0,0,0)
      const end = new Date(now); end.setHours(23,59,59,999)
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id || null
      let branchId: string | null = null
      if (uid) { const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle(); branchId = (profile as any)?.branch_id ?? null }
      let q = supabase.from('orders').select('total_amount, discount_amount, created_at, status')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
      if (branchId) q = q.eq('branch_id', branchId)
      const { data: rows } = await q
      const salesByDay: Record<string, number> = {}
      const ordersByDay: Record<string, number> = {}
      // Sales: completed/paid only; Orders: exclude void/cancelled/refunded
      ;(rows ?? []).forEach((o: any) => {
        const d = new Date(o.created_at as string)
        const key = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`
        const status = String(o?.status || '').toLowerCase()
        if (status === 'completed' || status === 'paid') {
          const gross = Number(o.total_amount ?? 0)
          salesByDay[key] = (salesByDay[key] ?? 0) + Math.max(0, gross)
        }
        if (!['void','voided','canceled','cancelled','refunded'].includes(status)) {
          ordersByDay[key] = (ordersByDay[key] ?? 0) + 1
        }
      })
      // Build continuous series across the whole window with zero-fill
      const days = Math.round((end.getTime() - start.getTime()) / (24*3600*1000)) + 1
      const categories: string[] = []
      const sales: number[] = []
      const orders: number[] = []
      for (let i=0; i<days; i++) {
        const d = new Date(start); d.setDate(start.getDate()+i)
        const key = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`
        const label = `${d.toLocaleDateString(undefined,{ weekday:'short'})} ${d.getDate()}`
        categories.push(label)
        sales.push(salesByDay[key] ?? 0)
        orders.push(ordersByDay[key] ?? 0)
      }
      // Fallback: if orders are all zero but there are sales, derive orders by counting sales days
      const ordersAllZero = orders.every((v) => (Number(v||0) === 0))
      const salesAny = sales.some((v) => Number(v||0) > 0)
      if (ordersAllZero && salesAny) {
        for (let i=0; i<orders.length; i++) {
          orders[i] = sales[i] > 0 ? 1 : 0
        }
      }
      return { categories, series: [
        { name: 'Sales', data: sales },
        { name: 'Orders', data: orders },
      ] }
    },
    staleTime: 15000,
  })
  const isFetchingHourly = hourly.isFetching
  const isFetchingBest = best.isFetching
  const isFetchingWeekly = weekly.isFetching
  const refreshing = isFetchingKpis || isFetchingHourly || isFetchingBest || isFetchingWeekly

  const onRefresh = async () => {
    await Promise.all([
      refetchKpis(),
      hourly.refetch(),
      best.refetch(),
      weekly.refetch(),
    ])
  }

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8), alignItems: 'center' },
    inner: { padding: Math.round(spacing.md), width: '100%', maxWidth: maxContentWidth },
    title: { color: AdminColors.text, fontSize: font.h2, fontWeight: '800' },
    subtitle: { color: AdminColors.subtext, marginTop: 4, fontSize: font.small },
    rangeRow: { flexDirection: 'row', marginTop: Math.round(spacing.md), marginBottom: Math.round(spacing.xs), borderRadius: 999, padding: 2, backgroundColor: AdminColors.surface },
    rangeChip: { flex: 1, paddingVertical: Math.round(spacing.xs), borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    rangeChipActive: { backgroundColor: AdminColors.accent },
    rangeText: { color: AdminColors.subtext, fontSize: font.small, fontWeight: '600' },
    rangeTextActive: { color: '#1a1a1a' },
    kpiGrid: { marginTop: Math.round(spacing.md), flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    kpiItem: { width: '48%', marginBottom: Math.round(spacing.sm) },
    section: { marginTop: Math.round(spacing.lg) },
    sectionTitle: { color: AdminColors.text, fontSize: font.body, fontWeight: '700', marginBottom: Math.round(spacing.sm) },
    card: { backgroundColor: AdminColors.card, borderRadius: Math.max(10, Math.round(spacing.sm)), padding: Math.round(spacing.sm), borderWidth: 1, borderColor: AdminColors.border },
    textMuted: { color: AdminColors.subtext, fontSize: font.small },
  }), [isDark, insets.top, insets.bottom, spacing, font, maxContentWidth])

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.inner} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={AdminColors.accent} /> }>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <BrandTitle text="Tium Cafe" align="left" size="lg" style={{ marginBottom: 0 }} />
          <NotificationsBell />
        </View>
        <Text style={[styles.subtitle, { textAlign: "center", marginTop: 0 }]}>Overview</Text>


        <View style={styles.rangeRow}>
          {([
            { key: 'today', label: 'Today' },
            { key: '7d', label: 'Last 7 days' },
            { key: '30d', label: 'Last 30 days' },
          ] as const).map((opt) => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => setRange(opt.key)}
              style={[styles.rangeChip, range === opt.key && styles.rangeChipActive]}
            >
              <Text style={[styles.rangeText, range === opt.key && styles.rangeTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.kpiGrid}>
          <View style={styles.kpiItem}><KpiCard label={`Sales (${range==='today'?'Today':range==='7d'?'7d':'30d'})`} value={`${(data?.sales ?? 0).toFixed(2)} ETB`} /></View>
          <View style={styles.kpiItem}><KpiCard label="Active Orders" value={data?.activeOrders ?? 0} /></View>
          <View style={styles.kpiItem}><KpiCard label="Free Tables" value={data?.freeTables ?? 0} /></View>
          <View style={styles.kpiItem}><KpiCard label="Occupied Tables" value={data?.occupiedTables ?? 0} /></View>
          <View style={styles.kpiItem}><KpiCard label="Low Stock" value={data?.lowStock ?? 0} /></View>
          <View style={styles.kpiItem}><KpiCard label="Offline Terminals" value={data?.offlineTerminals ?? 0} /></View>
        </View>

        {range === 'today' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hourly Sales (Today)</Text>
            <ApexChart type="bar" title="Sales by Hour" categories={hourly.data?.categories ?? []} series={hourly.data?.series ?? []} height={200} maxTicks={6} />
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Best Sellers ({range === 'today' ? 'Today' : range === '7d' ? '7 days' : '30 days'})</Text>
          <ApexChart type="bar" title="Top Products" categories={best.data?.categories ?? []} series={best.data?.series ?? []} height={240} maxTicks={6} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weekly Trend</Text>
          <ApexChart type="area" title="Sales & Orders" categories={weekly.data?.categories ?? []} series={weekly.data?.series ?? []} height={240} maxTicks={7} aovTooltip dualY />
        </View>
      </ScrollView>
    </View>
  )
}
