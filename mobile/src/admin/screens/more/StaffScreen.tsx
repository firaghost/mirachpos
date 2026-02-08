import React, { useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, TextInput, Alert, Modal, ScrollView } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import * as SecureStore from 'expo-secure-store'
import { useResponsive } from '@/hooks/useResponsive'

type StaffRow = { id: string; full_name: string | null; role: string | null; branch_id: string | null }

async function fetchStaff(): Promise<{ list: StaffRow[]; activeBranchId: string | null; branchName: string | null }> {
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id || null
  if (!uid) return { list: [], activeBranchId: null, branchName: null }
  const { data: prof } = await supabase.from('profiles').select('organization_id, branch_id').eq('id', uid).maybeSingle()
  const orgId = (prof as any)?.organization_id ?? null
  let branchId = (prof as any)?.branch_id ?? null
  try { const ov = await SecureStore.getItemAsync('admin_active_branch_id'); if (ov) branchId = ov } catch {}
  const { data: branch } = branchId ? await supabase.from('branches').select('name').eq('id', branchId).maybeSingle() : { data: null }
  const branchName = (branch as any)?.name ?? null
  if (!orgId) return { list: [], activeBranchId: branchId, branchName }
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role, branch_id')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })
  const list = (data ?? []).map((r: any) => ({ id: String(r.id), full_name: r.full_name as string | null, role: r.role as string | null, branch_id: r.branch_id as string | null }))
  return { list, activeBranchId: branchId, branchName }
}

