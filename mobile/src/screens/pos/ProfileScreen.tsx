import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native'
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'
import * as Updates from 'expo-updates'
import Constants from 'expo-constants'
import { supabase } from '@/lib/supabase'
import { getLastProfile } from '@/lib/db'
import { ConfirmSheet } from '@/components/ui/confirm-sheet'
import * as SecureStore from 'expo-secure-store'

interface Props {
  onConfigurePin: () => void
  onLogout: () => void
}

export function ProfileScreen({ onConfigurePin, onLogout }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [branchName, setBranchName] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const { isDark } = useAppTheme()

  const initials = useMemo(() => {
    const src = name || email
    const parts = (src || '').trim().split(/\s+/)
    const i = parts.slice(0, 2).map(p => p[0]?.toUpperCase()).filter(Boolean).join('')
    return i || 'U'
  }, [name, email])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) {
          // Lightweight offline fallback from SQLite kv
          const lp = await getLastProfile()
          if (lp) {
            setEmail('')
            setName('')
            setRole((lp.role as any) ?? null)
            setPhone(null)
            setBranchName(null)
            setOrgName(null)
            return
          }
          throw new Error('Not authenticated')
        }
        setEmail(user.email ?? '')

        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle()

        const fullName = (profile as any)?.full_name ?? (profile as any)?.name ?? (user.user_metadata as any)?.full_name ?? ''
        setName(fullName)
        setRole(((profile as any)?.role as string) ?? ((user.user_metadata as any)?.role as string) ?? null)
        setPhone(((profile as any)?.phone as string) ?? null)

        const branchId = (profile as any)?.branch_id as string | null
        const orgId = (profile as any)?.organization_id as string | null

        let branchNameVal: string | null = null
        let orgNameVal: string | null = null
        if (branchId) {
          const { data: branchRow } = await supabase.from('branches').select('name').eq('id', branchId).maybeSingle()
          branchNameVal = (branchRow as any)?.name ?? null
          setBranchName(branchNameVal)
        }
        if (orgId) {
          const { data: orgRow } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle()
          orgNameVal = (orgRow as any)?.name ?? null
          setOrgName(orgNameVal)
        }
        // No extra caching; last_profile is set elsewhere and used as lightweight fallback
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, padding: 16 },
    title: { fontSize: 18, fontWeight: '700', color: AdminColors.text, marginBottom: 12 },
    center: { alignItems: 'center', justifyContent: 'center' },
    loading: { marginTop: 6, color: AdminColors.subtext },
    error: { color: AdminColors.danger },
    heroCard: { flexDirection: 'row', backgroundColor: AdminColors.card, borderRadius: 12, borderWidth: 1, borderColor: AdminColors.border, padding: 16, alignItems: 'center', marginBottom: 12 },
    avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: AdminColors.accent, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#1a1a1a', fontWeight: '800', fontSize: 18 },
    name: { fontSize: 16, fontWeight: '700', color: AdminColors.text },
    email: { color: AdminColors.subtext, marginTop: 2 },
    badgesRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
    badge: { backgroundColor: AdminColors.surface, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, fontSize: 12, overflow: 'hidden', color: AdminColors.text, marginRight: 6, marginBottom: 6 },
    badgeDark: { backgroundColor: AdminColors.accent, color: '#1a1a1a' },
    card: { backgroundColor: AdminColors.card, borderRadius: 12, borderWidth: 1, borderColor: AdminColors.border, overflow: 'hidden', marginBottom: 12 },
    row: { paddingHorizontal: 16, paddingVertical: 14 },
    rowText: { fontSize: 14, fontWeight: '600', color: AdminColors.text },
    divider: { height: 1, backgroundColor: AdminColors.border },
    infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: AdminColors.border },
    infoLabel: { color: AdminColors.subtext },
    infoValue: { fontWeight: '600', color: AdminColors.text },
    meta: { marginTop: 12 },
    metaText: { color: AdminColors.subtext, fontSize: 12 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: AdminColors.subtext, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
    segment: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 12 },
    segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border, paddingVertical: 10, borderRadius: 10, marginHorizontal: 4 },
    segmentItemActive: { backgroundColor: AdminColors.accent, borderColor: AdminColors.accent },
    segmentLabel: { fontSize: 13, fontWeight: '600', color: AdminColors.text },
    segmentLabelActive: { color: '#1a1a1a' },
    segmentHint: { color: AdminColors.subtext, fontSize: 12, paddingHorizontal: 16, paddingBottom: 12 },
  }), [isDark])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={AdminColors.accent} /><Text style={styles.loading}>Loading…</Text></View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <>
          <View style={styles.heroCard}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.name}>{name || 'Unnamed user'}</Text>
              <Text style={styles.email}>{email}</Text>
              <View style={styles.badgesRow}>
                {!!role && <Text style={[styles.badge, styles.badgeDark]}>{role}</Text>}
                {!!branchName && <Text style={styles.badge}>Branch: {branchName}</Text>}
                {!!orgName && <Text style={styles.badge}>Org: {orgName}</Text>}
              </View>
            </View>
          </View>

          <View style={styles.card}>
            {!!phone && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>{phone}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{email}</Text>
            </View>
          </View>

          

          <View style={styles.card}>
            <TouchableOpacity
              style={styles.row}
              onPress={async () => {
                try {
                  if ((Constants as any)?.appOwnership === 'expo') {
                    Alert.alert('Not supported in Expo Go', 'Use a dev/preview build to test notifications.')
                    return
                  }
                  const Notifications: any = await import('expo-notifications')
                  try {
                    await Notifications.setNotificationChannelAsync('default', { name: 'default' })
                  } catch {}
                  await Notifications.scheduleNotificationAsync({
                    content: { title: 'Test notification', body: 'Hello from local test' },
                    trigger: null,
                  })
                } catch {}
              }}
            >
              <Text style={[styles.rowText, { color: AdminColors.accent }]}>Test notification (local)</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.row}
              onPress={async () => {
                try {
                  const appOwn = (Constants as any)?.appOwnership || 'unknown'
                  const projectId = ((Constants as any)?.easConfig?.projectId) || ((Constants as any)?.expoConfig?.extra?.eas?.projectId) || null
                  const Notifications: any = await import('expo-notifications')
                  let perm = 'unknown'
                  try { const { status } = await Notifications.getPermissionsAsync(); perm = status } catch {}
                  if (perm !== 'granted') {
                    try { const { status } = await Notifications.requestPermissionsAsync(); perm = status } catch {}
                  }
                  let token = null
                  try {
                    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {})
                    token = resp?.data || null
                  } catch (e: any) {
                    Alert.alert('Push debug', `Failed to get Expo token:\n${e?.message || String(e)}`)
                  }
                  try { await SecureStore.setItemAsync('tium_mobile_push_token', token || '') } catch {}
                  try {
                    const { data: { user } } = await supabase.auth.getUser()
                    if (user) {
                      const { data: prof } = await supabase.from('profiles').select('branch_id').eq('id', user.id).maybeSingle()
                      const bid = (prof as any)?.branch_id ?? null
                      await supabase.rpc('upsert_device_token', { p_token: token, p_platform: (Platform.OS as any), p_branch_id: bid })
                    }
                  } catch {}
                  Alert.alert('Push debug', `appOwnership: ${appOwn}\nperm: ${perm}\nprojectId: ${projectId || 'none'}\n${token ? 'token: ' + token : 'token: <none>'}`)
                } catch (e: any) {
                  Alert.alert('Push debug', e?.message || 'failed')
                }
              }}
            >
              <Text style={[styles.rowText, { color: AdminColors.accent }]}>Push debug (show token)</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.row}
              onPress={async () => {
                if (__DEV__) return
                if (!(Updates as any)?.isEnabled) return
                setChecking(true)
                try {
                  const res = await Updates.checkForUpdateAsync()
                  if (res.isAvailable) setUpdateOpen(true)
                } catch {}
                finally { setChecking(false) }
              }}
              disabled={checking}
            >
              <Text style={[styles.rowText, { color: checking ? AdminColors.subtext : AdminColors.accent }]}>{checking ? 'Checking…' : 'Check for updates'}</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.row} onPress={onConfigurePin}>
              <Text style={styles.rowText}>Change PIN</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.row}
              onPress={() => setLogoutOpen(true)}
            >
              <Text style={[styles.rowText, { color: AdminColors.danger }]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      <ConfirmSheet
        open={updateOpen}
        title="Update available"
        description="A new update is available. Download now?"
        confirmLabel={downloading ? 'Downloading…' : 'Download'}
        cancelLabel="Later"
        loading={downloading}
        onOpenChange={setUpdateOpen}
        onConfirm={async () => {
          try {
            setDownloading(true)
            await Updates.fetchUpdateAsync()
            setUpdateOpen(false)
            setRestartOpen(true)
          } catch {}
          finally { setDownloading(false) }
        }}
      />
      <ConfirmSheet
        open={restartOpen}
        title="Update downloaded"
        description="Restart the app to apply the update now?"
        confirmLabel="Restart"
        cancelLabel="Later"
        onOpenChange={setRestartOpen}
        onConfirm={async () => { try { await Updates.reloadAsync() } catch {} }}
      />
      <ConfirmSheet
        open={logoutOpen}
        title="Logout"
        description="Are you sure you want to logout?"
        confirmLabel="Logout"
        cancelLabel="Cancel"
        onOpenChange={setLogoutOpen}
        onConfirm={onLogout}
      />
    </View>
  )
}
