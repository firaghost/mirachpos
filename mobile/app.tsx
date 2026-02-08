import 'react-native-url-polyfill/auto'
import { useEffect, useState, useRef } from 'react'
import { ActivityIndicator, View, AppState, type AppStateStatus } from 'react-native'
import { useFonts } from 'expo-font'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as SecureStore from 'expo-secure-store'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ThemeProvider } from './src/theme/ThemeProvider'
import { AdminColors } from './src/admin/theme/colors'
import { initLocalDb, upsertNotification } from '@/lib/db'
import { syncNotificationsForBranch } from '@/lib/offline/sync'
import { downsyncBranchData, processOutboxOnce } from '@/lib/offline/posSync'
import { LoginScreen } from '@/screens/LoginScreen'
import { RoleRouter } from './src/admin/navigation/RoleRouter'
import { PinLockScreen } from '@/screens/PinLock'
import { supabase } from '@/lib/supabase'
import * as Updates from 'expo-updates'
import Constants from 'expo-constants'
import { ConfirmSheet } from '@/components/ui/confirm-sheet'
import { registerAndSyncDeviceToken, setupNotificationListeners } from '@/lib/notifications'
import { startMobileHeartbeat, registerDeviceOnce } from '@/lib/deviceHeartbeat'
import { useMobileOrderStore } from '@/state/orderStore'
import { getStoredSession, logout as logoutMirach } from '@/lib/mirachposSession'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      staleTime: 60 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 1,
    },
  },
})

type Stage = 'checking' | 'login' | 'setupPin' | 'unlock' | 'app'

