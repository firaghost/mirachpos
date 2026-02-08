import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, Platform, RefreshControl } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { getUnpaidOrdersLocal, upsertOrdersIndex } from '@/lib/db'
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'
import { TableIcon } from '../../components/pos/TableIcon'
import PaymentDetailScreen from './PaymentDetailScreen'
import { useUiStore } from '@/state/uiStore'
import { useResponsive } from '@/hooks/useResponsive'

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Payments request timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(id)
        resolve(value)
      },
      (err) => {
        clearTimeout(id)
        reject(err)
      }
    )
  })
}

interface PaymentOrderRow {
  id: string
  status: string | null
  total_amount: number
  created_at: string
  table_id: string | null
}

async function fetchUnpaidOrders(): Promise<PaymentOrderRow[]> {
  let session: any = null
  try {
    const sessionResult = await withTimeout(
      supabase.auth.getSession() as Promise<{ data: { session: any } }>,
      15000,
    )
    session = (sessionResult as any)?.data?.session ?? null
  } catch {
    const local = await getUnpaidOrdersLocal(null, null)
    if (local.length > 0) return local.map((o) => ({ id: o.id, status: o.status ?? null, total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
    return []
  }
  const user = session?.user
  if (!user) {
    const local = await getUnpaidOrdersLocal(null, null)
    if (local.length > 0) return local.map((o) => ({ id: o.id, status: o.status ?? null, total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
    return []
  }

  let profile: any = null
  try {
    const profileResult = await withTimeout(
      (async () => {
        return await supabase
          .from('profiles')
          .select('branch_id')
          .eq('id', user.id)
          .maybeSingle()
      })(),
      15000,
    )
    profile = (profileResult as any).data
  } catch {
    const local = await getUnpaidOrdersLocal(null, user.id as any)
    if (local.length > 0) return local.map((o) => ({ id: o.id, status: o.status ?? null, total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
    return []
  }

  const branchId = (profile as any)?.branch_id
  if (!branchId) {
    const local = await getUnpaidOrdersLocal(null, user.id as any)
    if (local.length > 0) return local.map((o) => ({ id: o.id, status: o.status ?? null, total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
    return []
  }

  let ordersResult: any
  try {
    ordersResult = await withTimeout(
      (async () => {
        return await supabase
          .from('orders')
          .select('id, status, total_amount, created_at, table_id, payment_status')
          .eq('branch_id', branchId)
          .eq('staff_id', user.id as any)
          .neq('payment_status', 'paid')
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(120)
      })(),
      15000,
    )
  } catch {
    const local = await getUnpaidOrdersLocal(branchId as any, user.id as any)
    if (local.length > 0) return local.map((o) => ({ id: o.id, status: o.status ?? null, total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
    return []
  }
  const { data, error } = ordersResult as { data: any; error: any }
  if (error) {
    const local = await getUnpaidOrdersLocal(branchId as any, user.id as any)
    if (local.length > 0) return local.map((o) => ({ id: o.id, status: o.status ?? null, total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
    return []
  }
  const rows = (data ?? []) as any[]
  try {
    await upsertOrdersIndex(rows.map((o: any) => ({ id: String(o.id), branch_id: branchId, table_id: (o.table_id as string | null) ?? null, status: (o.status as string | null) ?? null, payment_status: (o.payment_status as string | null) ?? null, total: Number(o.total_amount ?? 0), created_at: String(o.created_at || new Date().toISOString()) })))
  } catch {}
  return rows as PaymentOrderRow[]
}

type PaymentProps = { footerHeight?: number }

export function PaymentScreen({ footerHeight }: PaymentProps) {
  const insets = useSafeAreaInsets()
  const { isDark } = useAppTheme()
  const { spacing, font } = useResponsive()
  const focusPaymentOrderId = useUiStore((s) => s.focusPaymentOrderId)
  const consumeFocusPayment = useUiStore((s) => s.consumeFocusPayment)

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['payments_unpaid_orders'],
    queryFn: fetchUnpaidOrders,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  })

  const [tableNames, setTableNames] = useState<Map<string, string>>(new Map())
  const [selected, setSelected] = useState<PaymentOrderRow | null>(null)
  const [query, setQuery] = useState('')
  const orders = useMemo(() => (data ?? []) as PaymentOrderRow[], [data])

  // If a deep link requested to open a specific order, select it when data is ready
  useEffect(() => {
    if (!focusPaymentOrderId) return
    const target = orders.find((o) => String(o.id) === String(focusPaymentOrderId))
    if (target) {
      setSelected(target)
      consumeFocusPayment()
    }
  }, [focusPaymentOrderId, orders])

  useEffect(() => {
    (async () => {
      try {
        const tids = Array.from(new Set(orders.map((o) => o.table_id).filter(Boolean))) as string[]
        if (tids.length === 0) { if (tableNames.size !== 0) setTableNames(new Map()); return }
        const { data: trows } = await supabase.from('tables').select('id, name').in('id', tids)
        const map = new Map<string, string>()
        ;(trows ?? []).forEach((t: any) => map.set(t.id as string, (t.name as string) || t.id))
        setTableNames(map)
      } catch {}
    })()
  }, [orders])

  // Bottom spacing so list content never sits under the fixed bottom tab bar
  const TAB_BAR_BASE = 45
  const measured = footerHeight && footerHeight > 0 ? footerHeight : (TAB_BAR_BASE + Math.max(insets.bottom, 8))
  const bottomOffset = Math.max(measured + 8, 20)

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg },
    inner: { flex: 1 },
    listHeader: { backgroundColor: AdminColors.bg, paddingHorizontal: Math.round(spacing.sm), paddingTop: Math.round(spacing.sm), paddingBottom: Math.round(spacing.sm) },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: { fontSize: font.h2, fontWeight: '700', color: AdminColors.text },
    headerRight: { alignItems: 'flex-end' },
    headerTotalLabel: { fontSize: font.small, color: AdminColors.subtext, textAlign: 'right' },
    headerTotalValue: { fontSize: font.body, fontWeight: '700', color: AdminColors.text, textAlign: 'right' },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', marginTop: 10,
      borderWidth: 1, borderColor: AdminColors.border, borderRadius: 999,
      paddingHorizontal: Math.round(spacing.md), height: Math.max(40, Math.round(spacing.md * 2)),
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
      shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 1,
    },
    searchInput: { flex: 1, color: AdminColors.text, paddingVertical: Platform.OS === 'ios' ? 8 : 6 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { marginTop: 6, fontSize: font.small, color: AdminColors.subtext },
    errorText: { fontSize: font.small, color: AdminColors.danger },
    gridContent: { paddingHorizontal: Math.round(spacing.sm), paddingTop: Math.round(spacing.xs) },
    row: { justifyContent: 'space-between', marginBottom: Math.round(spacing.sm) },
    amountText: { marginTop: 6, fontSize: font.body, fontWeight: '700', color: AdminColors.text, textAlign: 'center' },
  }), [isDark, spacing, font])

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Only show table orders (exclude takeaway/guest without table)
    const base = orders.filter((o) => !!o.table_id)
    if (!q) return base
    return base.filter((o) => {
      const tableLabel = (tableNames.get(o.table_id || '') || o.table_id || '').toString().toLowerCase()
      return tableLabel.includes(q) || o.id.toLowerCase().startsWith(q)
    })
  }, [orders, query, tableNames])

  if (selected) {
    const label = tableNames.get(selected.table_id || '') || (selected.table_id ?? '-')
    return (
      <PaymentDetailScreen
        orderId={selected.id}
        tableLabel={`Table ${label}`}
        totalAmount={Number(selected.total_amount ?? 0)}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <View style={styles.container}>
      {isLoading && (
        <View style={styles.centered}>
          <ActivityIndicator color={AdminColors.accent} />
          <Text style={styles.loadingText}>Loading unpaid orders…</Text>
        </View>
      )}
      {error && !isLoading && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Unable to load unpaid orders</Text>
        </View>
      )}
      {!isLoading && !error && (
        <FlatList
          data={filteredOrders}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const raw = (tableNames.get(item.table_id || '') || item.table_id || '').toString()
            const base = raw.trim().length > 0 ? raw.trim() : '—'
            const label = /^t\s*/i.test(base) ? base : (base === '—' ? base : `T ${base}`)
            return (
              <View style={{ flex: 1, marginHorizontal: 4 }}>
                <View style={{ flex: 1 }}>
                  <TableIcon label={label} onPress={() => setSelected(item)} />
                </View>
                <Text style={styles.amountText}>{Number(item.total_amount ?? 0).toFixed(2)} ETB</Text>
              </View>
            )
          }}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={[styles.gridContent, { paddingBottom: bottomOffset + 24 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={AdminColors.accent} />}
          stickyHeaderIndices={[0]}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <View style={styles.headerRow}>
                <Text style={styles.headerTitle}>Payments</Text>
                <View style={styles.headerRight}>
                  <Text style={styles.headerTotalLabel}>Unpaid</Text>
                  <Text style={styles.headerTotalValue}>{filteredOrders.length}</Text>
                </View>
              </View>
              <View style={styles.searchWrap}>
                <MaterialIcons name="search" size={18} color={AdminColors.subtext} style={{ marginRight: 8 }} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search table or order #"
                  placeholderTextColor={AdminColors.subtext}
                  style={styles.searchInput}
                />
              </View>
            </View>
          }
          ListEmptyComponent={<Text style={{ paddingHorizontal: Math.round(spacing.sm), color: AdminColors.subtext }}>No unpaid orders</Text>}
        />
      )}
    </View>
  )
}

export default PaymentScreen
