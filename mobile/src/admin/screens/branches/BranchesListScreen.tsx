import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import { AdminColors } from '../../theme/colors'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type BranchRow = { id: string; name: string; location?: string | null }

async function fetchBranches(): Promise<BranchRow[]> {
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id || null
  if (!uid) return []
  const { data: profile } = await supabase.from('profiles').select('organization_id, role').eq('id', uid).maybeSingle()
  const orgId = (profile as any)?.organization_id ?? null
  const role = String((profile as any)?.role || '').toLowerCase()
  const isSuper = ['super_admin','admin'].includes(role)
  if (!orgId || !isSuper) return []
  const { data } = await supabase
    .from('branches')
    .select('id, name, location')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })
  return (data ?? []).map((b: any) => ({ id: String(b.id), name: String(b.name || 'Branch'), location: (b as any).location ?? null }))
}

export function BranchesListScreen() {
  const nav = useNavigation<any>()
  const { data, isLoading, isFetching, refetch } = useQuery({ queryKey: ['admin_branches'], queryFn: fetchBranches, refetchInterval: 30000 })
  const [devicesByBranch, setDevicesByBranch] = useState<Record<string, number>>({})
  const [activeOrdersByBranch, setActiveOrdersByBranch] = useState<Record<string, number>>({})
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()

  const list = useMemo(() => (data ?? []) as BranchRow[], [data])

  // Load devices online count and active orders per branch
  useEffect(() => {
    (async () => {
      try {
        const ids = list.map((b) => b.id)
        if (ids.length === 0) { setDevicesByBranch({}); setActiveOrdersByBranch({}); return }
        // Devices online in last 5 minutes
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
        const { data: devs } = await supabase
          .from('devices')
          .select('branch_id, status, last_seen_at')
          .in('branch_id', ids)
        const mapD: Record<string, number> = {}
        ;(devs ?? []).forEach((d: any) => {
          const ok = String(d?.status || '').toLowerCase() === 'online' && d?.last_seen_at && new Date(d.last_seen_at as string).toISOString() >= fiveMinAgo
          if (ok && d?.branch_id) {
            const k = String(d.branch_id)
            mapD[k] = (mapD[k] ?? 0) + 1
          }
        })
        setDevicesByBranch(mapD)
        // Active orders
        const { data: orders } = await supabase
          .from('orders')
          .select('branch_id, status')
          .in('branch_id', ids)
        const mapO: Record<string, number> = {}
        ;(orders ?? []).forEach((o: any) => {
          const st = String(o?.status || '').toLowerCase()
          const active = ['pending','preparing','served','confirmed'].includes(st)
          if (active && o?.branch_id) {
            const k = String(o.branch_id)
            mapO[k] = (mapO[k] ?? 0) + 1
          }
        })
        setActiveOrdersByBranch(mapO)
      } catch {}
    })()
  }, [list])

  const renderItem = ({ item }: { item: BranchRow }) => {
    const dev = devicesByBranch[item.id] ?? 0
    const act = activeOrdersByBranch[item.id] ?? 0
    return (
      <TouchableOpacity style={styles.row} onPress={() => nav.navigate('BranchDetail', { branchId: item.id, name: item.name })}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.meta}>{item.location || '—'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.kpi}>{dev} online</Text>
          <Text style={styles.kpi}>{act} active</Text>
        </View>
      </TouchableOpacity>
    )
  }

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
    title: { color: AdminColors.text, fontSize: 18, fontWeight: '800', padding: 16 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    row: { marginHorizontal: 12, marginTop: 10, backgroundColor: AdminColors.card, borderRadius: 12, borderWidth: 1, borderColor: AdminColors.border, padding: 12, flexDirection: 'row', alignItems: 'center' },
    name: { color: AdminColors.text, fontWeight: '800' },
    meta: { color: AdminColors.subtext, marginTop: 2 },
    kpi: { color: AdminColors.text, fontWeight: '700' },
  }), [isDark, insets.top, insets.bottom])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Branches</Text>
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={AdminColors.accent} /></View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
          onRefresh={() => refetch()}
          refreshing={isFetching}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => refetch()} tintColor={AdminColors.accent} />}
          ListEmptyComponent={<Text style={styles.meta}>No branches</Text>}
        />
      )}
    </View>
  )
}
