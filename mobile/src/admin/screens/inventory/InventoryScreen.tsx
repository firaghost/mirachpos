import React, { useMemo, useState } from 'react'
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, TextInput } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SecureStore from 'expo-secure-store'
import { useResponsive } from '@/hooks/useResponsive'

type InvRow = { id: string; name?: string | null; current_stock: number; low_stock_threshold: number }

async function fetchLowStock(): Promise<InvRow[]> {
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id || null
  let branchId: string | null = null
  if (uid) {
    const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle()
    branchId = (profile as any)?.branch_id ?? null
    try { const ov = await SecureStore.getItemAsync('admin_active_branch_id'); if (ov) branchId = ov } catch {}
  }

  let q = supabase
    .from('inventory_items')
    .select('id, name, current_stock, low_stock_threshold')
  if (branchId) q = q.eq('branch_id', branchId as any)
  const { data } = await q
  const rows = (data ?? []) as any[]
  const low = rows.filter((it: any) => {
    const cur = Number(it.current_stock ?? 0)
    const thr = Number(it.low_stock_threshold ?? 0)
    return thr > 0 && cur <= thr
  })
  // Sort by stock ratio ascending then by threshold desc
  const scored = low.map((it: any) => ({
    id: String(it.id),
    name: (it as any).name ?? null,
    current_stock: Number(it.current_stock ?? 0),
    low_stock_threshold: Number(it.low_stock_threshold ?? 0),
    score: Number(it.current_stock ?? 0) / Math.max(1, Number(it.low_stock_threshold ?? 1)),
  }))
  scored.sort((a, b) => (a.score - b.score) || (b.low_stock_threshold - a.low_stock_threshold))
  return scored.slice(0, 20)
}

export function InventoryScreen() {
  const nav = useNavigation<any>()
  const [mode, setMode] = useState<'low' | 'all'>('low')
  const [search, setSearch] = useState('')
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const { spacing, font, maxContentWidth } = useResponsive()

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin_inventory', mode, search],
    queryFn: async (): Promise<InvRow[]> => {
      if (mode === 'low') return fetchLowStock()
      // Fetch all items with optional search
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id || null
      let branchId: string | null = null
      if (uid) {
        const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle()
        branchId = (profile as any)?.branch_id ?? null
        try { const ov = await SecureStore.getItemAsync('admin_active_branch_id'); if (ov) branchId = ov } catch {}
      }
      let q = supabase
        .from('inventory_items')
        .select('id, name, current_stock, low_stock_threshold')
        .order('name', { ascending: true })
      if (branchId) q = q.eq('branch_id', branchId as any)
      if (search.trim()) q = q.ilike('name', `%${search.trim()}%` as any)
      const { data: rows } = await q
      return ((rows ?? []) as any[]).map((it) => ({
        id: String(it.id),
        name: (it as any).name ?? null,
        current_stock: Number(it.current_stock ?? 0),
        low_stock_threshold: Number(it.low_stock_threshold ?? 0),
      }))
    },
    refetchInterval: 30000,
  })

  const list = useMemo(() => (data ?? []) as InvRow[], [data])
  const [adjustingId, setAdjustingId] = useState<string | null>(null)

  const adjust = async (row: InvRow) => {
    // Stub quick adjust: +1 to stock. In production, open a proper adjust screen.
    try {
      setAdjustingId(row.id)
      const { error } = await supabase
        .from('inventory_items')
        .update({ current_stock: Number(row.current_stock ?? 0) + 1 })
        .eq('id', row.id)
      if (!error) await refetch()
    } finally {
      setAdjustingId(null)
    }
  }

  const renderItem = ({ item }: { item: InvRow }) => (
    <TouchableOpacity style={styles.row} onPress={() => nav.navigate('ItemDetail', { itemId: item.id })}>
      <View style={{ flex: 1, minWidth: 0, paddingRight: Math.round(spacing.xs) }}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">{item.name || `#${item.id.slice(0,6)}`}</Text>
        <Text style={styles.meta}>Threshold: {item.low_stock_threshold}</Text>
      </View>
      <Text style={styles.stock}>{Number(item.current_stock ?? 0)}</Text>
      <TouchableOpacity style={styles.btn} onPress={() => adjust(item)} disabled={adjustingId === item.id}>
        <Text style={styles.btnText}>{adjustingId === item.id ? 'Updating…' : 'Adjust +1'}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  )

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8), alignItems: 'stretch' },
    title: { color: AdminColors.text, fontSize: font.h2, fontWeight: '800', paddingVertical: 0, flex: 1, marginRight: Math.round(spacing.sm) },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Math.round(spacing.md), paddingTop: Math.round(spacing.md), width: '100%' },
    segment: { flexDirection: 'row', backgroundColor: AdminColors.surface, borderRadius: 999, padding: 2 },
    segChip: { paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.xs), borderRadius: 999 },
    segChipActive: { backgroundColor: AdminColors.accent },
    segText: { color: AdminColors.subtext, fontSize: font.small, fontWeight: '700' },
    segTextActive: { color: '#1a1a1a' },
    searchBox: { paddingHorizontal: Math.round(spacing.md), marginTop: Math.round(spacing.xs), width: '100%' },
    input: { backgroundColor: AdminColors.surface, borderRadius: 10, paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.xs), color: AdminColors.text, borderWidth: 1, borderColor: AdminColors.border },
    sub: { color: AdminColors.subtext, marginTop: Math.round(spacing.xs), paddingHorizontal: Math.round(spacing.md) },
    row: { width: '100%', marginTop: Math.round(spacing.sm), backgroundColor: AdminColors.card, borderRadius: Math.max(10, Math.round(spacing.sm)), borderWidth: 1, borderColor: AdminColors.border, padding: Math.round(spacing.sm), flexDirection: 'row', alignItems: 'center' },
    name: { color: AdminColors.text, fontWeight: '700', fontSize: font.body, flexShrink: 1 },
    meta: { color: AdminColors.subtext, fontSize: font.small, marginTop: 2 },
    stock: { color: AdminColors.text, fontWeight: '800', width: 50, textAlign: 'right', marginLeft: Math.round(spacing.xs), flexShrink: 0 },
    btn: { marginLeft: Math.round(spacing.xs), paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.xs), borderRadius: 999, backgroundColor: AdminColors.accent, flexShrink: 0 },
    btnText: { color: '#1a1a1a', fontWeight: '700' },
  }), [isDark, insets.top, insets.bottom, spacing, font, maxContentWidth])

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>Inventory</Text>
        <View style={styles.segment}>
          {(['low','all'] as const).map((m) => (
            <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.segChip, mode===m && styles.segChipActive]}>
              <Text style={[styles.segText, mode===m && styles.segTextActive]}>{m==='low'?'Low':'All'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {mode==='all' && (
        <View style={styles.searchBox}>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search items" placeholderTextColor={AdminColors.subtext} style={styles.input} />
        </View>
      )}
      <FlatList
        style={{ flex: 1, alignSelf: 'stretch' }}
        data={list}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
        onRefresh={() => refetch()}
        refreshing={isRefetching}
        refreshControl={<RefreshControl refreshing={isRefetching || isLoading} onRefresh={() => refetch()} tintColor={AdminColors.accent} />}
        ListEmptyComponent={<Text style={styles.sub}>{isLoading ? 'Loading…' : 'No low stock items'}</Text>}
      />
    </View>
  )
}
