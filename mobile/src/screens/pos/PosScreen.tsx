import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, ScrollView, Image, RefreshControl, Alert, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { getProductsLocal, upsertProducts, setLastProfile, countOutboxPending } from '@/lib/db'
import { createPosOrder, fetchPosMenuProducts, updatePosOrder } from '@/lib/mirachposSession'
import { useMobileOrderStore, type MobileOrderItem } from '@/state/orderStore'
import { ProductDetailModal } from './ProductDetail'
import { FinalizeOrderModal } from './FinalizeOrder'
import { useUiStore } from '@/state/uiStore'
import * as Haptics from 'expo-haptics'
import { MaterialIcons } from '@expo/vector-icons'
import { enqueue, newId } from '@/lib/offlineQueue'
import { GuestPicker, GuestRow } from '@/components/ui/guest-picker'
import { ConfirmSheet } from '@/components/ui/confirm-sheet'
import Constants from 'expo-constants'
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'
import { ChatButton } from '../../components/ui/ChatButton'
import { registerAndSyncDeviceToken } from '@/lib/notifications'
import { useResponsive } from '@/hooks/useResponsive'
import LottieView from 'lottie-react-native'
import { WaiterNotificationsBell } from './WaiterNotificationsBell'

interface ProductRow {
  id: string
  name: string
  price: number
  category: string | null
  image_url?: string | null
}

async function fetchMenu(): Promise<ProductRow[]> {
  // If offline, return SQLite immediately without hitting network/auth
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NetInfo = require('@react-native-community/netinfo').default
    const state = await NetInfo.fetch()
    const isOnline = !!(state?.isConnected && (state?.isInternetReachable ?? true))
    if (!isOnline) {
      const local = await getProductsLocal()
      return local.map((p) => ({ id: p.id, name: p.name, price: Number(p.price ?? 0), category: (p.category_id as any) ?? null, image_url: p.image_url ?? null }))
    }
  } catch {}
  try {
    const out = await fetchPosMenuProducts({ limit: 500 })
    const rows: ProductRow[] = (out.products ?? []).map((p) => ({
      id: String(p.id),
      name: String(p.name || 'Item'),
      price: Number(p.price ?? 0) || 0,
      category: (p.category as any) ?? null,
      image_url: (p.image as any) ?? null,
    }))
    try {
      await upsertProducts((out.products ?? []).map((p) => ({
        id: String(p.id),
        name: String(p.name || 'Item'),
        price: Number(p.price ?? 0) || 0,
        category_id: (p.category as any) ?? null,
        image_url: (p.image as any) ?? null,
        updated_at: (p.updatedAt as any) ?? null,
      })))
    } catch {}
    return rows
  } catch (e) {
    const local = await getProductsLocal()
    if (local.length > 0) return local.map((p) => ({ id: p.id, name: p.name, price: Number(p.price ?? 0), category: (p.category_id as any) ?? null, image_url: p.image_url ?? null }))
    return []
  }
}

type PosProps = { footerHeight?: number; onOpenOrders?: () => void; onBack?: () => void }

