import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getUnpaidOrdersLocal, upsertOrdersIndex } from '@/lib/db'
import { AdminColors } from '@/admin/theme/colors'
import { useResponsive } from '@/hooks/useResponsive'

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Orders request timeout')), ms)
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

type OrderRow = {
  id: string
  status: string
  total_amount: number
  created_at: string
  table_id: string | null
}

async function fetchOrders(): Promise<OrderRow[]> {
  let session: any = null
  try {
    const sessionResult = await withTimeout(
      supabase.auth.getSession() as Promise<{ data: { session: any } }>,
      15000,
    )
    session = (sessionResult as any)?.data?.session ?? null
  } catch {
    const local = await getUnpaidOrdersLocal(null, null)
    return (local ?? []).map((o) => ({ id: o.id, status: (o.status as any) || 'pending', total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
  }
  const user = session?.user
  if (!user) {
    // Fallback: show unpaid local orders as the recent list when offline
    const local = await getUnpaidOrdersLocal(null, null)
    return (local ?? []).map((o) => ({ id: o.id, status: (o.status as any) || 'pending', total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
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
    return (local ?? []).map((o) => ({ id: o.id, status: (o.status as any) || 'pending', total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
  }

  const branchId = profile?.branch_id
  if (!branchId) {
    const local = await getUnpaidOrdersLocal(null, user.id as any)
    return (local ?? []).map((o) => ({ id: o.id, status: (o.status as any) || 'pending', total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
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
          .order('created_at', { ascending: false })
          .limit(25)
      })(),
      15000,
    )
  } catch {
    const local = await getUnpaidOrdersLocal(branchId as any, user.id as any)
    return (local ?? []).map((o) => ({ id: o.id, status: (o.status as any) || 'pending', total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
  }
  const { data, error } = ordersResult as { data: any; error: any }

  if (error) {
    const local = await getUnpaidOrdersLocal(branchId as any, user.id as any)
    return (local ?? []).map((o) => ({ id: o.id, status: (o.status as any) || 'pending', total_amount: Number(o.total ?? 0), created_at: o.created_at, table_id: o.table_id ?? null }))
  }
  const list = (data ?? []) as OrderRow[]
  try {
    await upsertOrdersIndex((data ?? []).map((o: any) => ({ id: String(o.id), branch_id: branchId, table_id: (o.table_id as string | null) ?? null, status: (o.status as string | null) ?? null, payment_status: (o.payment_status as string | null) ?? null, total: Number(o.total_amount ?? 0), created_at: String(o.created_at || new Date().toISOString()) })))
  } catch {}
  return list
}

async function fetchOrderItems(orderId: string) {
  const result = await withTimeout(
    (async () => {
      return await supabase
        .from('order_items')
        .select('product_id, quantity, unit_price, total_price, products(name)')
        .eq('order_id', orderId)
    })(),
    15000,
  )
  const { data, error } = result as { data: any; error: any }
  if (error) throw error
  return (data ?? []) as Array<{
    product_id: string
    quantity: number
    unit_price: number
    total_price: number
    products?: { name?: string | null } | null
  }>
}

export function OrdersScreen() {
  const [selected, setSelected] = useState<OrderRow | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchOrderItems>>>([])
  const insets = useSafeAreaInsets()
  const { spacing, font } = useResponsive()

  const {
    data: orders,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders })

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { marginTop: 6, fontSize: font.small, color: AdminColors.subtext },
    errorText: { fontSize: font.small, color: AdminColors.danger },

    orderCard: {
      padding: Math.round(spacing.md),
      borderRadius: Math.max(8, Math.round(spacing.sm)),
      backgroundColor: AdminColors.card,
      marginBottom: Math.round(spacing.sm),
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: AdminColors.border,
    },
    orderTitle: { fontSize: font.body, fontWeight: '700', color: AdminColors.text },
    orderSub: { fontSize: font.small, color: AdminColors.subtext },
    orderTotal: { fontSize: font.body, fontWeight: '700', color: AdminColors.text },

    badge: {
      marginTop: 6,
      paddingHorizontal: Math.max(8, Math.round(spacing.xs)),
      paddingVertical: 2,
      borderRadius: 999,
      overflow: 'hidden',
      fontSize: 11,
      color: '#fff',
      textTransform: 'capitalize',
    },
    badgePending: { backgroundColor: '#f59e0b' },
    badgeInProgress: { backgroundColor: '#3b82f6' },
    badgeDone: { backgroundColor: '#16a34a' },
    badgeDefault: { backgroundColor: '#6b7280' },

    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Math.round(spacing.sm),
      paddingVertical: Math.round(spacing.xs + 6),
      backgroundColor: AdminColors.card,
      borderBottomWidth: 1,
      borderColor: AdminColors.border,
    },
    backLink: { color: AdminColors.accent, fontWeight: '600' },
    detailTitle: { fontSize: font.h3, fontWeight: '700', color: AdminColors.text },
    detailBody: { flex: 1, backgroundColor: AdminColors.card },
    detailMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Math.round(spacing.xs),
    },
    metaLabel: { fontSize: font.small, color: AdminColors.subtext },
    metaValue: { fontSize: font.small, color: AdminColors.text },
    metaTotal: { fontSize: font.body, fontWeight: '700', color: AdminColors.text },
    sectionTitle: { fontSize: font.body, fontWeight: '700', marginVertical: Math.round(spacing.xs) },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Math.round(spacing.xs),
      borderBottomWidth: 1,
      borderColor: AdminColors.border,
    },
    itemName: { fontSize: font.body, color: AdminColors.text, flex: 1 },
    itemQty: { width: 32, textAlign: 'center', color: AdminColors.subtext },
    itemPrice: { width: 100, textAlign: 'right', fontWeight: '600', color: AdminColors.text },
  }), [spacing, font])

  const openOrder = async (o: OrderRow) => {
    setSelected(o)
    setItems([])
    setItemsError(null)
    setItemsLoading(true)
    try {
      const data = await fetchOrderItems(o.id)
      setItems(data)
    } catch (e: any) {
      setItemsError(e?.message ?? 'Failed to load items')
    } finally {
      setItemsLoading(false)
    }
  }

  if (selected) {
    return (
      <View style={styles.container}>
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setSelected(null)}>
            <Text style={styles.backLink}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.detailTitle}>Order #{selected.id.slice(0, 6)}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView style={styles.detailBody} contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 72 }}>
          <View style={styles.detailMetaRow}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={[styles.badge, badgeStyle(selected.status)]}>{selected.status}</Text>
          </View>
          <View style={styles.detailMetaRow}>
            <Text style={styles.metaLabel}>Table</Text>
            <Text style={styles.metaValue}>{selected.table_id ?? '-'}</Text>
          </View>
          <View style={styles.detailMetaRow}>
            <Text style={styles.metaLabel}>Created</Text>
            <Text style={styles.metaValue}>{new Date(selected.created_at).toLocaleString()}</Text>
          </View>
          <View style={[styles.detailMetaRow, { marginBottom: 12 }] }>
            <Text style={styles.metaLabel}>Total</Text>
            <Text style={styles.metaTotal}>{Number(selected.total_amount ?? 0).toFixed(2)} ETB</Text>
          </View>

          <Text style={styles.sectionTitle}>Items</Text>
          {itemsLoading && (
            <View style={styles.center}> 
              <ActivityIndicator size="small" color="#2C1810" />
            </View>
          )}
          {itemsError ? <Text style={styles.errorText}>{itemsError}</Text> : null}
          {items.map((it, idx) => (
            <View key={idx} style={styles.itemRow}>
              <Text style={styles.itemName}>{it.products?.name ?? it.product_id}</Text>
              <Text style={styles.itemQty}>x{it.quantity}</Text>
              <Text style={styles.itemPrice}>{Number(it.total_price ?? 0).toFixed(2)} ETB</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="small" color="#2C1810" />
          <Text style={styles.loadingText}>Loading orders…</Text>
        </View>
      )}
      {error && !isLoading && (
        <View style={styles.center}>
          <Text style={styles.errorText}>Unable to load orders</Text>
        </View>
      )}
      {!isLoading && !error && (
        <FlatList
          data={orders ?? []}
          keyExtractor={(o) => o.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          contentContainerStyle={{ padding: Math.round(spacing.sm), paddingBottom: insets.bottom + 72 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.orderCard} onPress={() => openOrder(item)}>
              <View>
                <Text style={styles.orderTitle}>#{item.id.slice(0, 6)}</Text>
                <Text style={styles.orderSub}>{new Date(item.created_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
                <Text style={styles.orderSub}>Table: {item.table_id ?? '-'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.orderTotal}>{Number(item.total_amount ?? 0).toFixed(2)} ETB</Text>
                <Text style={[styles.badge, badgeStyle(item.status)]}>{item.status}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  )
}

function badgeStyle(status: string) {
  switch ((status || '').toLowerCase()) {
    case 'pending':
      return styles.badgePending
    case 'preparing':
    case 'in_progress':
      return styles.badgeInProgress
    case 'served':
    case 'completed':
    case 'closed':
      return styles.badgeDone
    default:
      return styles.badgeDefault
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 6, fontSize: 12, color: '#666' },
  errorText: { fontSize: 12, color: '#b91c1c' },

  orderCard: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  orderTitle: { fontSize: 14, fontWeight: '700', color: '#2C1810' },
  orderSub: { fontSize: 12, color: '#666' },
  orderTotal: { fontSize: 14, fontWeight: '700' },

  badge: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 11,
    color: '#fff',
    textTransform: 'capitalize',
  },
  badgePending: { backgroundColor: '#f59e0b' },
  badgeInProgress: { backgroundColor: '#3b82f6' },
  badgeDone: { backgroundColor: '#16a34a' },
  badgeDefault: { backgroundColor: '#6b7280' },

  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  backLink: { color: '#2C1810', fontWeight: '600' },
  detailTitle: { fontSize: 16, fontWeight: '700', color: '#2C1810' },
  detailBody: { flex: 1, backgroundColor: '#fff' },
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  metaLabel: { fontSize: 12, color: '#666' },
  metaValue: { fontSize: 12, color: '#111' },
  metaTotal: { fontSize: 14, fontWeight: '700', color: '#2C1810' },
  sectionTitle: { fontSize: 13, fontWeight: '700', marginVertical: 8 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#f1f1f1',
  },
  itemName: { fontSize: 13, flex: 1 },
  itemQty: { width: 32, textAlign: 'center', color: '#666' },
  itemPrice: { width: 100, textAlign: 'right', fontWeight: '600' },
})