export function StaffScreen() {
  const nav = useNavigation<any>()
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const { spacing, font, maxContentWidth } = useResponsive()
  const { data, isLoading, isFetching, refetch } = useQuery({ queryKey: ['admin_staff'], queryFn: fetchStaff })
  const list = ((data?.list ?? []) as StaffRow[]).filter((r) => String(r.role || '').toLowerCase() !== 'super_admin')
  const activeBranchId = data?.activeBranchId ?? null
  const activeBranchName = data?.branchName ?? null
  const [formFullName, setFormFullName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formRole, setFormRole] = useState<'waiter' | 'cashier' | 'manager' | 'branch_admin'>('waiter')
  const [busyCreate, setBusyCreate] = useState(false)
  const [createResult, setCreateResult] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'waiter' | 'cashier' | 'manager' | 'branch_admin'>('all')
  const [branchFilter, setBranchFilter] = useState<'all' | 'this' | 'other' | 'none'>('all')
  const [search, setSearch] = useState('')
  const [resetPwMap, setResetPwMap] = useState<Record<string, string>>({})
  const [selectionMode, setSelectionMode] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState<Record<string, true>>({})
  // Manage modal state
  const [manageOpen, setManageOpen] = useState(false)
  const [manageTarget, setManageTarget] = useState<StaffRow | null>(null)
  const [manageName, setManageName] = useState('')
  const [manageEmail, setManageEmail] = useState('')
  const [manageRole, setManageRole] = useState<'waiter' | 'cashier' | 'manager' | 'branch_admin'>('waiter')
  const [manageAssigned, setManageAssigned] = useState<boolean>(false)

  // Derived filtered list (top-level hook; do not put hooks inside conditional JSX)
  const filteredList = useMemo(() => {
    const text = search.trim().toLowerCase()
    return list.filter((s) => {
      if (roleFilter !== 'all' && String(s.role || '') !== roleFilter) return false
      if (branchFilter === 'this' && s.branch_id !== activeBranchId) return false
      if (branchFilter === 'other' && (!!s.branch_id && s.branch_id === activeBranchId)) return false
      if (branchFilter === 'none' && !!s.branch_id) return false
      if (!text) return true
      const nm = (s.full_name || '').toLowerCase()
      return nm.includes(text) || s.id.toLowerCase().includes(text)
    })
  }, [list, roleFilter, branchFilter, search, activeBranchId])

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8), alignItems: 'center' },
    header: { height: 50, paddingHorizontal: Math.round(spacing.sm), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: AdminColors.border, width: '100%', maxWidth: maxContentWidth },
    title: { color: AdminColors.text, fontWeight: '800', fontSize: font.h2 },
    link: { color: AdminColors.accent, fontWeight: '600' },
    sub: { color: AdminColors.subtext, padding: Math.round(spacing.sm), fontSize: font.small },
    row: { marginHorizontal: Math.round(spacing.sm), marginTop: Math.round(spacing.sm), backgroundColor: AdminColors.card, borderRadius: Math.max(10, Math.round(spacing.sm)), borderWidth: 1, borderColor: AdminColors.border, padding: Math.round(spacing.sm), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    card: { marginHorizontal: Math.round(spacing.sm), marginTop: Math.round(spacing.sm), backgroundColor: AdminColors.card, borderRadius: Math.max(10, Math.round(spacing.sm)), borderWidth: 1, borderColor: AdminColors.border, padding: Math.round(spacing.sm), overflow: 'hidden' },
    input: { width: '100%', backgroundColor: AdminColors.surface, borderRadius: 10, paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.xs), color: AdminColors.text, borderWidth: 1, borderColor: AdminColors.border },
    segChip: { paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.xs), borderRadius: 999, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border },
    segChipActive: { backgroundColor: AdminColors.accent, borderColor: AdminColors.accent },
    segText: { color: AdminColors.subtext, fontSize: font.small, fontWeight: '700' },
    segTextActive: { color: '#1a1a1a' },
    btn: { paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.xs), borderRadius: 999, backgroundColor: AdminColors.accent },
    btnText: { color: '#1a1a1a', fontWeight: '700' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    modalCard: { backgroundColor: AdminColors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: Math.round(spacing.md), borderWidth: 1, borderColor: AdminColors.border, maxHeight: '80%' },
  }), [isDark, insets.top, insets.bottom, spacing, font, maxContentWidth])

  const assignToActive = async (id: string) => {
    if (!activeBranchId) return
    try {
      const { data, error } = await supabase.functions.invoke('admin-staff', { body: { action: 'assign_branch', userId: id, branch_id: activeBranchId } })
      if (error || (data as any)?.error) throw (error || (data as any)?.error)
      await refetch()
    } catch (e) {
      // keep silent
    }
  }
  const removeFromBranch = async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-staff', { body: { action: 'assign_branch', userId: id, branch_id: null } })
      if (error || (data as any)?.error) throw (error || (data as any)?.error)
      await refetch()
    } catch (e) {
      // keep silent
    }
  }
  const deactivate = async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-staff', { body: { action: 'deactivate', userId: id } })
      if (error || (data as any)?.error) throw (error || (data as any)?.error)
      await refetch()
    } catch (e) {}
  }

  const setRole = async (id: string, role: 'waiter' | 'cashier' | 'manager' | 'branch_admin' | 'super_admin') => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-staff', { body: { action: 'set_role', userId: id, role } })
      if (error || (data as any)?.error) throw (error || (data as any)?.error)
      await refetch()
    } catch {}
  }

  const resetPassword = async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-staff', { body: { action: 'reset_password', userId: id } })
      if (error || (data as any)?.error) throw (error || (data as any)?.error)
      const temp = (data as any)?.tempPassword as string | undefined
      if (temp) {
        setResetPwMap((m) => ({ ...m, [id]: temp }))
        Alert.alert('Temporary password', temp)
      }
    } catch {}
  }

  // Inline edit helpers
  const updateProfile = async (id: string, name: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-staff', { body: { action: 'update_profile', userId: id, full_name: name } })
      if (error || (data as any)?.error) throw (error || (data as any)?.error)
      Alert.alert('Saved', 'Name updated')
      await refetch()
    } catch {}
  }

  const updateEmail = async (id: string, email: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-staff', { body: { action: 'update_email', userId: id, email } })
      if (error || (data as any)?.error) throw (error || (data as any)?.error)
      Alert.alert('Saved', 'Email updated')
      await refetch()
    } catch {}
  }

  // Bulk selection helpers
  const toggleSelected = (id: string) => {
    setSelected((m) => ({ ...m, [id]: m[id] ? (undefined as any) : true }))
  }
  const clearSelection = () => { setSelected({}); setSelectionMode(false) }

  const bulkAssign = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k])
    if (!activeBranchId || ids.length === 0) return
    await Promise.all(ids.map((id) => supabase.functions.invoke('admin-staff', { body: { action: 'assign_branch', userId: id, branch_id: activeBranchId } })))
    Alert.alert('Done', 'Assigned selected to branch')
    clearSelection(); await refetch()
  }
  const bulkRemove = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k])
    if (ids.length === 0) return
    await Promise.all(ids.map((id) => supabase.functions.invoke('admin-staff', { body: { action: 'assign_branch', userId: id, branch_id: null } })))
    Alert.alert('Done', 'Removed branch for selected')
    clearSelection(); await refetch()
  }
  const bulkRole = async (role: 'waiter' | 'cashier' | 'manager' | 'branch_admin') => {
    const ids = Object.keys(selected).filter((k) => selected[k])
    if (ids.length === 0) return
    await Promise.all(ids.map((id) => supabase.functions.invoke('admin-staff', { body: { action: 'set_role', userId: id, role } })))
    Alert.alert('Done', 'Roles updated')
    clearSelection(); await refetch()
  }
  const bulkReset = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k])
    if (ids.length === 0) return
    await Promise.all(ids.map((id) => supabase.functions.invoke('admin-staff', { body: { action: 'reset_password', userId: id } })))
    Alert.alert('Done', 'Temporary passwords generated')
    clearSelection(); await refetch()
  }
  const bulkDeactivate = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k])
    if (ids.length === 0) return
    await Promise.all(ids.map((id) => supabase.functions.invoke('admin-staff', { body: { action: 'deactivate', userId: id } })))
    Alert.alert('Done', 'Deactivated selected')
    clearSelection(); await refetch()
  }

  const renderItem = ({ item }: { item: StaffRow }) => {
    const name = item.full_name || `#${item.id.slice(0,6)}`
    const role = String(item.role || '—')
    const inThis = activeBranchId && item.branch_id === activeBranchId
    return (
      <View style={styles.row}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          {selectionMode && (
            <TouchableOpacity onPress={() => toggleSelected(item.id)} style={[styles.segChip, selected[item.id] && styles.segChipActive]}>
              <Text style={[styles.segText, selected[item.id] && styles.segTextActive]}>{selected[item.id] ? '✓' : 'Select'}</Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{name}</Text>
            <Text style={styles.sub}>{role}{item.branch_id && !inThis ? ' • other branch' : ''}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => { setManageTarget(item); setManageName(item.full_name || ''); setManageEmail(''); setManageRole((item.role as any) || 'waiter'); setManageAssigned(!!(activeBranchId && item.branch_id === activeBranchId)); setManageOpen(true) }}>
          <Text style={styles.link}>Manage</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={styles.link}>Back</Text></TouchableOpacity>
        <Text style={styles.title}>Staff</Text>
        <View style={{ width: 40 }} />
      </View>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={AdminColors.accent} /></View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(s) => s.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
          onRefresh={() => refetch()}
          refreshing={isFetching}
          ListHeaderComponent={
            <View>
              <Text style={styles.sub}>Branch: {activeBranchName || '-'}</Text>
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                <TextInput placeholder="Search name or id" placeholderTextColor={AdminColors.subtext} value={search} onChangeText={setSearch} style={styles.input} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity onPress={() => setFiltersOpen(true)} style={[styles.segChip]}>
                    <Text style={styles.segText}>Filters</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setSelectionMode(!selectionMode)} style={[styles.segChip, selectionMode && styles.segChipActive]}>
                    <Text style={[styles.segText, selectionMode && styles.segTextActive]}>{selectionMode ? 'Selecting…' : 'Select multiple'}</Text>
                  </TouchableOpacity>
                  {selectionMode && (
                    <>
                      <TouchableOpacity onPress={bulkAssign} style={[styles.segChip, styles.segChipActive]}>
                        <Text style={styles.segTextActive}>Assign</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={bulkRemove} style={styles.segChip}>
                        <Text style={styles.segText}>Remove</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
              
              {/* Create Staff */}
              <View style={[styles.card, { marginTop: 12 }]}>
                <Text style={styles.title}>Create staff</Text>
                <View style={{ height: 8 }} />
                <TextInput placeholder="Full name" placeholderTextColor={AdminColors.subtext} style={styles.input}
                  value={formFullName} onChangeText={setFormFullName} />
                <View style={{ height: 8 }} />
                <TextInput placeholder="Email" keyboardType="email-address" placeholderTextColor={AdminColors.subtext} style={styles.input}
                  value={formEmail} onChangeText={setFormEmail} autoCapitalize="none" />
                <View style={{ height: 8 }} />
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {(['waiter','cashier','manager','branch_admin'] as const).map((r) => (
                    <TouchableOpacity key={r} onPress={() => setFormRole(r)} style={[styles.segChip, formRole===r && styles.segChipActive]}>
                      <Text style={[styles.segText, formRole===r && styles.segTextActive]}>{r.replace('_',' ')}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ height: 10 }} />
                <TouchableOpacity disabled={busyCreate} onPress={async () => {
                  try {
                    setBusyCreate(true)
                    const { data, error } = await supabase.functions.invoke('admin-staff', {
                      body: { action: 'create', email: formEmail, full_name: formFullName, role: formRole, branch_id: activeBranchId }
                    })
                    if (error || (data as any)?.error) throw (error || (data as any)?.error)
                    const temp = (data as any)?.tempPassword as string | undefined
                    setCreateResult(temp ? `Temp password: ${temp}` : 'Created.')
                    setFormEmail(''); setFormFullName(''); setFormRole('waiter')
                    await refetch()
                  } catch (e) {
                    setCreateResult('Failed to create staff')
                  } finally { setBusyCreate(false) }
                }} style={[styles.btn, { alignSelf: 'flex-start' }]}>
                  <Text style={styles.btnText}>{busyCreate ? 'Creating…' : 'Create'}</Text>
                </TouchableOpacity>
                {!!createResult && (<Text style={[styles.sub, { paddingHorizontal: 0, marginTop: 6 }]}>{createResult}</Text>)}
              </View>
            </View>
          }
          ListEmptyComponent={<Text style={styles.sub}>No staff</Text>}
        />
      )}
      {/* Manage Modal */}
      <Modal visible={manageOpen} transparent animationType="slide" onRequestClose={() => setManageOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              <Text style={styles.title}>Manage staff</Text>
              <View style={{ height: 8 }} />
              <TextInput value={manageName} onChangeText={setManageName} placeholder="Full name" placeholderTextColor={AdminColors.subtext} style={styles.input} />
              <View style={{ height: 6 }} />
              <TextInput value={manageEmail} onChangeText={setManageEmail} placeholder="Email (optional)" placeholderTextColor={AdminColors.subtext} keyboardType="email-address" autoCapitalize="none" style={styles.input} />
              <View style={{ height: 8 }} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(['waiter','cashier','manager','branch_admin'] as const).map((r) => (
                  <TouchableOpacity key={r} onPress={() => setManageRole(r)} style={[styles.segChip, manageRole===r && styles.segChipActive]}>
                    <Text style={[styles.segText, manageRole===r && styles.segTextActive]}>{r.replace('_',' ')}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {activeBranchId && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity onPress={() => setManageAssigned(true)} style={[styles.segChip, manageAssigned && styles.segChipActive]}>
                    <Text style={[styles.segText, manageAssigned && styles.segTextActive]}>Assign to this branch</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setManageAssigned(false)} style={[styles.segChip, !manageAssigned && styles.segChipActive]}>
                    <Text style={[styles.segText, !manageAssigned && styles.segTextActive]}>Remove from branch</Text>
                  </TouchableOpacity>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <TouchableOpacity onPress={async () => { if (!manageTarget) return; try {
                  if (manageName && manageName !== (manageTarget.full_name||'')) await updateProfile(manageTarget.id, manageName)
                  if (manageEmail) await updateEmail(manageTarget.id, manageEmail)
                  if (manageRole !== (manageTarget.role as any)) await setRole(manageTarget.id, manageRole)
                  if (activeBranchId) {
                    const wantAssign = manageAssigned
                    const isAssigned = !!(activeBranchId && manageTarget.branch_id === activeBranchId)
                    if (wantAssign && !isAssigned) await assignToActive(manageTarget.id)
                    if (!wantAssign && isAssigned) await removeFromBranch(manageTarget.id)
                  }
                  await refetch(); setManageOpen(false)
                } catch {} }} style={styles.btn}>
                  <Text style={styles.btnText}>Save</Text>
                </TouchableOpacity>
                {manageTarget && (
                  <>
                    <TouchableOpacity onPress={async () => { await resetPassword(manageTarget.id) }} style={[styles.segChip, styles.segChipActive]}>
                      <Text style={styles.segTextActive}>Reset password</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={async () => { await deactivate(manageTarget.id); setManageOpen(false); await refetch() }} style={[styles.segChip, { backgroundColor: '#e11d48', borderColor: '#e11d48' }]}>
                      <Text style={styles.segTextActive}>Deactivate</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity onPress={() => setManageOpen(false)} style={styles.segChip}>
                  <Text style={styles.segText}>Close</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <View style={{ height: 8 }} />
    </View>
  )
}
