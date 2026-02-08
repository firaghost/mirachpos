import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, Modal, TextInput, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native'
import { supabase } from '@/lib/supabase'

export type GuestRow = { id: string; full_name: string; type?: string | null }

interface GuestPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (guest: GuestRow) => void
}

export function GuestPicker({ open, onOpenChange, onSelect }: GuestPickerProps) {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<GuestRow[]>([])

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', uid)
        .maybeSingle()
      setOrgId((profile as any)?.organization_id ?? null)
    })()
  }, [])

  const search = useMemo(() => query.trim(), [query])

  useEffect(() => {
    if (!open) return
    if (!orgId) return
    let active = true
    const run = async () => {
      setLoading(true)
      try {
        // Simple ilike search on full_name within org
        const req = supabase
          .from('guests')
          .select('id, full_name, type')
          .eq('organization_id', orgId)
          .order('full_name', { ascending: true })
        const { data, error } = search
          ? await req.ilike('full_name', `%${search}%`)
          : await req
        if (!active) return
        if (error) throw error
        setRows(((data as any[]) ?? []).map((g) => ({ id: g.id as string, full_name: g.full_name as string, type: g.type as string | null })))
      } finally {
        setLoading(false)
      }
    }
    run()
    return () => { active = false }
  }, [open, orgId, search])

  const createGuest = async (name: string) => {
    if (!orgId) return null
    const n = name.trim()
    if (!n) return null
    const { data: created, error } = await supabase
      .from('guests')
      .insert({ organization_id: orgId, full_name: n, type: 'invited', is_active: true })
      .select('id, full_name, type')
      .single()
    if (error) return null
    return { id: (created as any).id as string, full_name: (created as any).full_name as string, type: (created as any).type as string | null }
  }

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <Text style={styles.title}>Select guest</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search guests by name"
            style={styles.input}
            autoFocus
          />
          {loading ? (
            <View style={styles.center}><ActivityIndicator color="#2C1810" /></View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                search.length > 0 ? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>No guests found</Text>
                    <TouchableOpacity style={styles.createBtn} onPress={async () => {
                      const g = await createGuest(search)
                      if (g) { onSelect(g); onOpenChange(false) }
                    }}>
                      <Text style={styles.createBtnText}>Create "{search}"</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.empty}><Text style={styles.emptyText}>Type to search guests…</Text></View>
                )
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.row} onPress={() => { onSelect(item); onOpenChange(false) }}>
                  <Text style={styles.rowName}>{item.full_name}</Text>
                  {!!item.type && <Text style={styles.rowType}>{item.type}</Text>}
                </TouchableOpacity>
              )}
            />
          )}
          <View style={styles.footer}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => onOpenChange(false)}>
              <Text style={styles.btnOutlineText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel: { width: '100%', maxWidth: 480, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#eee', maxHeight: '80%' },
  title: { fontWeight: '700', color: '#2C1810', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6, marginBottom: 8 },
  center: { paddingVertical: 16 },
  empty: { alignItems: 'center', paddingVertical: 16 },
  emptyText: { color: '#666', fontSize: 12, marginBottom: 8 },
  createBtn: { backgroundColor: '#2C1810', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  createBtnText: { color: '#fff', fontWeight: '700' },
  row: { paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' },
  rowName: { color: '#222' },
  rowType: { color: '#666', fontSize: 12 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8 },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, minWidth: 92, alignItems: 'center' },
  btnOutline: { backgroundColor: '#f5f5f5' },
  btnOutlineText: { color: '#444', fontWeight: '600' },
})
