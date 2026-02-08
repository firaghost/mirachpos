import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Modal, TouchableOpacity, StyleSheet, FlatList } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { AdminColors } from '../../admin/theme/colors'
import { supabase } from '@/lib/supabase'
import { getNotifications, upsertNotification, markNotificationRead, markAllNotificationsRead as dbMarkAll, deleteReadNotifications } from '@/lib/db'

export type WaiterNotification = {
  id: string
  title: string
  body: string
  type?: string | null
  created_at: string
}

async function refreshFromDb(setItems: React.Dispatch<React.SetStateAction<WaiterNotification[]>>, setCount: React.Dispatch<React.SetStateAction<number>>, setReadIdsState: React.Dispatch<React.SetStateAction<Set<string>>>) {
  try {
    const rows = await getNotifications(50)
    const onlyOrders = rows.filter((r) => {
      const t = String(r.type || '').toLowerCase()
      return t === 'order_ready' || t === 'order_update' || t === 'order_completed'
    })
    const mapped: WaiterNotification[] = onlyOrders.map((r) => ({ id: String(r.id), title: String(r.title || 'Notification'), body: String(r.body || ''), type: (r.type as string | null) ?? null, created_at: String(r.created_at || new Date().toISOString()) }))
    setItems(mapped)
    const unread = onlyOrders.filter((r) => Number(r.read) === 0).length
    setCount(Number(unread) || 0)
    const readSet = new Set<string>(onlyOrders.filter((r) => Number(r.read) === 1).map((r) => String(r.id)))
    setReadIdsState(readSet)
  } catch {}
}

