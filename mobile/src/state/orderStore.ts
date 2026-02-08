import { create } from 'zustand'

export type MobileOrderItem = {
  id: string
  productId: string
  name: string
  price: number
  quantity: number
  modifiers?: string[]
  note?: string
}

interface MobileOrderState {
  items: MobileOrderItem[]
  tableId: string | null
  tableName: string | null
  isGuest: boolean
  guestName: string
  extraTableIds: string[]
  extraTableNames: string[]
  cartNote: string
  couponCode: string
  drafts: Record<string, { items: MobileOrderItem[]; isGuest: boolean; guestName: string; tableName: string | null; cartNote?: string; couponCode?: string }>
  replaceItems: (items: MobileOrderItem[]) => void
  addItem: (item: Omit<MobileOrderItem, 'id' | 'quantity'> & { quantity?: number }) => void
  removeItem: (id: string) => void
  updateQty: (id: string, delta: number) => void
  setItemNote: (id: string, note: string) => void
  setItemModifiers: (id: string, modifiers: string[]) => void
  updateItem: (id: string, changes: Partial<Pick<MobileOrderItem, 'quantity' | 'modifiers' | 'note'>>) => void
  setTable: (id: string | null, name: string | null) => void
  setTables: (primaryId: string | null, primaryName: string | null, extraIds: string[], extraNames: string[]) => void
  toggleGuest: () => void
  setIsGuest: (flag: boolean) => void
  setGuestName: (name: string) => void
  setCartNote: (note: string) => void
  setCouponCode: (code: string) => void
  getAllDrafts: () => Array<{ tableId: string; tableName: string | null; items: MobileOrderItem[]; isGuest: boolean; guestName: string }>
  clear: () => void
}

export const useMobileOrderStore = create<MobileOrderState>()((set, get) => ({
      items: [],
      tableId: null,
      tableName: null,
      isGuest: false,
      guestName: '',
      extraTableIds: [],
      extraTableNames: [],
      cartNote: '',
      couponCode: '',
      drafts: {},
      replaceItems: (items) => set(() => ({ items })),
      addItem: (p) =>
        set((state) => {
          const sameLine = state.items.find((i) =>
            i.productId === p.productId &&
            JSON.stringify(i.modifiers ?? []) === JSON.stringify(p.modifiers ?? []) &&
            (i.note ?? '') === (p.note ?? '')
          )
          if (sameLine) {
            return {
              items: state.items.map((i) =>
                i === sameLine ? { ...i, quantity: i.quantity + (p.quantity ?? 1) } : i,
              ),
            }
          }
          return {
            items: [
              ...state.items,
              {
                id: Math.random().toString(36).slice(2),
                productId: p.productId,
                name: p.name,
                price: p.price,
                quantity: p.quantity ?? 1,
                modifiers: p.modifiers ?? [],
                note: p.note ?? '',
              },
            ],
          }
        }),
      removeItem: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
      updateQty: (id, delta) =>
        set((state) => ({
          items: state.items
            .map((i) =>
              i.id === id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i,
            )
            .filter((i) => i.quantity > 0),
        })),
      setItemNote: (id, note) => set((state) => ({
        items: state.items.map((i) => i.id === id ? { ...i, note } : i),
      })),
      setItemModifiers: (id, modifiers) => set((state) => ({
        items: state.items.map((i) => i.id === id ? { ...i, modifiers } : i),
      })),
      updateItem: (id, changes) => set((state) => ({
        items: state.items.map((i) => i.id === id ? {
          ...i,
          ...(typeof changes.quantity === 'number' ? { quantity: Math.max(0, changes.quantity) } : {}),
          ...(changes.modifiers ? { modifiers: changes.modifiers } : {}),
          ...(typeof changes.note === 'string' ? { note: changes.note } : {}),
        } : i).filter((i) => i.quantity > 0),
      })),
      setTable: (id, name) => set((state) => {
        const prevId = state.tableId
        if (prevId) {
          // save current into drafts
          const prevDrafts = { ...(state.drafts || {}) }
          prevDrafts[prevId] = { items: state.items, isGuest: state.isGuest, guestName: state.guestName, tableName: state.tableName, cartNote: state.cartNote, couponCode: state.couponCode }
          state.drafts = prevDrafts as any
        }
        if (id) {
          const existing = state.drafts[id]
          if (existing) {
            return { tableId: id, tableName: name, items: existing.items, isGuest: existing.isGuest, guestName: existing.guestName, extraTableIds: [], extraTableNames: [], cartNote: existing.cartNote ?? '', couponCode: existing.couponCode ?? '' }
          }
        }
        return { tableId: id, tableName: name, items: [], isGuest: false, guestName: '', extraTableIds: [], extraTableNames: [], cartNote: '', couponCode: '' }
      }),
      setTables: (primaryId, primaryName, extraIds, extraNames) => set((state) => {
        const prevId = state.tableId
        if (prevId) {
          const prevDrafts = { ...(state.drafts || {}) }
          prevDrafts[prevId] = { items: state.items, isGuest: state.isGuest, guestName: state.guestName, tableName: state.tableName, cartNote: state.cartNote, couponCode: state.couponCode }
          state.drafts = prevDrafts as any
        }
        if (primaryId) {
          const existing = state.drafts[primaryId]
          if (existing) {
            return { tableId: primaryId, tableName: primaryName, items: existing.items, isGuest: existing.isGuest, guestName: existing.guestName, extraTableIds: extraIds || [], extraTableNames: extraNames || [], cartNote: existing.cartNote ?? '', couponCode: existing.couponCode ?? '' }
          }
        }
        return { tableId: primaryId, tableName: primaryName, items: [], isGuest: false, guestName: '', extraTableIds: extraIds || [], extraTableNames: extraNames || [], cartNote: '', couponCode: '' }
      }),
      toggleGuest: () => set((state) => ({ isGuest: !state.isGuest })),
      setIsGuest: (flag) => set(() => ({ isGuest: flag })),
      setGuestName: (name) => set(() => ({ guestName: name })),
      setCartNote: (note) => set(() => ({ cartNote: note })),
      setCouponCode: (code) => set(() => ({ couponCode: code })),
      getAllDrafts: () => {
        const s = get()
        const all: Array<{ tableId: string; tableName: string | null; items: MobileOrderItem[]; isGuest: boolean; guestName: string }> = []
        if (s.tableId) {
          all.push({ tableId: s.tableId, tableName: s.tableName, items: s.items, isGuest: s.isGuest, guestName: s.guestName })
        }
        for (const [tid, d] of Object.entries(s.drafts)) {
          if (tid === s.tableId) continue
          all.push({ tableId: tid, tableName: d.tableName ?? null, items: d.items, isGuest: d.isGuest, guestName: d.guestName })
        }
        return all
      },
      clear: () =>
        set(() => ({
          items: [],
          tableId: null,
          tableName: null,
          isGuest: false,
          guestName: '',
          extraTableIds: [],
          extraTableNames: [],
          cartNote: '',
          couponCode: '',
          drafts: {},
        }))
    }))
