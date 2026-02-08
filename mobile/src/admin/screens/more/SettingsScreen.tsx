import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SecureStore from 'expo-secure-store'
import { supabase } from '@/lib/supabase'
import { useResponsive } from '@/hooks/useResponsive'

export function SettingsScreen() {
  const nav = useNavigation<any>()
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const { spacing, font, maxContentWidth } = useResponsive()
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)
  const [profileBranchName, setProfileBranchName] = useState<string>('-')
  const [isSuper, setIsSuper] = useState<boolean>(false)

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: prof } = await supabase.from('profiles').select('branch_id, role, organization_id').eq('id', user.id).maybeSingle()
        let profileBranchId = (prof as any)?.branch_id ?? null
        const role = String((prof as any)?.role || '').toLowerCase()
        const superFlag = ['super_admin','admin'].includes(role)
        setIsSuper(superFlag)
        if (profileBranchId) {
          const { data: br } = await supabase.from('branches').select('name').eq('id', profileBranchId).maybeSingle()
          setProfileBranchName(((br as any)?.name as string) || String(profileBranchId))
        }
        if (superFlag) {
          const orgId = (prof as any)?.organization_id ?? null
          const { data: brs } = await supabase.from('branches').select('id, name').order('name', { ascending: true }).eq('organization_id', orgId)
          setBranches((brs as any[])?.map((b: any) => ({ id: String(b.id), name: (b.name as string) || String(b.id) })) ?? [])
          const override = await SecureStore.getItemAsync('admin_active_branch_id')
          setActiveBranchId(override || null)
        } else {
          setBranches([])
          setActiveBranchId(null)
        }
      } catch {}
    })()
  }, [])

  const applyBranch = async (id: string | null) => {
    try {
      if (!isSuper) return
      if (id) await SecureStore.setItemAsync('admin_active_branch_id', id)
      else await SecureStore.deleteItemAsync('admin_active_branch_id')
      setActiveBranchId(id)
    } catch {}
  }

  const logout = async () => {
    try { await supabase.auth.signOut() } finally { try { nav.goBack() } catch {} }
  }

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8), alignItems: 'center' },
    header: { height: 50, paddingHorizontal: Math.round(spacing.sm), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: AdminColors.border, width: '100%', maxWidth: maxContentWidth },
    title: { color: AdminColors.text, fontWeight: '800', fontSize: font.h2 },
    link: { color: AdminColors.accent, fontWeight: '600' },
    sub: { color: AdminColors.subtext, padding: Math.round(spacing.sm), fontSize: font.small },
    card: { margin: Math.round(spacing.md), backgroundColor: AdminColors.card, borderRadius: Math.max(10, Math.round(spacing.sm)), borderWidth: 1, borderColor: AdminColors.border, padding: Math.round(spacing.md), width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
    sectionTitle: { color: AdminColors.text, fontWeight: '800', marginBottom: Math.round(spacing.xs), fontSize: font.body },
    segment: { flexDirection: 'row', backgroundColor: AdminColors.surface, borderRadius: 999, padding: 2, alignSelf: 'flex-start' },
    segChip: { paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.xs), borderRadius: 999 },
    segChipActive: { backgroundColor: AdminColors.accent },
    segText: { color: AdminColors.subtext, fontSize: font.small, fontWeight: '700' },
    segTextActive: { color: '#1a1a1a' },
  }), [isDark, insets.top, insets.bottom, spacing, font, maxContentWidth])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={styles.link}>Back</Text></TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Branch</Text>
        <Text style={styles.sub}>Default: {profileBranchName}</Text>
        {isSuper ? (
          <>
            <View style={{ height: 8 }} />
            <View style={{ gap: 8 }}>
              <TouchableOpacity onPress={() => applyBranch(null)} style={[styles.segChip, { alignSelf: 'flex-start' }, activeBranchId==null && styles.segChipActive]}>
                <Text style={[styles.segText, activeBranchId==null && styles.segTextActive]}>Use my default branch</Text>
              </TouchableOpacity>
              {branches.map((b) => (
                <TouchableOpacity key={b.id} onPress={() => applyBranch(b.id)} style={[styles.segChip, { alignSelf: 'flex-start' }, activeBranchId===b.id && styles.segChipActive]}>
                  <Text style={[styles.segText, activeBranchId===b.id && styles.segTextActive]}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.sub}>Branch switching is restricted for your role.</Text>
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity onPress={logout} style={[styles.segChip, { alignSelf: 'flex-start', backgroundColor: '#e11d48' }]}>
          <Text style={[styles.segText, { color: '#1a1a1a', fontWeight: '800' }]}>Logout</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.sub}>Branch, device, and app settings.</Text>
      </ScrollView>
    </View>
  )
}
