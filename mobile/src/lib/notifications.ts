import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform, Vibration, Alert } from 'react-native'
import * as Linking from 'expo-linking'
import { upsertNotification } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { useUiStore } from '@/state/uiStore'
import * as SecureStore from 'expo-secure-store'

async function getBranchId(userId: string): Promise<string | null> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('branch_id')
      .eq('id', userId)
      .maybeSingle()
    return (profile as any)?.branch_id ?? null
  } catch {
    return null
  }
}

async function upsertDeviceToken(params: { userId: string; branchId: string | null; token: string; provider: 'expo'; platform: 'ios' | 'android' }) {
  try {
    await supabase.rpc('upsert_device_token', {
      p_token: params.token,
      p_platform: params.platform,
      p_branch_id: params.branchId,
    })
    // Ensure row is active and marked as expo for audience resolution
    try {
      await (supabase as any)
        .from('device_tokens')
        .update({ is_active: true, provider: 'expo', branch_id: params.branchId })
        .eq('token', params.token)
    } catch {}
  } catch (e) {
    // ignore
  }
}

export async function registerAndSyncDeviceToken() {
  try {
    // Expo Go (SDK 53+) no longer supports remote notifications in expo-go
    // Skip registration in Expo Go; use a Development Build instead
    if ((Constants as any)?.appOwnership === 'expo') return
    if (!Device.isDevice) return

    // Dynamic import to avoid initializing the module in Expo Go
    const Notifications: any = await import('expo-notifications')

    // Configure foreground behavior (only in dev build / standalone)
    // Show alerts in foreground so users see banners when app is open
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    })

    // Android channels: set up before requesting permissions (Android 13+)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Operations',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 150, 150, 150],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      })
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      })
      await Notifications.setNotificationChannelAsync('marketing', {
        name: 'Marketing',
        importance: Notifications.AndroidImportance.LOW,
        vibrationPattern: [0, 100, 100, 100],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
      })
    }

    // iOS categories: add LOW_STOCK with a View action
    if (Platform.OS === 'ios') {
      try {
        await Notifications.setNotificationCategoryAsync('LOW_STOCK', [
          { identifier: 'VIEW', buttonTitle: 'View', options: { opensAppToForeground: true } },
        ])
      } catch {}
    }

    // Permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    if (finalStatus !== 'granted') return

    // Token
    const projectId =
      (Constants?.expoConfig as any)?.extra?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId ||
      undefined
    const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {})
    const token = tokenResp?.data
    if (!token) return
    try { await SecureStore.setItemAsync('tium_mobile_push_token', token) } catch {}

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const branchId = await getBranchId(user.id)
    await upsertDeviceToken({ userId: user.id, branchId, token, provider: 'expo', platform: Platform.OS as any })
    if (!branchId) return

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle()
      const name = ((profile as any)?.full_name as string) || (user.email || 'User')
      const identifier = `push:${user.id}:${branchId || 'none'}:${Platform.OS}`
      const nowIso = new Date().toISOString()
      const settings: any = { app: 'mobile', platform: Platform.OS, app_version: (Constants as any)?.expoConfig?.version || null, push_token: token }
      try { await supabase.from('devices').update({ name, type: 'pos' as any, branch_id: branchId, last_seen_at: nowIso, app: 'mobile' as any, platform: Platform.OS as any, app_version: ((Constants as any)?.expoConfig?.version || null) as any, status: 'online' as any, settings } as any).eq('identifier', identifier) } catch {}
      try { await supabase.from('devices').insert({ identifier, branch_id: branchId, type: 'pos' as any, name, last_seen_at: nowIso, app: 'mobile' as any, platform: Platform.OS as any, app_version: ((Constants as any)?.expoConfig?.version || null) as any, status: 'online' as any, settings } as any).select('id').single() } catch {}
    } catch {}
  } catch {
    // ignore errors quietly in registration
  }
}

type Intent = { type?: string | null; orderId?: string | null; link?: string | null; inventory_item_id?: string | null; name?: string | null; current?: number | null; threshold?: number | null }

function deriveIntent(data: any): Intent {
  try {
    const d = (data ?? {}) as any
    const type = (d.type as string | null) ?? (d.kind as string | null) ?? null
    const orderId = (d.orderId as string | null) ?? null
    const link = (d.link as string | null) ?? null
    const inventory_item_id = (d.inventory_item_id as string | null) ?? null
    const name = (d.name as string | null) ?? null
    const current = (typeof d.current === 'number') ? d.current : null
    const threshold = (typeof d.threshold === 'number') ? d.threshold : null
    return { type, orderId, link, inventory_item_id, name, current, threshold }
  } catch {
    return { type: null, orderId: null, link: null, inventory_item_id: null, name: null, current: null, threshold: null }
  }
}

