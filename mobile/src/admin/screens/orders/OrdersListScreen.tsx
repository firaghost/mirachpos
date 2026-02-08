import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl, TextInput, Modal } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { supabase } from '@/lib/supabase'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppTheme } from '../../../theme/ThemeProvider'
import * as SecureStore from 'expo-secure-store'

export type AdminOrderRow = {
  id: string
  status: string | null
  total_amount: number
  created_at: string
  table_id: string | null
  payment_status?: string | null
  branch_id?: string | null
  staff_id?: string | null
  discount_amount?: number | null
  tax_amount?: number | null
}

async function fetchOrders(): Promise<AdminOrderRow[]> {
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return []
  const { data: profile } = await supabase.from('profiles').select('branch_id, organization_id, role').eq('id', user.id).maybeSingle()
  let branchId = (profile as any)?.branch_id ?? null
  const orgId = (profile as any)?.organization_id ?? null
  const role = String((profile as any)?.role || '').toLowerCase()
  const isSuper = ['super_admin','admin'].includes(role)
  // Only super admins may override branch via local selection
  if (isSuper) {
    try {
      const override = await SecureStore.getItemAsync(`admin_active_branch_id:${user.id}`)
      if (override && override.length > 0) branchId = override
    } catch {}
  }

  // Determine branch scope
  let branchIds: string[] | null = null
  if (!isSuper) {
    // Branch managers are locked to their assigned branch only
    if (branchId) branchIds = [branchId]
    else return []
  } else {
    if (branchId) {
      branchIds = [branchId]
    } else if (orgId) {
      try {
        const { data: brs } = await supabase.from('branches').select('id').eq('organization_id', orgId)
        branchIds = (brs ?? []).map((b: any) => String(b.id))
      } catch {}
    }
  }

  let q = supabase
    .from('orders')
    .select('id, status, total_amount, created_at, table_id, branch_id, staff_id, discount_amount, tax_amount, payment_status')
    .order('created_at', { ascending: false })
    .limit(200)
  if (branchIds && branchIds.length === 1) q = q.eq('branch_id', branchIds[0])
  else if (branchIds && branchIds.length > 1) q = q.in('branch_id', branchIds)

  const { data, error } = await q
  if (error) return []
  return (data ?? []) as AdminOrderRow[]
}

