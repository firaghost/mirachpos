import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import * as SecureStore from 'expo-secure-store'
import { useResponsive } from '@/hooks/useResponsive'

type DayRow = { day: string; orders: number; gross: number; netPaid: number }

async function fetchSales(days: number): Promise<{ list: DayRow[]; branchName: string | null }> {
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id || null
  if (!uid) return { list: [], branchName: null }
  const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle()
  let branchId = (profile as any)?.branch_id ?? null
  try { const ov = await SecureStore.getItemAsync('admin_active_branch_id'); if (ov) branchId = ov } catch {}
  if (!branchId) return { list: [], branchName: null }
  const { data: br } = await supabase.from('branches').select('name').eq('id', branchId).maybeSingle()
  const branchName = (br as any)?.name ?? null

  const to = new Date(); to.setHours(23,59,59,999)
  const from = new Date(Date.now() - (days-1) * 24*60*60*1000); from.setHours(0,0,0,0)

  const { data: orders } = await supabase
    .from('orders')
    .select('id, created_at, total_amount, discount_amount, payment_status, status')
    .eq('branch_id', branchId)
    .gte('created_at', from.toISOString())
    .lte('created_at', to.toISOString())
    .limit(2000)

  const byDay = new Map<string, { orders: number; gross: number; netPaid: number }>()
  const cancelled = new Set(['cancelled','canceled','refunded'])
  ;(orders ?? []).forEach((o: any) => {
    const d = new Date(o.created_at); const key = d.toISOString().slice(0,10)
    if (!byDay.has(key)) byDay.set(key, { orders: 0, gross: 0, netPaid: 0 })
    if (!cancelled.has(String(o.status || '').toLowerCase())) {
      const b = byDay.get(key)!
      b.orders += 1
      b.gross += Number(o.total_amount ?? 0)
      if (String(o.payment_status || '').toLowerCase() === 'paid') {
        b.netPaid += Math.max(0, Number(o.total_amount ?? 0) - Number(o.discount_amount ?? 0))
      }
    }
  })
  const list = Array.from(byDay.entries())
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([day, v]) => ({ day, orders: v.orders, gross: v.gross, netPaid: v.netPaid }))
  return { list, branchName }
}

export function ReportsScreen() {
  const nav = useNavigation<any>()
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const [range, setRange] = useState<7 | 14 | 30>(7)
  const { spacing, font, maxContentWidth } = useResponsive()
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ['admin_reports', range], queryFn: () => fetchSales(range) })
  const list = (data?.list ?? []) as DayRow[]
  const branchName = data?.branchName ?? null

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8), alignItems: 'center' },
    header: { height: 50, paddingHorizontal: Math.round(spacing.sm), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: AdminColors.border, width: '100%', maxWidth: maxContentWidth },
    title: { color: AdminColors.text, fontWeight: '800', fontSize: font.h2 },
    link: { color: AdminColors.accent, fontWeight: '600' },
    sub: { color: AdminColors.subtext, padding: Math.round(spacing.sm), fontSize: font.small },
    segChip: { paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.xs), borderRadius: 999, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border },
    segChipActive: { backgroundColor: AdminColors.accent, borderColor: AdminColors.accent },
    segText: { color: AdminColors.subtext, fontSize: font.small, fontWeight: '700' },
    segTextActive: { color: '#1a1a1a' },
    value: { color: AdminColors.text, fontWeight: '800' },
  }), [isDark, insets.top, insets.bottom, spacing, font, maxContentWidth])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={styles.link}>Back</Text></TouchableOpacity>
        <Text style={styles.title}>Reports</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={{ paddingHorizontal: Math.round(spacing.md), paddingTop: Math.round(spacing.sm), width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }}>
        <Text style={styles.sub}>Branch: {branchName || '-'}</Text>
        <View style={{ flexDirection: 'row', gap: Math.round(spacing.xs), marginTop: Math.round(spacing.xs) }}>
          {([7,14,30] as const).map((d) => (
            <TouchableOpacity key={d} onPress={() => setRange(d)} style={[styles.segChip, range===d && styles.segChipActive]}>
              <Text style={[styles.segText, range===d && styles.segTextActive]}>{d} days</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={AdminColors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: Math.round(spacing.md), width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }}>
          {list.length === 0 ? (
            <Text style={styles.sub}>No data</Text>
          ) : list.map((row) => (
            <View key={row.day} style={{ backgroundColor: AdminColors.card, borderColor: AdminColors.border, borderWidth: 1, borderRadius: Math.max(10, Math.round(spacing.sm)), padding: Math.round(spacing.sm), marginBottom: Math.round(spacing.sm) }}>
              <Text style={styles.title}>{row.day}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={styles.sub}>Orders</Text>
                <Text style={styles.value}>{row.orders}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={styles.sub}>Gross</Text>
                <Text style={styles.value}>{row.gross.toFixed(2)} ETB</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={styles.sub}>Net (paid)</Text>
                <Text style={styles.value}>{row.netPaid.toFixed(2)} ETB</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}