export function WaiterNotificationsBell() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<WaiterNotification[]>([])
  const [readIds, setReadIdsState] = useState<Set<string>>(new Set())
  const branchRef = useRef<string | null>(null)

  const styles = useMemo(() => StyleSheet.create({
    badge: { position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: 'white', fontSize: 10, fontWeight: '800' },
    sheet: { backgroundColor: AdminColors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12, maxHeight: '70%' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    title: { color: AdminColors.text, fontSize: 16, fontWeight: '700' },
    close: { color: AdminColors.accent, fontSize: 12 },
    item: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
    itemTitle: { color: AdminColors.text, fontWeight: '700' },
    itemBody: { color: AdminColors.subtext, fontSize: 12, marginTop: 2 },
    itemTime: { color: AdminColors.subtext, fontSize: 11, marginTop: 2 },
    iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  }), [])

  useEffect(() => { (async () => { try { await refreshFromDb(setItems, setCount, setReadIdsState) } catch {} })() }, [])

  useEffect(() => {
    let ch: any = null
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', user.id).maybeSingle()
        const branchId = (profile as any)?.branch_id as string | null
        branchRef.current = branchId
        if (!branchId) return
        ch = supabase
          .channel('mobile_waiter_orders_bell')
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, async (payload: any) => {
            try {
              const oldRow = payload?.old || {}
              const newRow = payload?.new || {}
              const orderId = String(newRow.id || '')
              const short = orderId.slice(0, 6)
              const next = String(newRow.status || '').toLowerCase()
              const prev = String(oldRow.status || '').toLowerCase()
              if (next === 'ready' && prev !== 'ready') {
                try {
                  // Fetch minimal order context for a nicer body
                  const { data: ord } = await supabase
                    .from('orders')
                    .select('table_id, is_guest, tables(name)')
                    .eq('id', orderId)
                    .maybeSingle()
                  const { data: items } = await supabase
                    .from('order_items')
                    .select('quantity, products(name)')
                    .eq('order_id', orderId)
                    .limit(3)
                  const typeLabel = ord?.table_id ? 'Dine-in' : 'Takeaway'
                  const tableName = (ord as any)?.tables?.[0]?.name || (ord as any)?.tables?.name || null
                  const typePart = ord?.table_id ? (tableName ? `${typeLabel} • Table ${tableName}` : typeLabel) : typeLabel
                  const preview = (items ?? []).map((r: any) => `${Number(r.quantity || 1)}× ${String(r.products?.name || 'Item')}`).join(', ')
                  const body = preview ? `#${short} • ${typePart} • ${preview}` : `#${short} • ${typePart}`
                  const item: WaiterNotification = { id: `order_ready:${orderId}`, title: 'Order ready', body, type: 'order_ready', created_at: new Date().toISOString() }
                  try { await upsertNotification(item) } catch {}
                } catch {
                  const item: WaiterNotification = { id: `order_ready:${orderId}`, title: 'Order ready', body: `Order #${short} is ready`, type: 'order_ready', created_at: new Date().toISOString() }
                  try { await upsertNotification(item) } catch {}
                }
                await refreshFromDb(setItems, setCount, setReadIdsState)
                return
              }
              const interesting = ['pending','preparing','served','completed','cancelled']
              if (next && next !== prev && interesting.includes(next)) {
                const item: WaiterNotification = { id: `order_update:${orderId}:${next}`, title: 'Order update', body: `Order #${short} → ${next}`, type: 'order_update', created_at: new Date().toISOString() }
                try { await upsertNotification(item) } catch {}
                await refreshFromDb(setItems, setCount, setReadIdsState)
              }
            } catch {}
          })
          .subscribe()
      } catch {}
    })()
    return () => { try { if (ch) supabase.removeChannel(ch) } catch {} }
  }, [])

  async function markRead(id: string) {
    try {
      await markNotificationRead(id)
      await refreshFromDb(setItems, setCount, setReadIdsState)
    } catch {}
  }

  async function markAllRead() {
    try { await dbMarkAll(); await refreshFromDb(setItems, setCount, setReadIdsState) } catch {}
  }

  async function clearRead() {
    try { await deleteReadNotifications(); await refreshFromDb(setItems, setCount, setReadIdsState) } catch {}
  }

  return (
    <>
      <View>
        <TouchableOpacity onPress={() => setOpen(true)} style={styles.iconWrap}>
          <MaterialIcons name="notifications-none" size={22} color={AdminColors.text} />
          {count > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{count > 9 ? '9+' : String(count)}</Text></View>
          )}
        </TouchableOpacity>
      </View>
      <Modal visible={open} animationType="slide" transparent onRequestClose={()=>setOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={()=>setOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={()=>{}}>
            <View style={styles.header}>
              <Text style={styles.title}>Notifications</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TouchableOpacity onPress={markAllRead}><Text style={[styles.close]}>Mark all read</Text></TouchableOpacity>
                <TouchableOpacity onPress={clearRead}><Text style={[styles.close]}>Clear read</Text></TouchableOpacity>
                <Text style={styles.close} onPress={()=>setOpen(false)}>Close</Text>
              </View>
            </View>
            {items.length === 0 ? (
              <Text style={{ color: AdminColors.subtext, fontSize: 13, paddingVertical: 8 }}>No notifications</Text>
            ) : (
              <FlatList
                data={items}
                keyExtractor={(it) => it.id}
                renderItem={({ item }) => {
                  const isRead = readIds.has(item.id)
                  return (
                    <View style={[styles.item, { opacity: isRead ? 0.6 : 1 }]}>
                      <TouchableOpacity activeOpacity={0.7} onPress={() => markRead(item.id)}>
                        <Text style={styles.itemTitle}>{item.title}</Text>
                        <Text style={styles.itemBody}>{item.body}</Text>
                        <Text style={styles.itemTime}>{new Date(item.created_at).toLocaleString()}</Text>
                      </TouchableOpacity>
                      {!isRead && (
                        <TouchableOpacity style={{ position: 'absolute', right: 0, top: 8, padding: 8 }} onPress={() => markRead(item.id)}>
                          <MaterialIcons name="done" size={18} color={AdminColors.accent} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )
                }}
              />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  )
}
