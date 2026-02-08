import React, { useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, ScrollView } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import * as SecureStore from 'expo-secure-store'
import { useResponsive } from '@/hooks/useResponsive'

type CashSessionRow = {
  id: string
  staff_id: string
  opened_at: string
  closed_at: string | null
  opening_float: number
  closing_amount: number | null
  recorded_sales_cash: number | null
  recorded_sales_card: number | null
  status: 'open' | 'closed'
}

async function fetchFinance(): Promise<{ branchId: string | null; branchName: string | null; open: CashSessionRow[]; recent: CashSessionRow[]; staffMap: Map<string, string> }> {
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id || null
  if (!uid) return { branchId: null, branchName: null, open: [], recent: [], staffMap: new Map() }
  const { data: prof } = await supabase.from('profiles').select('branch_id, role').eq('id', uid).maybeSingle()
  let branchId = (prof as any)?.branch_id ?? null
  const role = String((prof as any)?.role || '').toLowerCase()
  const isSuper = ['super_admin','admin'].includes(role)
  if (isSuper) {
    try { const ov = await SecureStore.getItemAsync(`admin_active_branch_id:${uid}`); if (ov) branchId = ov } catch {}
  }
  if (!branchId) return { branchId, branchName: null, open: [], recent: [], staffMap: new Map() }
  const { data: br } = await supabase.from('branches').select('name').eq('id', branchId).maybeSingle()
  const branchName = (br as any)?.name ?? null

  const { data: open } = await supabase
    .from('cash_sessions')
    .select('id, staff_id, opened_at, closed_at, opening_float, closing_amount, recorded_sales_cash, recorded_sales_card, status')
    .eq('branch_id', branchId)
    .eq('status', 'open' as any)
    .order('opened_at', { ascending: false })

  const { data: recent } = await supabase
    .from('cash_sessions')
    .select('id, staff_id, opened_at, closed_at, opening_float, closing_amount, recorded_sales_cash, recorded_sales_card, status')
    .eq('branch_id', branchId)
    .eq('status', 'closed' as any)
    .order('closed_at', { ascending: false })
    .limit(50)

  const staffIds = Array.from(new Set([...(open ?? []), ...(recent ?? [])].map((s: any) => s.staff_id))).filter(Boolean) as string[]
  let staffMap = new Map<string, string>()
  if (staffIds.length > 0) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', staffIds)
    staffMap = new Map((profs ?? []).map((p: any) => [String(p.id), String(p.full_name || p.id)]))
  }

  return {
    branchId,
    branchName,
    open: (open ?? []).map((s: any) => ({ ...s, opening_float: Number(s.opening_float ?? 0), closing_amount: s.closing_amount != null ? Number(s.closing_amount) : null, recorded_sales_cash: s.recorded_sales_cash != null ? Number(s.recorded_sales_cash) : null, recorded_sales_card: s.recorded_sales_card != null ? Number(s.recorded_sales_card) : null })),
    recent: (recent ?? []).map((s: any) => ({ ...s, opening_float: Number(s.opening_float ?? 0), closing_amount: s.closing_amount != null ? Number(s.closing_amount) : null, recorded_sales_cash: s.recorded_sales_cash != null ? Number(s.recorded_sales_cash) : null, recorded_sales_card: s.recorded_sales_card != null ? Number(s.recorded_sales_card) : null })),
    staffMap,
  }
}

