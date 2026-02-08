import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Modal, TouchableOpacity, StyleSheet, FlatList } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { IconButton } from '@/components/ui/IconButton'
import { AdminColors } from '../theme/colors'
import { supabase } from '@/lib/supabase'
import { getNotifications, getUnreadCount, upsertNotification, markNotificationRead, markAllNotificationsRead as dbMarkAll, getLowSeenSet, addLowSeen, deleteReadNotifications } from '@/lib/db'

export type AdminNotification = {
  id: string
  title: string
  body: string
  type?: string | null
  created_at: string
}

async function refreshFromDb(setItems: React.Dispatch<React.SetStateAction<AdminNotification[]>>, setCount: React.Dispatch<React.SetStateAction<number>>, setReadIdsState: React.Dispatch<React.SetStateAction<Set<string>>>) {
  try {
    const rows = await getNotifications(50)
    const onlyLow = rows.filter((r) => String(r.type || '').toLowerCase() === 'low_stock')
    const mapped: AdminNotification[] = onlyLow.map((r) => ({ id: String(r.id), title: String(r.title || 'Notification'), body: String(r.body || ''), type: (r.type as string | null) ?? null, created_at: String(r.created_at || new Date().toISOString()) }))
    setItems(mapped)
    const unread = onlyLow.filter((r) => Number(r.read) === 0).length
    setCount(Number(unread) || 0)
    const readSet = new Set<string>(onlyLow.filter((r) => Number(r.read) === 1).map((r) => String(r.id)))
    setReadIdsState(readSet)
  } catch {}
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<AdminNotification[]>([])
  const branchRef = useRef<string | null>(null)
  const [readIds, setReadIdsState] = useState<Set<string>>(new Set())

  const styles = useMemo(() => StyleSheet.create({
    badge: {
      position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16,
      paddingHorizontal: 3, borderRadius: 8, backgroundColor: '#dc2626',
      alignItems: 'center', justifyContent: 'center'
    },
    badgeText: { color: 'white', fontSize: 10, fontWeight: '800' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: AdminColors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12, maxHeight: '70%' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    title: { color: AdminColors.text, fontSize: 16, fontWeight: '700' },
    close: { color: AdminColors.accent, fontSize: 12 },
    item: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
    itemTitle: { color: AdminColors.text, fontWeight: '700' },
    itemBody: { color: AdminColors.subtext, fontSize: 12, marginTop: 2 },
    itemTime: { color: AdminColors.subtext, fontSize: 11, marginTop: 2 },
  }), [])

  // Prime recent (low_stock) notifications for this branch
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!cancelled) await refreshFromDb(setItems, setCount, setReadIdsState)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', user.id).maybeSingle()
        const branchId = (profile as any)?.branch_id as string | null
        branchRef.current = branchId
        if (!branchId || cancelled) return
        // 1) Pull recent low_stock notifications via audience and persist
        const { data } = await supabase
          .from('notifications')
          .select('id, title, body, type, created_at, notification_audience!inner(branch_id)')
          .eq('notification_audience.branch_id', branchId)
          .order('created_at', { ascending: false })
          .limit(10)
        const remote: AdminNotification[] = (data ?? [])
          .filter((n: any) => String(n?.type || '').toLowerCase() === 'low_stock')
          .map((n: any) => ({ id: String(n.id), title: String(n.title || 'Notification'), body: String(n.body || ''), type: (n.type as string | null) ?? null, created_at: String(n.created_at || new Date().toISOString()) }))
        for (const n of remote) { try { await upsertNotification(n) } catch {} }
        if (!cancelled) await refreshFromDb(setItems, setCount, setReadIdsState)

        // 2) Manual check: scan inventory for low items and add missing entries
        try {
          const { data: inv } = await supabase
            .from('inventory_items')
            .select('id, name, unit, current_stock, low_stock_threshold')
            .eq('branch_id', branchId)
          const low = (inv ?? []).filter((it: any) => {
            const cur = Number(it.current_stock ?? 0)
            const thr = Number(it.low_stock_threshold ?? 0)
            return thr > 0 && cur < thr
          })
          const seen = await getLowSeenSet()
          const toAdd: AdminNotification[] = []
          for (const it of low) {
            const id = String(it.id)
            if (!seen.has(id)) {
              const title = `Low stock: ${String(it.name || 'Item')}`
              const body = `${String(it.name || 'Item')} is low: ${Number(it.current_stock ?? 0)}/${Number(it.low_stock_threshold ?? 0)} ${String(it.unit || '')}`
              const n: AdminNotification = { id, title, body, type: 'low_stock', created_at: new Date().toISOString() }
              toAdd.push(n)
              try { await upsertNotification(n) } catch {}
              try { await addLowSeen(id) } catch {}
            }
          }
          if (!cancelled) await refreshFromDb(setItems, setCount, setReadIdsState)
        } catch {}
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  // Realtime: branch-scoped audience INSERT → fetch notification (low_stock only)
  useEffect(() => {
    let ch: any = null
    ;(async () => {
      try {
        const branchId = branchRef.current
        if (!branchId) return
        ch = supabase
          .channel('mobile_admin_low_stock_bell')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_audience', filter: `branch_id=eq.${branchId}` }, async (payload: any) => {
            try {
              const notifId = String(payload?.new?.notification_id || '')
              if (!notifId) return
              const { data: notif } = await supabase
                .from('notifications')
                .select('id, title, body, type, created_at')
                .eq('id', notifId)
                .maybeSingle()
              if (!notif) return
              const t = String((notif as any).type || '').toLowerCase()
              if (t !== 'low_stock') return
              const item: AdminNotification = { id: String(notif.id), title: String(notif.title || 'Notification'), body: String(notif.body || ''), type: (notif.type as string | null) ?? null, created_at: String(notif.created_at || new Date().toISOString()) }
              try { await upsertNotification(item) } catch {}
              await refreshFromDb(setItems, setCount, setReadIdsState)
            } catch {}
          })
          .subscribe()
      } catch {}
    })()
    return () => { try { if (ch) supabase.removeChannel(ch) } catch {} }
  }, [])

  // Polling fallback: manual low stock scan on interval
  useEffect(() => {
    let t: any = null
    let cancelled = false
    ;(async () => {
      try {
        const bid = branchRef.current
        if (!bid) return
        const poll = async () => {
          try {
            const { data: inv } = await supabase
              .from('inventory_items')
              .select('id, name, unit, current_stock, low_stock_threshold')
              .eq('branch_id', bid)
            const rows = inv ?? []
            const low = rows.filter((it: any) => Number(it.low_stock_threshold ?? 0) > 0 && Number(it.current_stock ?? 0) < Number(it.low_stock_threshold ?? 0))
            const seenRaw = await SecureStore.getItemAsync(LOW_SEEN_KEY)
            const seen = new Set<string>(seenRaw ? (JSON.parse(seenRaw) as string[]) : [])
            const toAdd: AdminNotification[] = []
            for (const it of low) {
              const id = String(it.id)
              if (!seen.has(id)) {
                const title = `Low stock: ${String(it.name || 'Item')}`
                const body = `${String(it.name || 'Item')} is low: ${Number(it.current_stock ?? 0)}/${Number(it.low_stock_threshold ?? 0)} ${String(it.unit || '')}`
                toAdd.push({ id, title, body, type: 'low_stock', created_at: new Date().toISOString() })
                seen.add(id)
              }
            }
            if (toAdd.length > 0 && !cancelled) {
              setItems((curr) => [...toAdd, ...curr].slice(0, 20))
              const newlyUnread = toAdd.filter((it) => !readIds.has(it.id)).length
              if (newlyUnread > 0) setCount((c) => c + newlyUnread)
              try { await SecureStore.setItemAsync(LOW_SEEN_KEY, JSON.stringify(Array.from(seen))) } catch {}
            }
          } catch {}
        }
        await poll()
        t = setInterval(poll, 60000)
      } catch {}
    })()
    return () => { cancelled = true; try { if (t) clearInterval(t) } catch {} }
  }, [])

  function openPanel() { setOpen(true) }

  async function markRead(id: string) {
    try {
      await markNotificationRead(id)
      await refreshFromDb(setItems, setCount, setReadIdsState)
    } catch {}
  }

  async function markAllRead() {
    try {
      await dbMarkAll()
      await refreshFromDb(setItems, setCount, setReadIdsState)
    } catch {}
  }

  async function clearRead() {
    try {
      await deleteReadNotifications()
      await refreshFromDb(setItems, setCount, setReadIdsState)
    } catch {}
  }

  return (
    <>
      <View>
        <IconButton onPress={openPanel}>
          <MaterialIcons name="notifications-none" size={22} color={AdminColors.text} />
          {count > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{count > 9 ? '9+' : String(count)}</Text></View>
          )}
        </IconButton>
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