export function PosScreen({ footerHeight, onOpenOrders, onBack }: PosProps) {
  const { isDark } = useAppTheme()
  const { spacing, font, radius } = useResponsive()
  const queryClient = useQueryClient()
  const [placing, setPlacing] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('All')
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [selected, setSelected] = useState<ProductRow | null>(null)
  const [editingItem, setEditingItem] = useState<MobileOrderItem | null>(null)
  const [guestPickerOpen, setGuestPickerOpen] = useState(false)
  const [selectedGuestName, setSelectedGuestName] = useState<string>('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [infoTitle, setInfoTitle] = useState('')
  const [infoDesc, setInfoDesc] = useState('')
  const [discount, setDiscount] = useState<number>(0)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [successOpen, setSuccessOpen] = useState(false)
  const [successLabel, setSuccessLabel] = useState<string>('Order placed')
  const [refreshing, setRefreshing] = useState(false)
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['menu'],
    queryFn: fetchMenu,
    // Keep last good data when offline/errors occur and avoid aggressive refetches
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
    placeholderData: keepPreviousData,
    networkMode: 'offlineFirst',
  })
  const [pendingCount, setPendingCount] = useState(0)
  useEffect(() => {
    let t: any = null
    ;(async () => {
      try { setPendingCount(await countOutboxPending()) } catch {}
      t = setInterval(async () => { try { setPendingCount(await countOutboxPending()) } catch {} }, 5000)
    })()
    return () => { try { if (t) clearInterval(t) } catch {} }
  }, [])

  // Seed menu from SQLite/cache immediately so UI doesn't clear when offline
  useEffect(() => {
    (async () => {
      try {
        const current = queryClient.getQueryData<ProductRow[]>(['menu'])
        if (current && current.length > 0) return
        const local = await getProductsLocal()
        if (local.length > 0) {
          const rows = local.map((p) => ({ id: p.id, name: p.name, price: Number(p.price ?? 0), category: (p.category_id as any) ?? null, image_url: p.image_url ?? null }))
          queryClient.setQueryData(['menu'], rows)
          return
        }
      } catch {}
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const addItem = useMobileOrderStore((s) => s.addItem)
  const updateQty = useMobileOrderStore((s) => s.updateQty)
  const updateItem = useMobileOrderStore((s) => s.updateItem)
  const clear = useMobileOrderStore((s) => s.clear)
  const items = useMobileOrderStore((s) => s.items)
  const tableId = useMobileOrderStore((s) => s.tableId)
  const tableName = useMobileOrderStore((s) => s.tableName)
  const extraTableIds = useMobileOrderStore((s) => s.extraTableIds)
  const extraTableNames = useMobileOrderStore((s) => s.extraTableNames)
  const isGuest = useMobileOrderStore((s) => s.isGuest)
  const toggleGuest = useMobileOrderStore((s) => s.toggleGuest)
  const getAllDrafts = useMobileOrderStore((s) => s.getAllDrafts)
  const setTables = useMobileOrderStore((s) => s.setTables)
  const cartNote = useMobileOrderStore((s) => s.cartNote)
  const couponCode = useMobileOrderStore((s) => s.couponCode)
  const setCartNote = useMobileOrderStore((s) => s.setCartNote)
  const setCouponCode = useMobileOrderStore((s) => s.setCouponCode)
  const subtotal = useMemo(() => items.reduce((sum, i) => sum + i.price * i.quantity, 0), [items])
  const [vatRatePct, setVatRatePct] = useState<number>(0)
  const tax = useMemo(() => subtotal * (Math.max(0, vatRatePct) / 100), [subtotal, vatRatePct])
  const total = useMemo(() => subtotal + tax, [subtotal, tax])
  const itemsCount = useMemo(() => items.reduce((n, i) => n + i.quantity, 0), [items])
  const listRef = useRef<FlatList<ProductRow>>(null)
  const insets = useSafeAreaInsets()
  const TAB_BAR_BASE = 56
  const measured = footerHeight && footerHeight > 0 ? footerHeight : (TAB_BAR_BASE + Math.max(insets.bottom, 8))
  // Lower the chip closer to the bottom (just above system inset)
  const bottomBarBottom = Math.max(Math.max(insets.bottom, -70) + -90, 0)

  // Ensure push token is registered when POS mounts (dev/preview/prod builds)
  useEffect(() => {
    ;(async () => { try { await registerAndSyncDeviceToken() } catch {} })()
  }, [])

  // Organization branding & user initials for header
  const [orgName, setOrgName] = useState<string>('Tium Cafe')
  const [userInitials, setUserInitials] = useState<string>('')
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        const uid = user?.id
        if (!uid) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id, full_name')
          .eq('id', uid)
          .maybeSingle()
        const full = (profile as any)?.full_name as string | null
        if (full && full.trim()) {
          const parts = full.trim().split(/\s+/)
          setUserInitials(parts.slice(0,2).map(p=>p[0]?.toUpperCase()||'').join(''))
        } else if (user?.email) {
          setUserInitials(String(user.email).slice(0,2).toUpperCase())
        }
        const orgId = (profile as any)?.organization_id as string | null
        if (orgId) {
          const { data: org } = await supabase
            .from('organizations')
            .select('name')
            .eq('id', orgId)
            .maybeSingle()
          const name = ((org as any)?.name as string | null) || null
          if (name && name.trim()) setOrgName(name.trim())
        }
      } catch {}
    })()
  }, [])

  const brand = useMemo(() => {
    const words = (orgName || '').trim().split(/\s+/)
    return { script: words[0] || '', rest: words.slice(1).join(' ') }
  }, [orgName])

  // Selected tables (primary + extras) for switcher
  const selectedTables = useMemo(() => {
    const ids = [tableId, ...(extraTableIds || [])].filter(Boolean) as string[]
    const names = [tableName, ...(extraTableNames || [])]
    return ids.map((id, idx) => ({ id, name: names[idx] ?? null }))
  }, [tableId, tableName, extraTableIds, extraTableNames])

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg },
    menuContainer: { flex: 1, paddingHorizontal: Math.round(spacing.sm) },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Math.round(spacing.sm), paddingVertical: Math.round(spacing.sm), backgroundColor: 'transparent' },
    stickyHeader: { backgroundColor: 'transparent', paddingBottom: 0, zIndex: 10, elevation: 2 },
    headerRow: { paddingVertical: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    iconButton: { width: 40, height: 30, alignItems: 'center', justifyContent: 'center' },
    backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: font.h2, fontWeight: '700', color: AdminColors.text, flex: 1, textAlign: 'center', marginHorizontal: 8 },
    brandRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-start', flex: 1, flexGrow: 1, overflow: 'visible', minWidth: 0, flexShrink: 1 },
    brandScript: { fontSize: 44, lineHeight: 52, fontWeight: '600', fontStyle: 'normal', letterSpacing: 0, marginRight: 1, fontFamily: 'BrandScript' },
    brandSans: { fontSize: font.body, lineHeight: 22, fontWeight: '600', opacity: 0.98, letterSpacing: 0.1 },
    headerRight: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
    syncPill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, gap: 6 },
    syncText: { fontSize: 11, fontWeight: '700' },
    tableBadge: { fontSize: font.small, color: AdminColors.subtext, marginRight: 6 },
    userCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: AdminColors.accent, alignItems: 'center', justifyContent: 'center', marginRight: 5, backgroundColor: 'transparent', shadowColor: AdminColors.accent, shadowOpacity: 0.35, shadowRadius: 8, elevation: 3 },
    userCircleText: { fontSize: 11, fontWeight: '700', color: AdminColors.text },
    categoriesBar: { marginTop: 4, marginBottom: 6 },
    categoriesContent: { paddingRight: 8, alignItems: 'center' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { marginTop: 6, fontSize: font.small, color: AdminColors.subtext },
    errorText: { fontSize: font.small, color: AdminColors.danger },
    chip: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderWidth: 1,
      borderColor: AdminColors.border,
      height: Math.max(32, Math.round(spacing.md * 1.6)),
      paddingHorizontal: Math.round(spacing.md),
      borderRadius: 999,
      marginRight: 8,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 1,
    },
    chipActive: {
      backgroundColor: AdminColors.accent,
      borderColor: AdminColors.accent,
      shadowColor: AdminColors.accent,
      shadowOpacity: 0.35,
      shadowRadius: 10,
      elevation: 3,
    },
    chipText: { fontSize: font.small, color: AdminColors.text, lineHeight: 14 },
    chipTextActive: { color: '#1a1a1a', fontWeight: '700' },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
      paddingVertical: Math.round(spacing.md), paddingHorizontal: Math.round(spacing.md),
      borderRadius: Math.max(12, radius), marginBottom: Math.round(spacing.sm),
      borderWidth: 1, borderColor: AdminColors.border,
      shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center' },
    rowImage: { width: 64, height: 64, borderRadius: Math.max(12, radius), backgroundColor: AdminColors.surface },
    rowTitle: { fontSize: font.h3, fontWeight: '700', color: AdminColors.text },
    rowPrice: { fontSize: font.small, fontWeight: '700', color: AdminColors.text, marginTop: 2 },
    rowQty: { flexDirection: 'row', alignItems: 'center' },
    // Grouped qty control: [- 0 +]
    qtyGroup: {
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1, borderColor: AdminColors.border,
      borderRadius: 999, paddingVertical: Math.max(3, Math.round(spacing.xs/2)), paddingHorizontal: Math.max(6, Math.round(spacing.xs)),
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)'
    },
    qtyBtn: { width: Math.max(26, Math.round(spacing.md)), height: Math.max(26, Math.round(spacing.md)), borderRadius: Math.round(Math.max(26, Math.round(spacing.md))/2), alignItems: 'center', justifyContent: 'center' },
    rowQtyText: { minWidth: 22, textAlign: 'center', fontSize: font.body, marginHorizontal: 6, color: AdminColors.text, fontWeight: '800' },
    qtyPill: {
      width: 28, height: 28, borderRadius: 14,
      borderWidth: 1, borderColor: AdminColors.border,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)'
    },
    qtyPillText: { fontSize: font.h3, fontWeight: '800', color: AdminColors.text },
    qtyPillDisabled: { opacity: 0.4 },
    bottomBar: {
      position: 'absolute', left: Math.round(spacing.sm), right: Math.round(spacing.sm), bottom: Math.round(spacing.sm),
      backgroundColor: AdminColors.accent,
      borderRadius: 999, paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.sm + 4),
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      shadowColor: AdminColors.accent, shadowOpacity: 0.35, shadowRadius: 10, elevation: 3,
    },
    bottomBarText: { color: '#1a1a1a', fontSize: font.body, fontWeight: '700' },
    bottomBarButton: { backgroundColor: isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.06)', paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.sm), borderRadius: 999, borderWidth: 1, borderColor: AdminColors.border },
    bottomBarButtonText: { color: AdminColors.text, fontSize: font.small, fontWeight: '700' },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: Math.round(spacing.md), paddingTop: Math.round(spacing.sm), paddingBottom: Math.round(spacing.md), borderTopWidth: 1, borderColor: AdminColors.border },
    sheetHandle: { alignSelf: 'center', width: 48, height: 4, borderRadius: 2, backgroundColor: AdminColors.border, marginBottom: 10 },
    sheetTitle: { textAlign: 'center', fontWeight: '800', marginBottom: 8, color: AdminColors.text, fontSize: font.h3 },
    sheetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
    sheetRowText: { fontSize: font.body, color: AdminColors.text },
    sheetTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderColor: AdminColors.border, marginTop: 6 },
    sheetTotalLabel: { fontSize: font.body, fontWeight: '800', color: AdminColors.text },
    sheetTotalValue: { fontSize: font.body, fontWeight: '900', color: AdminColors.text },
    placeButton: { paddingHorizontal: Math.round(spacing.md), paddingVertical: Math.round(spacing.sm), borderRadius: 999, backgroundColor: AdminColors.accent, shadowColor: AdminColors.accent, shadowOpacity: 0.3, shadowRadius: 8, elevation: 2 },
    placeButtonDisabled: { opacity: 0.7 },
    placeButtonText: { color: '#1a1a1a', fontSize: font.small, fontWeight: '700' },
  }), [isDark, spacing, font, radius])

  // Keep layout stable: jump back to top when category changes
  useEffect(() => {
    try { listRef.current?.scrollToOffset({ offset: 0, animated: false }) } catch { }
  }, [category])

  const categories = ['All', ...Array.from(new Set((data ?? []).map((p) => p.category).filter(Boolean))) as string[]]
  const openOrders = useUiStore((s) => s.openOrders)
  const editingOrderId = useUiStore((s) => s.editingOrderId)
  const requestFinalizeOpen = useUiStore((s) => s.requestFinalizeOpen)
  const consumeFinalizeOpen = useUiStore((s) => s.consumeFinalizeOpen)
  const finalizeOpenPending = useUiStore((s) => s.finalizeOpenPending)
  const setEditingOrder = useUiStore((s) => s.setEditingOrder)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const setFocusPaymentOrder = useUiStore((s) => s.setFocusPaymentOrder)

  const triggerLocalNotif = async () => {
    try {
      if ((Constants as any)?.appOwnership === 'expo') {
        Alert.alert('Not supported in Expo Go', 'Use a development build to test notifications.')
        return
      }
      const Notifications: any = await import('expo-notifications')
      // Permissions (Android 13+ requires prompt)
      const { status: existingStatus } = await Notifications.getPermissionsAsync()
      if (existingStatus !== 'granted') {
        await Notifications.requestPermissionsAsync()
      }
      // Channel for Android
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.DEFAULT,
        })
      }
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Test notification', body: 'Hello from Tium Cafe' },
        trigger: null,
      })
    } catch {}
  }

  // Load VAT rate once: prefer branch settings, fallback to organization
  const [branchId, setBranchId] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id, branch_id')
          .eq('id', user.id)
          .maybeSingle()
        const orgId = (profile as any)?.organization_id
        const branchId = (profile as any)?.branch_id
        if (branchId) setBranchId(branchId)
        let rate: number | null = null
        if (branchId) {
          const { data: branch } = await supabase
            .from('branches')
            .select('settings')
            .eq('id', branchId)
            .maybeSingle()
          let raw: any = ((branch as any)?.settings ?? {})?.vat_rate ?? null
          if (typeof raw === 'string') raw = raw.replace('%','').trim()
          let parsed = Number.parseFloat(String(raw))
          if (!Number.isNaN(parsed)) { if (parsed > 0 && parsed <= 1) parsed = parsed * 100; rate = parsed }
        }
        if (rate == null && orgId) {
          const { data: org } = await supabase
            .from('organizations')
            .select('vat_rate')
            .eq('id', orgId)
            .maybeSingle()
          let raw: any = (org as any)?.vat_rate ?? null
          if (typeof raw === 'string') raw = raw.replace('%','').trim()
          let parsed = Number.parseFloat(String(raw))
          if (!Number.isNaN(parsed)) { if (parsed > 0 && parsed <= 1) parsed = parsed * 100; rate = parsed }
        }
        if (rate != null) setVatRatePct(rate)
      } catch { }
    })()
  }, [])

  // If an edit flow requested to open finalize, do so
  useEffect(() => {
    if (finalizeOpenPending) {
      setFinalizeOpen(true)
      consumeFinalizeOpen()
    }
  }, [finalizeOpenPending])

  const validateCoupon = async () => {
    try {
      const code = (couponCode || '').trim()
      if (!code) {
        setDiscount(0)
        setCouponError(null)
        return
      }
      const b = branchId
      if (!b) return
      const { data, error } = await supabase.rpc('validate_coupon', {
        p_branch_id: b,
        p_code: code,
        p_total_amount: total,
      })
      if (error) {
        const msg = String(error.message || '')
        let friendly = 'Coupon invalid'
        if (/invalid_coupon/i.test(msg)) friendly = 'Coupon not found or inactive'
        else if (/coupon_exhausted/i.test(msg)) friendly = 'Coupon usage limit reached'
        else if (/coupon_min_total_not_met/i.test(msg)) friendly = 'Order total is below coupon minimum'
        setCouponError(friendly)
        setDiscount(0)
        return
      }
      const row: any = Array.isArray(data) ? (data[0] ?? null) : (data as any)
      const disc = Number(row?.discount ?? 0)
      const normalized = (row?.normalized_code as string | null) ?? null
      if (normalized) setCouponCode(normalized)
      setDiscount(Number.isFinite(disc) ? disc : 0)
      setCouponError(null)
    } catch (e: any) {
      setCouponError('Coupon validation failed')
      setDiscount(0)
    }
  }

  useEffect(() => {
    if (finalizeOpen) {
      // refresh discount when the modal opens or totals change
      validateCoupon()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalizeOpen, subtotal, tax, couponCode])

  const placeOrder = async (opts?: { goToPayments?: boolean }) => {
    if (items.length === 0) return
    // For new orders, require a table unless going to payments (takeaway) or editing an existing takeaway
    if (!tableId && !editingOrderId && !opts?.goToPayments) {
      // Smooth flow: jump to Tables and auto-open finalize when back
      requestFinalizeOpen()
      setActiveTab('Tables')
      return
    }
    if (isGuest && !selectedGuestName.trim()) {
      setGuestPickerOpen(true)
      setInfoTitle('Select guest')
      setInfoDesc('Please select the guest before sending the order.')
      setInfoOpen(true)
      return
    }
    setOrderError(null)
    setPlacing(true)
    try {
      // If offline, skip all Supabase calls and queue immediately
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const NetInfo = require('@react-native-community/netinfo').default
        const state = await NetInfo.fetch()
        const isOnline = !!(state?.isConnected && (state?.isInternetReachable ?? true))
        if (!isOnline) {
          const opId = newId()
          if (editingOrderId) {
            await enqueue({
              id: opId,
              type: 'edit',
              createdAt: Date.now(),
              payload: {
                orderId: editingOrderId,
                tableId: tableId ?? null,
                items: items.map((it) => ({ productId: it.productId, name: it.name, price: it.price, quantity: it.quantity, modifiers: it.modifiers, note: it.note })),
                totals: { subtotal, tax, total },
                guest: { isGuest: isGuest || null, name: isGuest ? (selectedGuestName || null) : null },
              },
            })
            clear()
            setEditingOrder(null)
          } else {
            await enqueue({
              id: opId,
              type: 'create',
              createdAt: Date.now(),
              payload: {
                tableId: opts?.goToPayments ? null : (tableId ?? null),
                items: items.map((it) => ({ productId: it.productId, name: it.name, price: it.price, quantity: it.quantity, modifiers: it.modifiers, note: it.note })),
                totals: { subtotal, tax, total },
                guest: { isGuest: isGuest || null, name: isGuest ? (selectedGuestName || null) : null },
              },
            })
            clear()
          }
          try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) } catch { }
          setInfoTitle('Queued offline')
          setInfoDesc('No internet. Your action was queued and will sync automatically when online.')
          setInfoOpen(true)
          setFinalizeOpen(false)
          if (opts?.goToPayments) setActiveTab('Payments')
          return
        }
      } catch {}

      const posPayload = {
        tableId: opts?.goToPayments ? undefined : (tableId ?? undefined),
        tableName: opts?.goToPayments ? undefined : (tableName ?? undefined),
        items: items.map((it) => ({
          productId: String(it.productId),
          name: String(it.name || 'Item'),
          qty: Number(it.quantity || 0) || 0,
          unitPrice: Number(it.price || 0) || 0,
        })).filter((x) => x.productId && x.qty > 0),
      }

      if (posPayload.items.length === 0) throw new Error('empty_order')

      if (editingOrderId) {
        await updatePosOrder({
          orderId: editingOrderId,
          status: opts?.goToPayments ? 'Served' : 'Pending',
          payload: posPayload as any,
        })
        clear()
        setEditingOrder(null)
        try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) } catch { }
        setFinalizeOpen(false)
        openOrders(editingOrderId)
      } else {
        const created = await createPosOrder({
          status: opts?.goToPayments ? 'Served' : 'Pending',
          payload: posPayload as any,
        })
        clear()
        try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) } catch { }
        setFinalizeOpen(false)
        if (opts?.goToPayments) {
          setFocusPaymentOrder(created.id)
          setActiveTab('Payments')
        } else {
          openOrders(created.id)
        }
      }
    } catch (e: any) {
      console.error('Place order failed', e)
      const msg = e?.message ?? ''
      const maybeOffline = /network|fetch|timeout|offline/i.test(String(msg))
      if (maybeOffline) {
        try {
          const opId = newId()
          if (editingOrderId) {
            await enqueue({
              id: opId,
              type: 'edit',
              createdAt: Date.now(),
              payload: {
                orderId: editingOrderId,
                tableId: tableId ?? null,
                items: items.map((it) => ({ productId: it.productId, name: it.name, price: it.price, quantity: it.quantity, modifiers: it.modifiers, note: it.note })),
                totals: { subtotal, tax, total },
                guest: { isGuest: isGuest || null, name: isGuest ? (selectedGuestName || null) : null },
              },
            })
            clear()
            setEditingOrder(null)
          } else {
            await enqueue({
              id: opId,
              type: 'create',
              createdAt: Date.now(),
              payload: {
                tableId: tableId ?? null,
                items: items.map((it) => ({ productId: it.productId, name: it.name, price: it.price, quantity: it.quantity, modifiers: it.modifiers, note: it.note })),
                totals: { subtotal, tax, total },
                guest: { isGuest: isGuest || null, name: isGuest ? (selectedGuestName || null) : null },
              },
            })
            clear()
          }
          try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) } catch { }
          setInfoTitle('Queued offline')
          setInfoDesc('No internet. Your action was queued and will sync automatically when online.')
          setInfoOpen(true)
          setFinalizeOpen(false)
          if (opts?.goToPayments) setActiveTab('Payments')
          return
        } catch (qErr) {
          console.warn('Failed to queue offline op', qErr)
        }
      }
      // Friendly coupon errors
      const low = String(msg).toLowerCase()
      if (/(invalid_coupon)/.test(low)) setOrderError('Coupon not found or inactive')
      else if (/(coupon_exhausted)/.test(low)) setOrderError('Coupon usage limit reached')
      else if (/(coupon_min_total_not_met)/.test(low)) setOrderError('Order total is below coupon minimum')
      else setOrderError(msg || 'Failed to place order')
    } finally {
      setPlacing(false)
    }
  }

  // Send all table drafts as separate orders in one action
  const placeAllDrafts = async () => {
    const drafts = getAllDrafts().filter(
      (d: { tableId: string; tableName: string | null; items: MobileOrderItem[]; isGuest: boolean; guestName: string }) =>
        d.items.length > 0,
    )
    if (drafts.length <= 1) {
      await placeOrder()
      return
    }
    setOrderError(null)
    setPlacing(true)
    try {
      // If offline, enqueue each draft as a create op and skip Supabase
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const NetInfo = require('@react-native-community/netinfo').default
        const state = await NetInfo.fetch()
        const isOnline = !!(state?.isConnected && (state?.isInternetReachable ?? true))
        if (!isOnline) {
          for (const draft of drafts) {
            const subtotalX = draft.items.reduce((sum: number, it: MobileOrderItem) => sum + it.price * it.quantity, 0)
            const taxX = subtotalX * (Math.max(0, vatRatePct) / 100)
            const totalX = subtotalX + taxX
            await enqueue({
              id: newId(),
              type: 'create',
              createdAt: Date.now(),
              payload: {
                tableId: draft.tableId ?? null,
                items: draft.items.map((it: MobileOrderItem) => ({ productId: it.productId, name: it.name, price: it.price, quantity: it.quantity, modifiers: it.modifiers, note: it.note })),
                totals: { subtotal: subtotalX, tax: taxX, total: totalX },
                guest: { isGuest: draft.isGuest || null, name: draft.isGuest ? ((draft.guestName || '').trim() || null) : null },
              },
            })
          }
          clear()
          try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) } catch { }
          setFinalizeOpen(false)
          return
        }
      } catch {}

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, branch_id, organization_id')
        .eq('id', user.id)
        .maybeSingle()
      if (!profile?.branch_id) throw new Error('No active branch for user')

      for (const draft of drafts) {
        const subtotalX = draft.items.reduce(
          (sum: number, it: MobileOrderItem) => sum + it.price * it.quantity,
          0,
        )
        const taxX = subtotalX * (Math.max(0, vatRatePct) / 100)
        const totalX = subtotalX + taxX
        const orderItemsPayload = draft.items.map((it: MobileOrderItem) => {
          const mods = [...(it.modifiers ?? [])]
          if ((it.note ?? '').trim().length > 0) mods.push(`note:${(it.note ?? '').trim()}`)
          return {
            product_id: it.productId,
            quantity: it.quantity,
            unit_price: it.price,
            total_price: it.price * it.quantity,
            modifiers: mods,
            status: 'pending',
          }
        })

        const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert({
            branch_id: (profile as any).branch_id,
            staff_id: (profile as any).id,
            table_id: draft.tableId,
            status: 'pending',
            total_amount: totalX,
            tax_amount: taxX,
            discount_amount: 0,
            payment_status: 'unpaid',
            is_guest: draft.isGuest || null,
            customer_name: draft.isGuest ? ((draft.guestName || '').trim() || null) : null,
          })
          .select('id')
          .single()
        if (orderError || !order) throw new Error(orderError?.message || 'Order create failed')

        const payloadWithId = orderItemsPayload.map((p: any) => ({
          ...p,
          order_id: order.id as string,
        }))
        const { error: itemsInsertError } = await supabase
          .from('order_items')
          .insert(payloadWithId)
        if (itemsInsertError) throw new Error(itemsInsertError.message)

        if (draft.isGuest && (draft.guestName || '').trim()) {
          try {
            let guestId: string | null = null
            const name = (draft.guestName || '').trim()
            const orgId = (profile as any).organization_id
            if (orgId && name) {
              const { data: existing } = await supabase
                .from('guests')
                .select('id')
                .eq('organization_id', orgId)
                .eq('full_name', name)
                .maybeSingle()
              if (existing?.id) guestId = existing.id as string
              else {
                const { data: created } = await supabase
                  .from('guests')
                  .insert({ organization_id: orgId, full_name: name, type: 'invited', is_active: true })
                  .select('id')
                  .single()
                guestId = (created as any)?.id ?? null
              }
            }
            await supabase.from('guest_visits').insert({
              guest_id: guestId,
              branch_id: (profile as any).branch_id,
              order_id: order.id as string,
              amount_consumed: Number(totalX),
              is_paid_by_guest: true,
              covered_by_org: false,
            })
            if (guestId) {
              const { data: g } = await supabase
                .from('guests')
                .select('allowance_limit')
                .eq('id', guestId)
                .maybeSingle()
              const cur = Number((g as any)?.allowance_limit ?? null)
              if (!Number.isNaN(cur)) {
                const next = Math.max(0, cur - Number(totalX))
                await supabase.from('guests').update({ allowance_limit: next }).eq('id', guestId)
              }
            }
          } catch {}
        }
      }

      clear()
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) } catch { }
      setFinalizeOpen(false)
    } catch (e: any) {
      setOrderError(e?.message || 'Failed to send drafts')
    } finally {
      setPlacing(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, backgroundColor: AdminColors.bg }]}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}
      keyboardVerticalOffset={8}
    >
      <View style={styles.menuContainer}>
        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={AdminColors.accent} />
            <Text style={[styles.loadingText, { color: AdminColors.subtext }]}>Loading menu…</Text>
          </View>
        )}
        {error && !isLoading && (
          <View style={styles.centered}>
            <Text style={[styles.errorText, { color: AdminColors.danger }]}>Unable to load menu</Text>
          </View>
        )}
        {!isLoading && !error && (
          <>
            <FlatList
              ref={listRef}
              data={(data ?? [])
                .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
                .filter((p) => (category === 'All' ? true : p.category === category))}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingBottom: bottomBarBottom + 160 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { try { setRefreshing(true); await refetch() } finally { setRefreshing(false) } }} tintColor={AdminColors.accent} />}
              keyboardShouldPersistTaps="handled"
              stickyHeaderIndices={[0]}
              ListHeaderComponentStyle={styles.stickyHeader}
              ListHeaderComponent={
                <View style={[styles.stickyHeader, { backgroundColor: AdminColors.bg }]}> 
                  <View style={styles.headerRow}>
                    <View style={styles.brandRow} pointerEvents="none">
                      <Text
                        style={[styles.brandScript, { color: AdminColors.text }]}
                        numberOfLines={1}
                        ellipsizeMode="clip"
                        allowFontScaling={false}
                      >
                        {brand.script}
                      </Text>
                      {!!brand.rest && (
                        <Text
                          style={[styles.brandSans, { color: AdminColors.text }]}
                          numberOfLines={1}
                          ellipsizeMode="clip"
                          allowFontScaling={false}
                        >
                          {' '}{brand.rest}
                        </Text>
                      )}
                    </View>
                    <View style={styles.headerRight}>
                      {!!tableName && (
                        <Text style={[styles.tableBadge, { textTransform: 'uppercase', letterSpacing: 0.5 }]}>TABLE {String(tableName).replace(/^t\s*/i,'').trim()}</Text>
                      )}
                      {pendingCount > 0 && (
                        <View style={[styles.syncPill, { borderColor: AdminColors.border, backgroundColor: AdminColors.card }]}> 
                          <MaterialIcons name="cloud-upload" size={16} color={AdminColors.accent} />
                          <Text style={[styles.syncText, { color: AdminColors.text }]}>Queued {pendingCount}</Text>
                        </View>
                      )}
                      <WaiterNotificationsBell />
                      <TouchableOpacity style={[styles.iconButton, { marginLeft: 2 }]} onPress={onOpenOrders}>
                        <MaterialIcons name="assignment" size={24} color={AdminColors.accent} />
                      </TouchableOpacity>
                      <View style={[styles.userCircle, { marginLeft: 8 }]}><Text style={styles.userCircleText}>{userInitials || 'AW'}</Text></View>
                    </View>
                  </View>
                  {selectedTables.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 12, marginTop: 6 }} contentContainerStyle={{ paddingRight: 12, alignItems: 'center' }}>
                      {getAllDrafts().filter((d) => d.items.length > 0).length > 1 && (
                        <ChatButton title="Send all" size="sm" variant="secondary" onPress={async () => { await placeAllDrafts() }} />
                      )}
                      <ChatButton
                        title="Clear tables"
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          setTables(null as any, null as any, [], [])
                        }}
                        style={{ marginLeft: 8 }}
                      />
                    </ScrollView>
                  )}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoriesBar} contentContainerStyle={styles.categoriesContent}>
                    {categories.map((c) => (
                      <TouchableOpacity
                        key={c || 'uncat'}
                        style={[
                          styles.chip,
                          { backgroundColor: AdminColors.card, borderColor: AdminColors.border },
                          category === c && { backgroundColor: AdminColors.accent, borderColor: AdminColors.accent },
                        ]}
                        onPress={() => setCategory(c)}
                      >
                        <Text style={[styles.chipText, { color: AdminColors.text }, category === c && { color: '#1a1a1a', fontWeight: '600' }]}>
                          {c || 'Uncategorized'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              }
              renderItem={({ item }) => {
                const existing = items.find((i) => i.productId === item.id)
                const qty = existing?.quantity ?? 0
                return (
                  <TouchableOpacity style={[styles.row, { backgroundColor: AdminColors.card }]} onPress={() => setSelected(item)} activeOpacity={0.8}>
                    <View style={styles.rowLeft}>
                      {item.image_url ? (
                        <Image source={{ uri: item.image_url }} style={styles.rowImage} />
                      ) : (
                        <View style={[styles.rowImage, { backgroundColor: AdminColors.surface }]} />
                      )}
                      <View style={{ marginLeft: 12 }}>
                        <Text style={[styles.rowTitle, { color: AdminColors.text }]}>{item.name}</Text>
                        <Text style={[styles.rowPrice, { color: AdminColors.text }]}>{(item.price * (1 + Math.max(0, vatRatePct) / 100)).toFixed(2)} ETB</Text>
                      </View>
                    </View>
                    <View style={styles.rowQty}>
                      <View style={[styles.qtyGroup, { borderColor: AdminColors.border, backgroundColor: AdminColors.card }]}>
                        <TouchableOpacity
                          onPress={async () => { if (existing) { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); updateQty(existing.id, -1) } }}
                          disabled={!existing}
                          style={[styles.qtyBtn, !existing && styles.qtyPillDisabled]}
                        >
                          <Text style={[styles.qtyPillText, { color: AdminColors.text }]}>-</Text>
                        </TouchableOpacity>
                        <Text style={[styles.rowQtyText, { color: AdminColors.text }]}>{qty}</Text>
                        <TouchableOpacity
                          onPress={async () => {
                            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                            existing
                              ? updateQty(existing.id, 1)
                              : addItem({ productId: item.id, name: item.name, price: item.price })
                          }}
                          style={styles.qtyBtn}
                        >
                          <Text style={[styles.qtyPillText, { color: AdminColors.text }]}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                )
              }}
            />
          </>
        )}
      </View>

      {itemsCount > 0 && (
        <View style={[styles.bottomBar, { bottom: bottomBarBottom, backgroundColor: AdminColors.accent }]}>
          <Text style={[styles.bottomBarText, { color: '#1a1a1a' }]}>{itemsCount} item{itemsCount > 1 ? 's' : ''} selected</Text>
          <TouchableOpacity style={styles.bottomBarButton} onPress={() => setFinalizeOpen(true)}>
            <Text style={styles.bottomBarButtonText}>View order</Text>
          </TouchableOpacity>
        </View>
      )}

      <ProductDetailModal
        visible={!!selected}
        product={selected}
        onClose={() => { setSelected(null); setEditingItem(null) }}
        initialQty={editingItem?.quantity}
        initialModifiers={editingItem?.modifiers}
        initialNote={editingItem?.note}
        editingItemId={editingItem?.id ?? null}
        onAdd={(payload) => {
          if (editingItem) {
            updateItem(editingItem.id, { quantity: payload.quantity, modifiers: payload.modifiers, note: payload.note ?? '' })
          } else {
            addItem({ productId: payload.productId, name: payload.name, price: payload.price, quantity: payload.quantity, modifiers: payload.modifiers, note: payload.note })
          }
          setSelected(null)
          setEditingItem(null)
        }}
      />

      <FinalizeOrderModal
        visible={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        items={items}
        subtotal={subtotal}
        tax={tax}
        total={total}
        placing={placing}
        error={orderError}
        vatRatePct={vatRatePct}
        guestEnabled={!!isGuest}
        guestLabel={selectedGuestName || undefined}
        onToggleGuest={() => {
          const next = !isGuest
          toggleGuest()
          if (!next) setSelectedGuestName('')
        }}
        onPickGuest={() => setGuestPickerOpen(true)}
        multiCount={getAllDrafts().filter((d) => d.items.length > 0).length}
        otherDrafts={getAllDrafts().filter((d) => d.items.length > 0 && d.tableId !== (tableId ?? ''))}
        onSendAll={async () => {
          await placeAllDrafts()
        }}
        onEditItem={(it) => {
          const prod = (data ?? []).find((p) => p.id === it.productId)
          if (prod) {
            setSelected(prod)
            setEditingItem(it)
          }
        }}
        onSend={async () => {
          await placeOrder()
          if (!orderError) setFinalizeOpen(false)
        }}
        onProceedToCheckout={async () => {
          await placeOrder({ goToPayments: true })
        }}
        proceedLabel="Proceed to Checkout"
        cartNote={cartNote}
        couponCode={couponCode}
        onChangeCartNote={setCartNote}
        onChangeCouponCode={setCouponCode}
        discount={discount}
        couponError={couponError}
        onCouponBlur={validateCoupon}
        onValidateCoupon={validateCoupon}
      />

      <GuestPicker
        open={guestPickerOpen}
        onOpenChange={setGuestPickerOpen}
        onSelect={(g) => { if (!isGuest) toggleGuest(); setSelectedGuestName(g.full_name) }}
      />

      <ConfirmSheet
        open={infoOpen}
        title={infoTitle}
        description={infoDesc}
        confirmLabel="OK"
        cancelLabel="Close"
        onOpenChange={setInfoOpen}
        onConfirm={() => setInfoOpen(false)}
      />

      <Modal visible={successOpen} transparent animationType="fade" onRequestClose={() => setSuccessOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: AdminColors.card, borderRadius: 12, borderWidth: 1, borderColor: AdminColors.border, padding: 16, alignItems: 'center', justifyContent: 'center', width: 220 }}>
            <LottieView source={require('../../../assets/lottie/Success.json')} autoPlay loop={false} style={{ width: 140, height: 140 }} />
            <Text style={{ color: AdminColors.text, fontWeight: '800', marginTop: 8 }}>{successLabel}</Text>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}