export function FinanceScreen() {
  const nav = useNavigation<any>()
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const { spacing, font, maxContentWidth } = useResponsive()
  const { data, isLoading, isFetching, refetch } = useQuery({ queryKey: ['admin_finance'], queryFn: fetchFinance, refetchInterval: 30000 })
  const branchName = data?.branchName || '-'
  const open = (data?.open ?? []) as CashSessionRow[]
  const recent = (data?.recent ?? [])
    .slice()
    .sort((a, b) => {
      const ca = a.closed_at ? new Date(a.closed_at).getTime() : new Date(a.opened_at).getTime()
      const cb = b.closed_at ? new Date(b.closed_at).getTime() : new Date(b.opened_at).getTime()
      return cb - ca
    }) as CashSessionRow[]
  const staffName = (id?: string | null) => (id ? (data?.staffMap?.get(id) || `#${String(id).slice(0,6)}`) : '-')
  const [busy, setBusy] = useState<string | null>(null)

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8), alignItems: 'center' },
    header: { height: 50, paddingHorizontal: Math.round(spacing.sm), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: AdminColors.border, width: '100%', maxWidth: maxContentWidth },
    title: { color: AdminColors.text, fontWeight: '800', fontSize: font.h2 },
    link: { color: AdminColors.accent, fontWeight: '600' },
    sub: { color: AdminColors.subtext, padding: Math.round(spacing.sm) },
    card: { margin: Math.round(spacing.md), backgroundColor: AdminColors.card, borderRadius: Math.max(10, Math.round(spacing.sm)), borderWidth: 1, borderColor: AdminColors.border, padding: Math.round(spacing.md), width: 'auto' },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Math.round(spacing.xs) },
    value: { color: AdminColors.text, fontWeight: '800' },
    btn: { paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.xs), borderRadius: 999, backgroundColor: AdminColors.accent },
    btnText: { color: '#1a1a1a', fontWeight: '700' },
    leftWrap: { flex: 1, paddingRight: 8, flexShrink: 1 },
    rightValue: { textAlign: 'right' },
  }), [isDark, insets.top, insets.bottom, spacing, font, maxContentWidth])

  const startSession = async () => {
    if (!data?.branchId) return
    try {
      setBusy('start')
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id || null
      if (!uid) return
      await supabase.from('cash_sessions').insert({ branch_id: data.branchId as any, staff_id: uid as any, opening_float: 0, status: 'open' as any })
      await refetch()
    } finally {
      setBusy(null)
    }
  }

  const closeSession = async (s: CashSessionRow) => {
    try {
      setBusy(s.id)
      // Compute recorded cash by payments after opened_at (until now)
      const { data: pays } = await supabase
        .from('payments')
        .select('amount, is_refund, method, created_at')
        .eq('branch_id', data?.branchId as any)
        .eq('method', 'cash' as any)
        .gte('created_at', s.opened_at)
      const totalCash = (pays ?? []).reduce((sum: number, p: any) => sum + (p.is_refund ? -1 : 1) * Number(p.amount ?? 0), 0)
      const closedAt = new Date().toISOString()
      await supabase
        .from('cash_sessions')
        .update({ recorded_sales_cash: totalCash, closing_amount: totalCash, status: 'closed' as any, closed_at: closedAt as any })
        .eq('id', s.id)
      await refetch()
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={styles.link}>Back</Text></TouchableOpacity>
        <Text style={styles.title}>Finance</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.sub}>Branch: {branchName}</Text>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={AdminColors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.title}>Open sessions</Text>
              <TouchableOpacity onPress={startSession} style={styles.btn} disabled={busy==='start'}>
                <Text style={styles.btnText}>{busy==='start' ? 'Starting…' : 'Start session'}</Text>
              </TouchableOpacity>
            </View>
            {open.length === 0 ? (
              <Text style={styles.sub}>No open sessions</Text>
            ) : open.map((s) => (
              <View key={s.id} style={styles.row}>
                <View style={styles.leftWrap}>
                  <Text style={styles.sub}>#{s.id.slice(0,6)} • {staffName(s.staff_id)} • {new Date(s.opened_at).toLocaleString()}</Text>
                </View>
                <TouchableOpacity onPress={() => closeSession(s)} style={styles.btn} disabled={busy===s.id}>
                  <Text style={styles.btnText}>{busy===s.id ? 'Closing…' : 'Close now'}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>Recent closed</Text>
            {recent.length === 0 ? (
              <Text style={styles.sub}>No recent sessions</Text>
            ) : recent.map((s) => {
              const closedAt = s.closed_at ? new Date(s.closed_at).toLocaleString() : new Date(s.opened_at).toLocaleString()
              const opening = Number(s.opening_float ?? 0)
              const cash = Number(s.recorded_sales_cash ?? 0)
              const card = Number(s.recorded_sales_card ?? 0)
              const closing = Number(s.closing_amount ?? 0)
              const variance = closing - (opening + cash + card)
              return (
                <View key={s.id} style={{ paddingVertical: 6 }}>
                  <View style={styles.row}>
                    <View style={styles.leftWrap}><Text style={styles.sub}>#{s.id.slice(0,6)} • {staffName(s.staff_id)} • {closedAt}</Text></View>
                    <Text style={[styles.value, styles.rightValue]}>{closing.toFixed(2)} ETB</Text>
                  </View>
                  <View style={styles.row}>
                    <View style={styles.leftWrap}><Text style={styles.sub}>Opening</Text></View>
                    <Text style={[styles.sub, styles.rightValue]}>{opening.toFixed(2)} ETB</Text>
                  </View>
                  <View style={styles.row}>
                    <View style={styles.leftWrap}><Text style={styles.sub}>Cash recorded</Text></View>
                    <Text style={[styles.sub, styles.rightValue]}>{cash.toFixed(2)} ETB</Text>
                  </View>
                  {!!card && (
                    <View style={styles.row}>
                      <View style={styles.leftWrap}><Text style={styles.sub}>Card recorded</Text></View>
                      <Text style={[styles.sub, styles.rightValue]}>{card.toFixed(2)} ETB</Text>
                    </View>
                  )}
                  <View style={styles.row}>
                    <View style={styles.leftWrap}><Text style={styles.sub}>Variance</Text></View>
                    <Text style={[styles.sub, styles.rightValue, { color: variance === 0 ? AdminColors.subtext : AdminColors.accent }]}>{variance.toFixed(2)} ETB</Text>
                  </View>
                </View>
              )
            })}
          </View>
        </ScrollView>
      )}
    </View>
  )
}