function handleNavigationIntent(intent: Intent) {
  try {
    const { orderId, link, type, name, current, threshold } = intent
    if ((type || '').toLowerCase() === 'low_stock') {
      const title = 'Low stock'
      const body = `${name || 'Item'}: ${Number(current ?? 0)} / ${Number(threshold ?? 0)}`
      try { Alert.alert(title, body) } catch {}
      try { useUiStore.getState().setActiveTab('POS' as any) } catch {}
      return
    }
    if (orderId) {
      useUiStore.getState().setActiveTab('POS' as any)
      useUiStore.getState().openOrders(String(orderId))
      return
    }
    if (link) {
      const parsed = Linking.parse(link)
      const path = String(parsed?.path || '').toLowerCase()
      const segs = path.split('/').filter(Boolean)
      const first = segs[0] || ''
      const id = segs[1] || ''
      if (first === 'order' && id) {
        useUiStore.getState().setActiveTab('POS' as any)
        useUiStore.getState().openOrders(String(id))
        return
      }
      if ((first === 'payments' || first === 'payment') && id) {
        useUiStore.getState().setActiveTab('Payments' as any)
        useUiStore.getState().setFocusPaymentOrder(String(id))
        return
      }
    }
  } catch {}
}

export function setupNotificationListeners() {
  let subs: Array<{ remove: () => void }> = []
  let cancelled = false

  const enrichOrderBody = async (type: string, orderId: string): Promise<string | null> => {
    try {
      const { data: ord } = await supabase
        .from('orders')
        .select('table_id, tables(name)')
        .eq('id', orderId)
        .maybeSingle()
      const { data: items } = await supabase
        .from('order_items')
        .select('quantity, products(name)')
        .eq('order_id', orderId)
        .limit(3)
      const short = String(orderId).slice(0,6)
      const typeLabel = (ord as any)?.table_id ? 'Dine-in' : 'Takeaway'
      const tableName = (ord as any)?.tables?.[0]?.name || (ord as any)?.tables?.name || null
      const typePart = (ord as any)?.table_id ? (tableName ? `${typeLabel} • Table ${tableName}` : typeLabel) : typeLabel
      const preview = (items ?? []).map((r: any) => `${Number(r.quantity || 1)}× ${String(r.products?.name || 'Item')}`).join(', ')
      return preview ? `#${short} • ${typePart} • ${preview}` : `#${short} • ${typePart}`
    } catch { return null }
  }

  const onResponse = (resp: any) => {
    try {
      const data = resp?.notification?.request?.content?.data ?? null
      const title = resp?.notification?.request?.content?.title ?? 'Notification'
      const body = resp?.notification?.request?.content?.body ?? ''
      const type = (data?.type as string | null) ?? null
      ;(async () => {
        try {
          let id = String(data?.id || `push:${Date.now()}:${Math.random().toString(36).slice(2,7)}`)
          let finalBody = String(body)
          const orderId = data?.orderId as string | undefined
          if (type && (type === 'order_ready' || type === 'order_completed') && orderId) {
            id = `${type}:${orderId}`
            const enriched = await enrichOrderBody(type, orderId)
            if (enriched) finalBody = enriched
          }
          await upsertNotification({ id, title: String(title), body: finalBody, type, created_at: new Date().toISOString() })
        } catch {}
      })()
      const intent = deriveIntent(data)
      handleNavigationIntent(intent)
    } catch {}
  }

  ;(async () => {
    try {
      if ((Constants as any)?.appOwnership === 'expo') return
      const Notifications: any = await import('expo-notifications')
      const subRecv = Notifications.addNotificationReceivedListener(async (n: any) => {
        try { Vibration.vibrate([0, 250, 250, 250]) } catch {}
        try {
          const cur = await Notifications.getBadgeCountAsync()
          await Notifications.setBadgeCountAsync((Number(cur) || 0) + 1)
        } catch {}
        try {
          const title = n?.request?.content?.title ?? 'Notification'
          let body = n?.request?.content?.body ?? ''
          const data = n?.request?.content?.data ?? {}
          const type = (data?.type as string | null) ?? null
          let id = String(data?.id || `push:${Date.now()}:${Math.random().toString(36).slice(2,7)}`)
          const orderId = data?.orderId as string | undefined
          if (type && (type === 'order_ready' || type === 'order_completed') && orderId) {
            id = `${type}:${orderId}`
            const enriched = await enrichOrderBody(type, orderId)
            if (enriched) body = enriched
          }
          await upsertNotification({ id, title: String(title), body: String(body), type, created_at: new Date().toISOString() })
        } catch {}
      })
      const subResp = Notifications.addNotificationResponseReceivedListener(async (resp: any) => {
        try {
          const cur = await Notifications.getBadgeCountAsync()
          await Notifications.setBadgeCountAsync(Math.max(0, (Number(cur) || 0) - 1))
        } catch {}
        onResponse(resp)
      })
      subs = [subRecv, subResp]
      try {
        const last = await Notifications.getLastNotificationResponseAsync()
        if (last) onResponse(last)
      } catch {}
      if (cancelled) {
        try { subs.forEach((s) => s.remove()) } catch {}
        subs = []
      }
    } catch {}
  })()

  return () => {
    cancelled = true
    try { subs.forEach((s) => s.remove()) } catch {}
    subs = []
  }
}