const PIN_KEY = 'tium_mobile_pin'
const STAFF_ID_KEY = 'tium_staff_id'

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
    BrandScript: require('./assets/fonts/Biframes-lxad5.otf'),
  })
  const [stage, setStage] = useState<Stage>('checking')
  const stageRef = useRef<Stage>('checking')
  const [hasPin, setHasPin] = useState(false)
  // Used only for the Security screen so it mounts with the correct mode
  const [setupIsChange, setSetupIsChange] = useState(false)
  // Update UI state
  const [updateOpen, setUpdateOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)

  const UPDATE_CHECK_KEY = 'last_update_check'

  const maybeCheckForUpdate = async (reason: 'startup' | 'foreground') => {
    try {
      if (__DEV__) return
      if (!Updates.isEnabled) return
      const now = Date.now()
      let last = 0
      try {
        const v = await SecureStore.getItemAsync(UPDATE_CHECK_KEY)
        last = v ? Number(v) : 0
      } catch {}
      const hoursSince = (now - last) / 3600000
      const randomGate = Math.random() < (reason === 'startup' ? 0.5 : 0.2)
      if (hoursSince < 6 && !randomGate) return
      const res = await Updates.checkForUpdateAsync()
      if (res.isAvailable) {
        setUpdateOpen(true)
      }
      await SecureStore.setItemAsync(UPDATE_CHECK_KEY, String(now))
    } catch {}
  }

  useEffect(() => {
    const bootstrap = async () => {
      await initLocalDb()

      try {
        const existingPin = await SecureStore.getItemAsync(PIN_KEY)
        const has = Boolean(existingPin)
        setHasPin(has)

        // Route immediately without waiting on network; avoids splash hang when online
        setStage(has ? 'unlock' : 'login')

        const session = await getStoredSession()
        if (session && !has) {
          setStage('app')
          try {
            const prevStaffId = await SecureStore.getItemAsync(STAFF_ID_KEY)
            const curStaffId = String(session.staffId || '')
            if (prevStaffId && curStaffId && prevStaffId !== curStaffId) {
              try {
                useMobileOrderStore.getState().clear()
              } catch {}
              try {
                await queryClient.clear()
              } catch {}
            }
            if (curStaffId) await SecureStore.setItemAsync(STAFF_ID_KEY, curStaffId)
          } catch {}
        }
      } catch {
        // On unexpected error, fall back to unlock if PIN exists, otherwise show login
        try {
          const existingPin = await SecureStore.getItemAsync(PIN_KEY)
          const has = Boolean(existingPin)
          setHasPin(has)
          setStage(has ? 'unlock' : 'login')
        } catch {
          setStage('login')
        }
      }
    }

    void bootstrap()
  }, [])

  // Keep a live ref of the stage so auth listener can make routing decisions
  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  // Polling fallback: order-ready (waiter/staff) and low-stock (admins)
  useEffect(() => {
    if (stage !== 'app') return
    let tReady: any = null
    let tLow: any = null
    let cancelled = false
    const READY_KEY = 'mobile_seen_ready_orders'
    const LOW_KEY = 'mobile_seen_low_stock_items'
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('branch_id, role')
          .eq('id', user.id)
          .maybeSingle()
        const branchId = (profile as any)?.branch_id as string | null
        const role = String((profile as any)?.role || '').toLowerCase()
        if (!branchId) return

        // Helper: load/set seen sets
        const loadSet = async (key: string): Promise<Set<string>> => {
          try {
            const raw = await SecureStore.getItemAsync(key)
            const arr = raw ? (JSON.parse(raw) as string[]) : []
            return new Set((arr || []).map((s) => String(s)))
          } catch { return new Set<string>() }
        }
        const saveSet = async (key: string, set: Set<string>) => {
          try { await SecureStore.setItemAsync(key, JSON.stringify(Array.from(set))) } catch {}
        }

        // Order-ready polling (for waiter-like roles)
        const waiterRoles = ['waiter','cashier','manager','branch_admin','super_admin']
        if (waiterRoles.includes(role)) {
          const pollReady = async () => {
            try {
              const seen = await loadSet(READY_KEY)
              const { data } = await supabase
                .from('orders')
                .select('id, status, table_id, tables(name)')
                .eq('branch_id', branchId)
                .eq('status', 'ready')
                .order('created_at', { ascending: false })
                .limit(30)
              const rows = data ?? []
              let changed = false
              for (const r of rows) {
                const id = String((r as any).id)
                if (!seen.has(id)) {
                  // Build enriched body: type + top 3 items
                  let body = `Order #${id.slice(0,6)} is ready`
                  try {
                    const typeLabel = (r as any)?.table_id ? 'Dine-in' : 'Takeaway'
                    const tableName = (r as any)?.tables?.[0]?.name || (r as any)?.tables?.name || null
                    const typePart = (r as any)?.table_id ? (tableName ? `${typeLabel} • Table ${tableName}` : typeLabel) : typeLabel
                    const { data: items } = await supabase
                      .from('order_items')
                      .select('quantity, products(name)')
                      .eq('order_id', id)
                      .limit(3)
                    const preview = (items ?? []).map((it: any) => `${Number(it.quantity || 1)}× ${String(it.products?.name || 'Item')}`).join(', ')
                    body = preview ? `#${id.slice(0,6)} • ${typePart} • ${preview}` : `#${id.slice(0,6)} • ${typePart}`
                  } catch {}
                  if ((Constants as any)?.appOwnership !== 'expo') {
                    const Notifications: any = await import('expo-notifications')
                    await Notifications.scheduleNotificationAsync({
                      content: { title: 'Order ready', body, data: { type: 'order_ready', orderId: id } },
                      trigger: null,
                    })
                  }
                  try { await upsertNotification({ id: `order_ready:${id}`, title: 'Order ready', body, type: 'order_ready', created_at: new Date().toISOString() }) } catch {}
                  seen.add(id)
                  changed = true
                }
              }
              if (changed) await saveSet(READY_KEY, seen)
            } catch {}
          }
          await pollReady()
          if (!cancelled) tReady = setInterval(pollReady, 20000)
        }

        // Low-stock polling (admins)
        const adminRoles = ['manager','branch_admin','super_admin','inventory_manager']
        if (adminRoles.includes(role)) {
          const pollLow = async () => {
            try {
              const seen = await loadSet(LOW_KEY)
              const { data } = await supabase
                .from('inventory_items')
                .select('id, name, unit, current_stock, low_stock_threshold')
                .eq('branch_id', branchId)
              const rows = data ?? []
              let changed = false
              for (const it of rows) {
                const id = String((it as any).id)
                const cur = Number((it as any).current_stock ?? 0)
                const thr = Number((it as any).low_stock_threshold ?? 0)
                if (thr > 0 && cur < thr && !seen.has(id)) {
                  if ((Constants as any)?.appOwnership !== 'expo') {
                    const Notifications: any = await import('expo-notifications')
                    await Notifications.scheduleNotificationAsync({
                      content: {
                        title: `Low stock: ${String((it as any).name || 'Item')}`,
                        body: `${String((it as any).name || 'Item')} is low: ${cur}/${thr} ${String((it as any).unit || '')}`,
                        data: { type: 'low_stock', inventory_item_id: id, name: String((it as any).name || 'Item'), current: cur, threshold: thr },
                      },
                      trigger: null,
                    })
                  }
                  try { await upsertNotification({ id, title: `Low stock: ${String((it as any).name || 'Item')}`, body: `${String((it as any).name || 'Item')} is low: ${cur}/${thr} ${String((it as any).unit || '')}`, type: 'low_stock', created_at: new Date().toISOString() }) } catch {}
                  seen.add(id)
                  changed = true
                }
              }
              if (changed) await saveSet(LOW_KEY, seen)
            } catch {}
          }
          await pollLow()
          if (!cancelled) tLow = setInterval(pollLow, 60000)
        }
      } catch {}
    })()
    return () => { cancelled = true; try { if (tReady) clearInterval(tReady) } catch {}; try { if (tLow) clearInterval(tLow) } catch {} }
  }, [stage])

  // Randomized background update checks after entering the app
  useEffect(() => {
    if (stage !== 'app') return
    ;(async () => { await maybeCheckForUpdate('startup') })()
  }, [stage])

  // Register push token once in-app
  useEffect(() => {
    if (stage !== 'app') return
    ;(async () => { try { await registerAndSyncDeviceToken() } catch {} })()
  }, [stage])

  // Push notification listeners (foreground, background tap, cold start tap)
  useEffect(() => {
    if (stage !== 'app') return
    const cleanup = setupNotificationListeners()
    return () => { try { cleanup && cleanup() } catch {} }
  }, [stage])

  // Device heartbeat: registers this device and updates last_seen periodically
  useEffect(() => {
    if (stage !== 'app') return
    const stop = startMobileHeartbeat()
    return () => { try { stop && stop() } catch {} }
  }, [stage])

  // Realtime: notify when orders in my branch become ready
  useEffect(() => {
    if (stage !== 'app') return
    let channel: any = null
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', user.id).maybeSingle()
        const branchId = (profile as any)?.branch_id as string | null
        if (!branchId) return
        channel = supabase
          .channel('mobile_order_ready')
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, async (payload: any) => {
            try {
              const newRow = payload?.new || {}
              if ((newRow.status || '').toLowerCase() === 'ready') {
                const orderId = String(newRow.id || '').slice(0, 6)
                // Avoid importing expo-notifications in Expo Go (SDK 53+) to prevent warnings
                if ((Constants as any)?.appOwnership !== 'expo') {
                  const Notifications: any = await import('expo-notifications')
                  await Notifications.scheduleNotificationAsync({
                    content: {
                      title: 'Order ready',
                      body: `Order #${orderId} is ready`,
                      data: { type: 'order_ready', orderId: String(newRow.id || '') },
                    },
                    trigger: null,
                  })
                }
                try { await upsertNotification({ id: `order_ready:${String(newRow.id || '')}`, title: 'Order ready', body: `Order #${orderId} is ready`, type: 'order_ready', created_at: new Date().toISOString() }) } catch {}
              }
            } catch {}
          })
          .subscribe()
      } catch {}
    })()
    return () => { try { if (channel) supabase.removeChannel(channel) } catch {} }
  }, [stage])

  // Realtime: low stock notifications for admin roles (branch-targeted)
  useEffect(() => {
    if (stage !== 'app') return
    let channel2: any = null
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('branch_id, role')
          .eq('id', user.id)
          .maybeSingle()
        const branchId = (profile as any)?.branch_id as string | null
        const role = String((profile as any)?.role || '').toLowerCase()
        const allowed = ['manager','branch_admin','super_admin','inventory_manager']
        if (!branchId || !allowed.includes(role)) return
        channel2 = supabase
          .channel('mobile_low_stock')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_audience', filter: `branch_id=eq.${branchId}` }, async (payload: any) => {
            try {
              const notifId = String(payload?.new?.notification_id || '')
              if (!notifId) return
              const { data: notif } = await supabase
                .from('notifications')
                .select('id, title, body, type, data')
                .eq('id', notifId)
                .maybeSingle()
              if (!notif) return
              const t = String((notif as any).type || '').toLowerCase()
              // Only surface low_stock here; other types can be added as needed
              if (t !== 'low_stock') return
              if ((Constants as any)?.appOwnership !== 'expo') {
                const Notifications: any = await import('expo-notifications')
                await Notifications.scheduleNotificationAsync({
                  content: {
                    title: String((notif as any).title || 'Low stock'),
                    body: String((notif as any).body || ''),
                    data: (notif as any).data || { type: 'low_stock' },
                  },
                  trigger: null,
                })
              }
              try { await upsertNotification({ id: String((notif as any).id), title: String((notif as any).title || 'Low stock'), body: String((notif as any).body || ''), type: 'low_stock', created_at: new Date().toISOString() }) } catch {}
            } catch {}
          })
          .subscribe()
      } catch {}
    })()
    return () => { try { if (channel2) supabase.removeChannel(channel2) } catch {} }
  }, [stage])

  // Periodic background sync: pull latest notifications → SQLite
  useEffect(() => {
    if (stage !== 'app') return
    let timer: any = null
    let cancelled = false
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('branch_id')
          .eq('id', user.id)
          .maybeSingle()
        const branchId = (profile as any)?.branch_id as string | null
        if (!branchId) return
        await syncNotificationsForBranch(branchId)
        await downsyncBranchData(branchId)
        await processOutboxOnce()
        if (cancelled) return
        timer = setInterval(async () => {
          try {
            await syncNotificationsForBranch(branchId)
            await downsyncBranchData(branchId)
            await processOutboxOnce()
          } catch {}
        }, 120000)
      } catch {}
    })()
    return () => { cancelled = true; try { if (timer) clearInterval(timer) } catch {} }
  }, [stage])

  // Keep session tokens in sync with auth state, for reliable restore on next launch
  useEffect(() => {
    return () => {}
  }, [])

  // Re-register token when app foregrounds
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && stage === 'app') {
        ;(async () => { try { await registerAndSyncDeviceToken() } catch {} })()
        ;(async () => { try { await maybeCheckForUpdate('foreground') } catch {} })()
        ;(async () => {
          try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { data: profile } = await supabase
              .from('profiles')
              .select('branch_id')
              .eq('id', user.id)
              .maybeSingle()
            const branchId = (profile as any)?.branch_id as string | null
            if (branchId) {
              await downsyncBranchData(branchId)
              await processOutboxOnce()
            }
          } catch {}
        })()
      }
    })
    return () => { try { sub.remove() } catch {} }
  }, [stage])

  const handleLoginSuccess = async () => {
    // Force register device immediately on first login
    try { await registerDeviceOnce() } catch {}

    const existingPin = await SecureStore.getItemAsync(PIN_KEY)
    if (existingPin) {
      setHasPin(true)
      setStage('unlock')
    } else {
      setHasPin(false)
      setStage('setupPin')
    }
  }

  const handlePinConfirmed = async (pin: string) => {
    await SecureStore.setItemAsync(PIN_KEY, pin)
    setHasPin(true)
    setStage('app')
  }

  const validatePin = async (candidate: string) => {
    const stored = await SecureStore.getItemAsync(PIN_KEY)
    return stored === candidate
  }

  const handleUnlocked = () => {
    setStage('app')
  }

  const handleLogout = async () => {
    try {
      await logoutMirach()
    } catch {}
    try { await SecureStore.deleteItemAsync(STAFF_ID_KEY) } catch {}
    // Navigate to login to force account isolation
    setStage('login')
  }

  const handleRequestConfigurePin = async () => {
    const existingPin = await SecureStore.getItemAsync(PIN_KEY)
    const isChange = Boolean(existingPin)
    // Make sure the Security screen sees the correct mode on first render
    setSetupIsChange(isChange)
    setHasPin(isChange)
    setStage('setupPin')
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          <SafeAreaView style={{ flex: 1, backgroundColor: AdminColors.bg }} edges={['top', 'bottom']}>
            {!fontsLoaded && (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="small" color="#2C1810" />
              </View>
            )}
            {stage === 'checking' && (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="small" color="#2C1810" />
              </View>
            )}
            {stage === 'login' && <LoginScreen onLoggedIn={handleLoginSuccess} />}
            {stage === 'setupPin' && (
              <PinLockScreen
                mode="setup"
                onPinConfirmed={handlePinConfirmed}
                isChange={setupIsChange}
                validatePin={validatePin}
                onCancel={() => setStage('app')}
              />
            )}
            {stage === 'unlock' && (
              <PinLockScreen
                mode="unlock"
                validatePin={validatePin}
                onUnlocked={handleUnlocked}
                showEmailLink={true}
                disableKeypad={!hasPin}
                onEmailLink={() => setStage('login')}
                brandTitle="Tium Cafe"
              />
            )}
            {stage === 'app' && (
              <RoleRouter onLogout={handleLogout} onConfigurePin={handleRequestConfigurePin} />
            )}
            {/* Update available modal */}
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
                } catch {
                  setUpdateOpen(false)
                } finally {
                  setDownloading(false)
                }
              }}
            />
            {/* Restart to apply modal */}
            <ConfirmSheet
              open={restartOpen}
              title="Update downloaded"
              description="Restart the app to apply the update now?"
              confirmLabel="Restart"
              cancelLabel="Later"
              onOpenChange={setRestartOpen}
              onConfirm={async () => { try { await Updates.reloadAsync() } catch {} }}
            />
          </SafeAreaView>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
