import { useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, BackHandler, Platform, ToastAndroid } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PosScreen } from '@/screens/pos/PosScreen'
import { TablesScreen } from '@/screens/pos/TablesScreen'
import { PaymentScreen } from '@/screens/pos/PaymentScreen'
import { ProfileScreen } from './pos/ProfileScreen'
import { OrdersOverlay } from '@/screens/pos/OrdersOverlay'
import { useMobileOrderStore } from '@/state/orderStore'
import { useUiStore } from '@/state/uiStore'
import { processQueue } from '@/lib/offlineQueue'
import { AdminColors } from '../admin/theme/colors'
import { useAppTheme } from '../theme/ThemeProvider'
// OrdersOverlay kept in codebase, but header trigger removed per request

type TabKey = 'Tables' | 'POS' | 'Payments' | 'Profile'

type Props = {
  onLogout: () => void
  onConfigurePin: () => void
}

export function WaiterTabs({ onLogout, onConfigurePin }: Props) {
  // subscribe to theme so this re-renders on change
  useAppTheme()
  const tab = useUiStore((s) => s.activeTab) as TabKey
  const setTab = useUiStore((s) => s.setActiveTab)
  const [ordersOverlayOpen, setOrdersOverlayOpen] = useState(false)
  const [tabBarHeight, setTabBarHeight] = useState<number | null>(null)
  const clearOrder = useMobileOrderStore((s) => s.clear)
  const insets = useSafeAreaInsets()
  const TAB_BAR_BASE = 45
  const [online, setOnline] = useState(true)
  const lastBackRef = useRef(0)

  useEffect(() => {
    let mounted = true
    const tick = async () => {
      try { if (mounted) await processQueue() } catch {}
    }
    tick()
    const id = setInterval(tick, 30000)
    // Subscribe to connectivity changes if NetInfo is available
    let unsubscribe: (() => void) | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NetInfo = require('@react-native-community/netinfo').default
      unsubscribe = NetInfo.addEventListener(async (state: any) => {
        const isOnline = !!(state?.isConnected && (state?.isInternetReachable ?? true))
        setOnline(isOnline)
        if (isOnline) {
          try { await processQueue() } catch {}
        }
      })
    } catch {}
    return () => { mounted = false; clearInterval(id); try { unsubscribe && unsubscribe() } catch {} }
  }, [])

  // Universal Android back handling for waiter area
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Close overlays first
      if (ordersOverlayOpen) { setOrdersOverlayOpen(false); return true }
      // Navigate to Tables tab instead of exiting
      if (tab !== 'Tables') { setTab('Tables'); return true }
      // Double-back to exit from the Tables tab
      const now = Date.now()
      if (now - lastBackRef.current < 2000) {
        BackHandler.exitApp()
        return true
      }
      lastBackRef.current = now
      if (Platform.OS === 'android') {
        try { ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT) } catch {}
      }
      return true
    })
    return () => sub.remove()
  }, [ordersOverlayOpen, tab, setTab])

  return (
    <View style={[styles.container, { backgroundColor: AdminColors.bg }] }>
      {!online && (
        <View style={[styles.offlineBanner, { top: Math.max(insets.top, 8), backgroundColor: AdminColors.card, borderColor: AdminColors.border }] }>
          <Text style={[styles.offlineText, { color: AdminColors.text }]}>Offline mode — actions will sync when online</Text>
        </View>
      )}
      <View style={[styles.content, { paddingBottom: TAB_BAR_BASE + Math.max(insets.bottom, 16) }]}>
        {tab === 'POS' && <PosScreen footerHeight={(tabBarHeight ?? (TAB_BAR_BASE + Math.max(insets.bottom, 12)))} onOpenOrders={async () => { setOrdersOverlayOpen(true); try { await processQueue() } catch {} }} onBack={() => setTab('Tables')} />}
        {tab === 'Tables' && (
          <TablesScreen
            onOpenOrders={async () => { setOrdersOverlayOpen(true); try { await processQueue() } catch {} }}
            onTableSelected={() => setTab('POS')}
          />
        )}
        {tab === 'Payments' && (
          <PaymentScreen footerHeight={(tabBarHeight ?? (TAB_BAR_BASE + Math.max(insets.bottom, 12)))} />
        )}
        {tab === 'Profile' && (
          <ProfileScreen
            onConfigurePin={onConfigurePin}
            onLogout={() => {
              clearOrder()
              onLogout()
            }}
          />
        )}
      </View>
      <View
        style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 12), paddingTop: 12, backgroundColor: AdminColors.card, borderColor: AdminColors.border }]}
        onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}
      >
        {(['Tables', 'POS', 'Payments', 'Profile'] as TabKey[]).map((key) => (
          <TouchableOpacity
            key={key}
            style={[styles.tabItem, { minHeight: TAB_BAR_BASE - 12 }, tab === key && styles.tabItemActive]}
            onPress={() => setTab(key)}
          >
            <Text style={[styles.tabLabel, { color: tab === key ? AdminColors.accent : AdminColors.subtext }, tab === key && styles.tabItemActive]}>
              {key === 'POS' ? 'POS' : key === 'Payments' ? 'Payments' : key}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <OrdersOverlay visible={ordersOverlayOpen} onClose={() => setOrdersOverlayOpen(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: AdminColors.text as any,
  },
  headerLogout: {
    fontSize: 13,
    color: '#b91c1c',
    fontWeight: '500',
  },
  headerLink: {
    fontSize: 13,
    color: AdminColors.accent as any,
    fontWeight: '500',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 1,
    alignItems: 'center',
  },
  tabItemActive: {
    // active pill is applied on the label; keep container clean
  },
  tabLabel: {
    fontSize: 13,
    color: AdminColors.subtext as any,
  },
  tabLabelActive: { fontWeight: '600' },
  tabLabelPill: {
    backgroundColor: '#2C1810',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },
  offlineBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 20,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  offlineText: { fontSize: 12, textAlign: 'center', fontWeight: '600' },
})
