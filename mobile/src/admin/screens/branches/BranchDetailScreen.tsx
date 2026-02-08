import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native'
import { useRoute, useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '../../../theme/ThemeProvider'
import * as SecureStore from 'expo-secure-store'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function BranchDetailScreen() {
  const route = useRoute<any>()
  const nav = useNavigation<any>()
  const branchId = String(route.params?.branchId || '')
  const name = String(route.params?.name || '')
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()

  const [devices, setDevices] = useState<Array<{ id: string; status: string; last: string }>>([])
  const [staffOnline, setStaffOnline] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [isSuper, setIsSuper] = useState<boolean>(false)

  useEffect(() => {
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user?.id) {
          const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
          const role = String((profile as any)?.role || '').toLowerCase()
          setIsSuper(['super_admin','admin'].includes(role))
        }
      } catch {}
    })()
  }, [])

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
        // Devices list (online first)
        const { data: devs } = await supabase
          .from('devices')
          .select('id, status, last_seen_at, user_id')
          .eq('branch_id', branchId)
          .order('last_seen_at', { ascending: false })
        const dlist = (devs ?? []).map((d: any) => ({
          id: String(d?.id || ''),
          status: String(d?.status || (d?.last_seen_at && new Date(d.last_seen_at as string).toISOString() >= fiveMinAgo ? 'online' : 'offline')).toLowerCase(),
          last: d?.last_seen_at ? new Date(d.last_seen_at as string).toLocaleString() : '-',
          user_id: (d?.user_id as string | null) ?? null,
        }))
        setDevices(dlist)

        // Staff online by devices.user_id or by active orders
        const uids = Array.from(new Set(dlist.map((d) => d.user_id).filter(Boolean))) as string[]
        const staffMap = new Map<string, string>()
        if (uids.length > 0) {
          const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', uids)
          ;(profs ?? []).forEach((p: any) => staffMap.set(String(p.id), (p?.full_name as string) || 'User'))
        }
        // Add staff with active orders today
        const now = new Date(); const start = new Date(now); start.setHours(0,0,0,0)
        const { data: orders } = await supabase
          .from('orders')
          .select('staff_id, status, created_at')
          .eq('branch_id', branchId)
          .gte('created_at', start.toISOString())
        ;(orders ?? []).forEach((o: any) => {
          const st = String(o?.status || '').toLowerCase()
          if (['pending','preparing','served','confirmed'].includes(st) && o?.staff_id) {
            const k = String(o.staff_id)
            if (!staffMap.has(k)) staffMap.set(k, 'User')
          }
        })
        // Resolve any 'User' placeholders
        const unresolved = Array.from(staffMap.entries()).filter(([,v]) => v === 'User').map(([k]) => k)
        if (unresolved.length > 0) {
          const { data: extra } = await supabase.from('profiles').select('id, full_name').in('id', unresolved)
          ;(extra ?? []).forEach((p: any) => staffMap.set(String(p.id), (p?.full_name as string) || 'User'))
        }
        setStaffOnline(Array.from(staffMap.entries()).map(([id, full]) => ({ id, name: full })))
      } finally {
        setLoading(false)
      }
    })()
  }, [branchId])

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    headerBar: { height: 50, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: AdminColors.border },
    title: { color: AdminColors.text, fontWeight: '800' },
    link: { color: AdminColors.accent, fontWeight: '600' },
    sectionTitle: { color: AdminColors.text, fontWeight: '700', marginBottom: 6, marginTop: 6, paddingHorizontal: 2 },
    card: { backgroundColor: AdminColors.card, borderRadius: 14, borderWidth: 1, borderColor: AdminColors.border, padding: 12, marginBottom: 12 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    value: { color: AdminColors.text, fontWeight: '700' },
    sub: { color: AdminColors.subtext },
  }), [isDark, insets.top, insets.bottom])

  if (loading) return <View style={styles.center}><ActivityIndicator color={AdminColors.accent} /></View>

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={styles.link}>Back</Text></TouchableOpacity>
        <Text style={styles.title}>{name || 'Branch'}</Text>
        {isSuper ? (
          <TouchableOpacity onPress={async () => { try { await SecureStore.setItemAsync('admin_active_branch_id', branchId) } catch {} }}>
            <Text style={styles.link}>Use</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <Text style={styles.sectionTitle}>Staff online</Text>
        <View style={styles.card}>
          {staffOnline.length === 0 ? (
            <Text style={styles.sub}>No staff online</Text>
          ) : staffOnline.map((s) => (
            <View key={s.id} style={styles.row}><Text style={styles.value}>{s.name}</Text><Text style={styles.sub}>#{s.id.slice(0,6)}</Text></View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Devices</Text>
        <View style={styles.card}>
          {devices.length === 0 ? (
            <Text style={styles.sub}>No devices</Text>
          ) : devices.map((d) => (
            <View key={d.id} style={styles.row}><Text style={styles.value}>#{d.id.slice(0,6)}</Text><Text style={styles.sub}>{d.status} • {d.last}</Text></View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
