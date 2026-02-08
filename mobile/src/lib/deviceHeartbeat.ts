import { supabase } from '@/lib/supabase'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import Constants from 'expo-constants'

const CLIENT_ID_KEY = 'tium_mobile_device_client_id'
const DB_ID_KEY = 'tium_mobile_device_db_id'

function makeUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

async function getOrCreateClientId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(CLIENT_ID_KEY)
    if (existing) return existing
    const id = `mobile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await SecureStore.setItemAsync(CLIENT_ID_KEY, id)
    return id
  } catch {
    return `mobile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}

function getAppVersion(): string {
  try {
    // Prefer native versions
    const anyC: any = Constants
    return (
      anyC?.nativeAppVersion || anyC?.expoConfig?.version || anyC?.manifest?.version || 'mobile'
    )
  } catch {
    return 'mobile'
  }
}

export function startMobileHeartbeat() {
  let stopped = false
  let timer: any = null

  const beat = async () => {
    if (stopped) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, branch_id')
        .eq('id', user.id)
        .maybeSingle()
      const branchId = (profile as any)?.branch_id ?? null
      const userName = (profile as any)?.full_name ?? (user.email ?? 'User')

      if (!branchId) return
      const clientId = await getOrCreateClientId()
      const nowIso = new Date().toISOString()

      const settings: any = { app: 'mobile', platform: Platform.OS, app_version: getAppVersion(), last_user_id: user.id }
      try { await supabase.from('devices').update({ name: userName, type: 'pos' as any, branch_id: branchId, last_seen_at: nowIso, app: 'mobile' as any, platform: Platform.OS as any, app_version: getAppVersion() as any, status: 'online' as any, settings } as any).eq('identifier', clientId) } catch {}
      try { await supabase.from('devices').update({ name: userName, type: 'pos' as any, branch_id: branchId, last_seen_at: nowIso, settings }).eq('identifier', clientId) } catch {}
      try { await supabase.from('devices').insert({ identifier: clientId, branch_id: branchId, type: 'pos' as any, name: userName, last_seen_at: nowIso, app: 'mobile' as any, platform: Platform.OS as any, app_version: getAppVersion() as any, status: 'online' as any, settings } as any).select('id').single() } catch {}
      try { await supabase.from('devices').insert({ identifier: clientId, branch_id: branchId, type: 'pos' as any, name: userName, last_seen_at: nowIso, settings }).select('id').single() } catch {}
    } catch {}
  }

  // initial and interval
  beat()
  timer = setInterval(beat, 60_000)

  return () => { stopped = true; if (timer) clearInterval(timer) }
}

export async function registerDeviceOnce() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, branch_id')
      .eq('id', user.id)
      .maybeSingle()
    const branchId = (profile as any)?.branch_id ?? null
    const userName = (profile as any)?.full_name ?? (user.email ?? 'User')

    if (!branchId) return
    const clientId = await getOrCreateClientId()
    const nowIso = new Date().toISOString()
    const settings: any = { app: 'mobile', platform: Platform.OS, app_version: getAppVersion(), last_user_id: user.id }
    try { await supabase.from('devices').update({ name: userName, type: 'pos' as any, branch_id: branchId, last_seen_at: nowIso, app: 'mobile' as any, platform: Platform.OS as any, app_version: getAppVersion() as any, status: 'online' as any, settings } as any).eq('identifier', clientId) } catch {}
    try { await supabase.from('devices').update({ name: userName, type: 'pos' as any, branch_id: branchId, last_seen_at: nowIso, settings }).eq('identifier', clientId) } catch {}
    try { await supabase.from('devices').insert({ identifier: clientId, branch_id: branchId, type: 'pos' as any, name: userName, last_seen_at: nowIso, app: 'mobile' as any, platform: Platform.OS as any, app_version: getAppVersion() as any, status: 'online' as any, settings } as any).select('id').single() } catch {}
    try { await supabase.from('devices').insert({ identifier: clientId, branch_id: branchId, type: 'pos' as any, name: userName, last_seen_at: nowIso, settings }).select('id').single() } catch {}
  } catch {}
}