export function OrdersListScreen() {
  const nav = useNavigation<any>()
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'void' | 'pending' | 'approvals' | 'takeaway'>('all')
  const [payFilter, setPayFilter] = useState<'all' | 'unpaid' | 'paid' | 'partial'>('all')
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { data, isLoading, isFetching, refetch } = useQuery({ queryKey: ['admin_orders'], queryFn: fetchOrders, refetchInterval: 15000 })
  const [tableNames, setTableNames] = useState<Record<string, string>>({})
  const [approvals, setApprovals] = useState<Record<string, 'void' | 'discount' | 'both'>>({})
  const insets = useSafeAreaInsets()
  const { isDark } = useAppTheme()
  const [overrideBranchId, setOverrideBranchId] = useState<string | null>(null)
  const [profileBranchId, setProfileBranchId] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id || null
        let profBid: string | null = null
        if (uid) {
          const { data: prof } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle()
          profBid = (prof as any)?.branch_id ?? null
        }
        let over: string | null = null
        try { const v = await SecureStore.getItemAsync('admin_active_branch_id'); over = v || null } catch {}
        setProfileBranchId(profBid)
        setOverrideBranchId(over)
      } catch {}
    })()
  }, [])

  // Resolve table names for current batch
  useEffect(() => {
    (async () => {
      try {
        const arr = (data ?? []) as AdminOrderRow[]
        const ids = Array.from(new Set(arr.map((o) => o.table_id).filter(Boolean))) as string[]
        if (ids.length === 0) { setTableNames({}); return }
        const { data: rows } = await supabase.from('tables').select('id, name').in('id', ids)
        const map: Record<string, string> = {}
        ;(rows ?? []).forEach((r: any) => { if (r?.id) map[String(r.id)] = (r?.name as string) || String(r.id) })
        setTableNames(map)
      } catch {}
    })()
  }, [data])

  // Load approvals for current batch from order_change_logs
  useEffect(() => {
    (async () => {
      try {
        const arr = (data ?? []) as AdminOrderRow[]
        const ids = arr.map((o) => o.id)
        if (ids.length === 0) { setApprovals({}); return }
        const { data: logs } = await supabase
          .from('order_change_logs')
          .select('order_id, reason')
          .in('order_id', ids)
        const map: Record<string, 'void' | 'discount' | 'both'> = {}
        ;(logs ?? []).forEach((r: any) => {
          const id = String(r?.order_id || '')
          const reason = String(r?.reason || '').toLowerCase()
          const isVoid = /void\s*request/.test(reason)
          const isDisc = /discount\s*request/.test(reason)
          if (!id) return
          const prev = map[id]
          if (isVoid && isDisc) map[id] = 'both'
          else if (isVoid) map[id] = prev === 'discount' ? 'both' : 'void'
          else if (isDisc) map[id] = prev === 'void' ? 'both' : 'discount'
        })
        setApprovals(map)
      } catch {}
    })()
  }, [data])

  const rows = useMemo(() => {
    const arr = (data ?? []) as AdminOrderRow[]
    const status = (s?: string | null) => String(s || '').toLowerCase()
    let base: AdminOrderRow[]
    if (filter === 'all') base = arr
    else if (filter === 'active') base = arr.filter((o) => ['pending','preparing','confirmed'].includes(status(o.status)))
    else if (filter === 'completed') base = arr.filter((o) => status(o.status) === 'completed')
    else if (filter === 'void') base = arr.filter((o) => ['void','voided','canceled','cancelled','refunded'].includes(status(o.status)))
    else if (filter === 'pending') base = arr.filter((o) => status(o.status) === 'pending')
    else if (filter === 'takeaway') base = arr.filter((o) => !o.table_id)
    else base = arr.filter((o) => approvals[o.id])

    const byPay = payFilter === 'all' ? base : base.filter((o) => String(o.payment_status || '').toLowerCase() === payFilter)
    const q = search.trim().toLowerCase()
    if (!q) return byPay
    return byPay.filter((o) => o.id.toLowerCase().includes(q))
  }, [data, filter, payFilter, search, approvals])

  const renderRow = ({ item }: { item: AdminOrderRow }) => {
    const time = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const status = String(item.status || '-')
    const tableLabel = tableNames[item.table_id || ''] || (item.table_id ?? '-')
    const isTakeaway = !item.table_id
    const ap = approvals[item.id]
    const ps = String(item.payment_status || '').toLowerCase()
    const payLabel = ps ? ps[0].toUpperCase() + ps.slice(1) : ''
    return (
      <TouchableOpacity style={styles.row} onPress={() => nav.navigate('OrderDetail', { orderId: item.id, order: item })}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>#{item.id.slice(0, 6)} • {isTakeaway ? 'Takeaway' : `Table ${tableLabel}`}</Text>
          <Text style={styles.sub}>
            {time} • {status}{payLabel ? ` • ${payLabel}` : ''} {ap ? `• Pending ${ap}` : ''}
          </Text>
        </View>
        <Text style={styles.amount}>{Number(item.total_amount ?? 0).toFixed(2)} ETB</Text>
      </TouchableOpacity>
    )
  }

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
    header: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
    headerTitle: { color: AdminColors.text, fontSize: 20, fontWeight: '800' },
    input: { width: '100%', backgroundColor: AdminColors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: AdminColors.text, borderWidth: 1, borderColor: AdminColors.border },
    pills: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: AdminColors.border, backgroundColor: AdminColors.card },
    chipActive: { backgroundColor: AdminColors.accent, borderColor: AdminColors.accent },
    chipText: { color: AdminColors.subtext, fontSize: 12, fontWeight: '700' },
    chipTextActive: { color: '#1a1a1a' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    row: { marginHorizontal: 12, marginTop: 10, backgroundColor: AdminColors.card, borderRadius: 12, borderWidth: 1, borderColor: AdminColors.border, padding: 12, flexDirection: 'row', alignItems: 'center' },
    title: { color: AdminColors.text, fontWeight: '700' },
    sub: { color: AdminColors.subtext, fontSize: 12, marginTop: 2 },
    amount: { color: AdminColors.text, fontWeight: '800' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    modalCard: { backgroundColor: AdminColors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, borderWidth: 1, borderColor: AdminColors.border },
    banner: { marginHorizontal: 12, marginTop: 8, backgroundColor: AdminColors.card, borderColor: AdminColors.border, borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  }), [isDark, insets.top, insets.bottom])

  return (
    <View style={styles.container}>
      <View style={styles.header}> 
        <Text style={styles.headerTitle}>Orders</Text>
        {(overrideBranchId && profileBranchId && overrideBranchId !== profileBranchId) && (
          <View style={styles.banner}>
            <Text style={styles.sub}>Using a different branch override. Apply to profile?</Text>
            <TouchableOpacity onPress={async () => {
              try {
                const { data: { session } } = await supabase.auth.getSession()
                const uid = session?.user?.id || null
                if (uid && overrideBranchId) {
                  await supabase.from('profiles').update({ branch_id: overrideBranchId as any }).eq('id', uid)
                  setProfileBranchId(overrideBranchId)
                  await refetch()
                }
              } catch {}
            }} style={[styles.chip, styles.chipActive]}>
              <Text style={styles.chipTextActive}>Apply</Text>
            </TouchableOpacity>
          </View>
        )}
        <TextInput value={search} onChangeText={setSearch} placeholder="Search by order id" placeholderTextColor={AdminColors.subtext} style={styles.input} />
        <View style={styles.pills}>
          <TouchableOpacity onPress={() => setFiltersOpen(true)} style={styles.chip}><Text style={styles.chipText}>Filters</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => { setFilter('all'); setPayFilter('all'); setSearch('') }} style={[styles.chip, styles.chipActive]}><Text style={styles.chipTextActive}>Reset</Text></TouchableOpacity>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={AdminColors.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(i) => i.id}
          renderItem={renderRow}
          contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
          onRefresh={() => refetch()}
          refreshing={isFetching}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => refetch()} tintColor={AdminColors.accent} />}
          ListEmptyComponent={<Text style={[styles.sub, { textAlign: 'center', marginTop: 20 }]}>No orders</Text>}
        />
      )}

      {/* Filters Modal */}
      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.headerTitle}>Filters</Text>
            <Text style={[styles.sub, { paddingHorizontal: 0 }]}>Status</Text>
            <View style={styles.pills}>
              {(['all','active','completed','void','pending','approvals','takeaway'] as const).map((f) => (
                <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
                  <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f[0].toUpperCase()+f.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ height: 10 }} />
            <Text style={[styles.sub, { paddingHorizontal: 0 }]}>Payment status</Text>
            <View style={styles.pills}>
              {(['all','unpaid','paid','partial'] as const).map((m) => (
                <TouchableOpacity key={m} onPress={() => setPayFilter(m)} style={[styles.chip, payFilter === m && styles.chipActive]}>
                  <Text style={[styles.chipText, payFilter === m && styles.chipTextActive]}>{m[0].toUpperCase()+m.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ height: 12 }} />
            <View style={styles.pills}>
              <TouchableOpacity onPress={() => setFiltersOpen(false)} style={[styles.chip, styles.chipActive]}><Text style={styles.chipTextActive}>Apply</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => { setFilter('all'); setPayFilter('all'); setFiltersOpen(false) }} style={styles.chip}><Text style={styles.chipText}>Clear</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}
