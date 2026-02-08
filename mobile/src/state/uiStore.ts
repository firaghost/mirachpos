import { create } from 'zustand'

type TabKey = 'POS' | 'Tables' | 'Payments' | 'Profile'

interface UIState {
  ordersOverlayOpen: boolean
  focusOrderId: string | null
  focusPaymentOrderId: string | null
  activeTab: TabKey
  editingOrderId: string | null
  finalizeOpenPending: boolean
  openOrders: (focusId?: string | null) => void
  closeOrders: () => void
  setActiveTab: (tab: TabKey) => void
  setEditingOrder: (id: string | null) => void
  requestFinalizeOpen: () => void
  consumeFinalizeOpen: () => void
  setFocusPaymentOrder: (id: string | null) => void
  consumeFocusPayment: () => void
}

export const useUiStore = create<UIState>()((set) => ({
  ordersOverlayOpen: false,
  focusOrderId: null,
  focusPaymentOrderId: null,
  activeTab: 'Tables',
  editingOrderId: null,
  finalizeOpenPending: false,
  openOrders: (focusId) => set({ ordersOverlayOpen: true, focusOrderId: focusId ?? null }),
  closeOrders: () => set({ ordersOverlayOpen: false, focusOrderId: null }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setEditingOrder: (id) => set({ editingOrderId: id }),
  requestFinalizeOpen: () => set({ finalizeOpenPending: true }),
  consumeFinalizeOpen: () => set({ finalizeOpenPending: false }),
  setFocusPaymentOrder: (id) => set({ focusPaymentOrderId: id }),
  consumeFocusPayment: () => set({ focusPaymentOrderId: null }),
}))
