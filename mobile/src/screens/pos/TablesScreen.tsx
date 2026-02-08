import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTablesLocal, upsertTables } from '@/lib/db'
import { createPosTable, fetchMe, fetchPosTables, updatePosTable } from '@/lib/mirachposSession'
import { useMobileOrderStore } from '@/state/orderStore'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, FlatList, Modal, TextInput, Alert, RefreshControl, Platform } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
// Header simplified per new design
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'
import { ChatButton } from '../../components/ui/ChatButton'
import { SurfaceCard } from '../../components/ui/SurfaceCard'
import { IconButton } from '../../components/ui/IconButton'
import { TableIcon } from '../../components/pos/TableIcon'

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Tables request timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(id)
        resolve(value)
      },
      (err) => {
        clearTimeout(id)
        reject(err)
      }
    )
  })
}

interface TableRow {
  id: string
  name: string
  status: string | null
  zone?: string | null
}

async function fetchTables(): Promise<TableRow[]> {
  try {
    const tables = await withTimeout(fetchPosTables(), 15000)
    const rows: TableRow[] = (tables ?? []).map((t) => ({
      id: String(t.id),
      name: String(t.name || 'Table'),
      status: t.status ? String(t.status) : null,
      zone: (t.area as any) ?? null,
    }))
    try {
      await upsertTables(rows.map((r) => ({ id: r.id, branch_id: null, name: r.name, status: r.status ?? null })))
    } catch {}
    return rows
  } catch (e) {
    const local = await getTablesLocal()
    if (local.length > 0) return local.map((t) => ({ id: t.id, name: t.name, status: t.status ?? null, zone: null }))
    return []
  }
}

export function TablesScreen({ onOpenOrders, onTableSelected }: { onOpenOrders?: () => void; onTableSelected?: () => void }) {
  const { isDark } = useAppTheme()
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['tables'],
    queryFn: fetchTables,
  })
  const zoneSupported = useMemo(() => {
    const arr = (data ?? []) as TableRow[]
    return arr.some((t) => t.zone != null)
  }, [data])
  const setTable = useMobileOrderStore((s) => s.setTable)
  const setTables = useMobileOrderStore((s) => s.setTables)
  const currentTableId = useMobileOrderStore((s) => s.tableId)
  const DEFAULT_ZONES = ['Main hall', 'Terrace', 'Backyard']
  const [activeZone, setActiveZone] = useState('Main hall')
  const insets = useSafeAreaInsets()

  const [addOpen, setAddOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [tableName, setTableName] = useState('')
  const [selectedZone, setSelectedZone] = useState('Main hall')

  // Selection model (multi-select enabled)
  const [selectedMap, setSelectedMap] = useState<Map<string, string>>(new Map())
  const [selectionOrder, setSelectionOrder] = useState<string[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusTarget, setStatusTarget] = useState<TableRow | null>(null)
  const [canManageTables, setCanManageTables] = useState(false)
  const [query, setQuery] = useState('')

  React.useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const me = await fetchMe()
        if (!mounted) return
        if (!me.ok) return
        const role = String(me.me.role || '')
        setCanManageTables(role === 'Cafe Owner' || role === 'Branch Manager' || role === 'Waiter Manager')
      } catch {}
    })()
    return () => {
      mounted = false
    }
  }, [])

  const tablesFiltered = useMemo(() => {
    const arr = zoneSupported
      ? ((data ?? []) as TableRow[]).filter((t) => (t.zone || 'Main hall') === activeZone)
      : ((data ?? []) as TableRow[])
    const q = query.trim().toLowerCase()
    if (!q) return arr
    return arr.filter((t) => (t.name || '').toLowerCase().includes(q))
  }, [data, zoneSupported, activeZone, query])

  const toggleSelect = (t: TableRow) => {
    setSelectedMap((prev) => {
      const next = new Map(prev)
      if (next.has(t.id)) {
        next.delete(t.id)
        setSelectionOrder((ord) => ord.filter((x) => x !== t.id))
      } else {
        next.set(t.id, t.name)
        setSelectionOrder((ord) => [...ord, t.id])
      }
      return next
    })
  }

  const clearSelection = () => { setSelectedMap(new Map()); setSelectionOrder([]) }

  const proceedToPos = () => {
    if (selectionOrder.length === 0) return
    const primaryId = selectionOrder[0]
    const primaryName = (data as TableRow[] | null)?.find((x) => x.id === primaryId)?.name ?? null
    const extras = selectionOrder.slice(1)
    const extraNames = extras.map((id) => selectedMap.get(id) || '').filter(Boolean)
    setTables(primaryId, primaryName, extras, extraNames as string[])
    onTableSelected && onTableSelected()
  }

  const onRefresh = async () => {
    try { setRefreshing(true); await refetch() } finally { setRefreshing(false) }
  }

  const markStatus = async (status: 'available' | 'occupied' | 'reserved' | 'cleaning') => {
    const t = statusTarget
    setStatusOpen(false)
    if (!t) return
    try {
      const mapped = status === 'available' ? 'Free' : status === 'occupied' ? 'Occupied' : status === 'reserved' ? 'Reserved' : 'Cleaning'
      await updatePosTable({ tableId: t.id, patch: { status: mapped } })
      await refetch()
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? 'Unable to update table status')
    } finally {
      setStatusTarget(null)
    }
  }

  const createTable = async () => {
    const name = tableName.trim()
    if (!name) { Alert.alert('Table name required'); return }
    try {
      setAdding(true)
      await createPosTable({ name, area: zoneSupported ? selectedZone : null, status: 'Free' })
      setAddOpen(false)
      setTableName('')
      await refetch()
    } catch (e: any) {
      Alert.alert('Create table failed', e?.message ?? 'Unable to create table')
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: AdminColors.bg }]}>
      {isLoading && (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={AdminColors.accent} />
          <Text style={[styles.loadingText, { color: AdminColors.subtext }]}>Loading tables…</Text>
        </View>
      )}
      {error && !isLoading && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Unable to load tables</Text>
        </View>
      )}
      {!isLoading && !error && (
        <>
          <FlatList
            data={tablesFiltered}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={[styles.gridContent, { paddingBottom: insets.bottom + 24 }]}
            columnWrapperStyle={styles.row}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={AdminColors.accent} />}
            stickyHeaderIndices={[0]}
            ListHeaderComponentStyle={[styles.stickyHeader, { backgroundColor: AdminColors.bg }]}
            ListHeaderComponent={
              <View style={styles.stickyHeader}>
                <View style={styles.headerRow}>
                  <IconButton>
                    <MaterialIcons name="person-outline" size={22} color={AdminColors.accent} />
                  </IconButton>
                  <Text style={[styles.headerTitle, { color: AdminColors.text }]}>Select table</Text>
                  <IconButton onPress={onOpenOrders}>
                    <MaterialIcons name="event-note" size={22} color={AdminColors.accent} />
                  </IconButton>
                </View>
                <View style={[styles.searchWrap, { borderColor: AdminColors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)' }]}>
                  <MaterialIcons name="search" size={18} color={AdminColors.subtext} style={{ marginRight: 8 }} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search table"
                    placeholderTextColor={AdminColors.subtext}
                    style={[styles.searchInput, { color: AdminColors.text }]}
                  />
                </View>
                {zoneSupported && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.zonesBar} contentContainerStyle={styles.zonesContent}>
                    {Array.from(new Set([...(DEFAULT_ZONES as string[]), ...((data ?? []).map((t: any) => (t as any).zone || 'Main hall'))])).map((z) => (
                      <React.Fragment key={z}>
                        <ChatButton
                          title={z}
                          size="sm"
                          variant={activeZone === z ? 'primary' : 'secondary'}
                          onPress={() => setActiveZone(z)}
                          style={{ marginRight: 8 }}
                        />
                      </React.Fragment>
                    ))}
                  </ScrollView>
                )}
              </View>
            }
            renderItem={({ item }) => {
              const selected = selectionOrder.includes(item.id)
              const statusStr = (item.status ?? '').toLowerCase() as any

              return (
                <TableIcon
                  label={item.name}
                  selected={selected}
                  multiSelected={selected}
                  status={statusStr}
                  onPress={() => toggleSelect(item)}
                  onLongPress={() => { setStatusTarget(item); setStatusOpen(true) }}
                />
              )
            }}
          />
          {/* Bottom selection action bar */}
          {selectionOrder.length > 0 && (
            <SurfaceCard
              variant="card"
              elevated
              style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom -12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Text style={{ color: AdminColors.subtext, fontWeight: '600' }}>{selectionOrder.length} selected</Text>
              <View style={{ flexDirection: 'row' }}>
                <ChatButton title="Clear" size="sm" onPress={clearSelection} style={{ marginRight: 8 }} />
                <ChatButton title="Proceed" size="sm" variant="primary" onPress={proceedToPos} />
              </View>
            </SurfaceCard>
          )}

          {/* Status quick actions (bottom sheet) */}
          <Modal visible={statusOpen} animationType="slide" transparent onRequestClose={() => setStatusOpen(false)}>
            <View style={[styles.modalBackdrop, { justifyContent: 'flex-end' }]}>
              <SurfaceCard variant="card" elevated style={{ width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: Math.max(insets.bottom, 12) }}>
                <View style={{ alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: AdminColors.border }} />
                </View>
                <Text style={[styles.modalTitle, { marginBottom: 8 }]}>Table {statusTarget?.name}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <ChatButton title="Mark Cleaning" onPress={() => markStatus('cleaning')} variant="secondary" />
                  <ChatButton title="Mark Complete" onPress={() => markStatus('available')} variant="primary" />
                </View>
                <View style={{ alignItems: 'flex-end', marginTop: 8 }}>
                  <ChatButton title="Close" onPress={() => setStatusOpen(false)} variant="secondary" size="sm" />
                </View>
              </SurfaceCard>
            </View>
          </Modal>
        </>
      )}
    </View>

    {/* Add Table sheet */}
    <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
      <View style={[styles.modalBackdrop, { justifyContent: 'flex-end' }]}>
        <SurfaceCard variant="card" elevated style={{ width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: Math.max(insets.bottom, 12) }}>
          <View style={{ alignItems: 'center', marginBottom: 10 }}>
            <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: AdminColors.border }} />
          </View>
          <Text style={styles.modalTitle}>Add table</Text>
          <TextInput
            placeholder="Table name (e.g. T1)"
            value={tableName}
            onChangeText={setTableName}
            style={[styles.input, { borderColor: AdminColors.border, color: AdminColors.text }]}
            autoFocus
          />
          {zoneSupported && (
            <>
              <Text style={[styles.modalTitle, { marginTop: 0, marginBottom: 8 }]}>Zone</Text>
              <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                {DEFAULT_ZONES.map((z) => (
                  <React.Fragment key={z}>
                    <ChatButton title={z} size="sm" variant={selectedZone === z ? 'primary' : 'secondary'} onPress={() => setSelectedZone(z)} style={{ marginRight: 8 }} />
                  </React.Fragment>
                ))}
              </View>
            </>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <ChatButton title="Cancel" onPress={() => setAddOpen(false)} size="sm" style={{ marginRight: 8 }} />
            <ChatButton title={adding ? 'Creating…' : 'Create'} onPress={createTable} disabled={adding} variant="primary" size="sm" />
          </View>
        </SurfaceCard>
      </View>
    </Modal>

    {/* Floating add button (admin only) */}
    {canManageTables && (
      <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 70, backgroundColor: AdminColors.accent }]} onPress={() => setAddOpen(true)}>
        <MaterialIcons name="add" size={28} color="#1a1a1a" />
      </TouchableOpacity>
    )}
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    paddingVertical: 8,
    paddingHorizontal: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyHeader: { paddingBottom: 8, paddingTop: 8, paddingHorizontal: 12, zIndex: 10, elevation: 2 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 40,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 8 : 6 },
  zonesBar: { marginTop: 6, marginBottom: 6, paddingHorizontal: 12 },
  zonesContent: { paddingRight: 12, alignItems: 'center' },
  zoneChip: {
    borderWidth: 1,
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneChipActive: {},
  zoneChipText: { fontSize: 14, fontWeight: '500' },
  zoneChipTextActive: {},
  gridContent: { paddingHorizontal: 12, paddingTop: 8 },
  row: { justifyContent: 'space-between', marginBottom: 10 },
  tableButton: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  tableButtonSelected: {},
  tableButtonOccupied: {},
  tableText: { fontSize: 18, fontWeight: '700' },
  tableTextSelected: {
    color: '#fff',
  },
  tableArt: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  tableNameBadge: { position: 'absolute', bottom: 8, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, minWidth: 40, alignItems: 'center' },
  tableTextOverlay: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  selectBadge: { position: 'absolute', top: 6, right: 6, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2 },
  selectBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  // Status flag
  statusBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(107,114,128,0.9)', // default gray
  },
  statusAvailable: { backgroundColor: 'rgba(5,150,105,0.95)' }, // emerald-600
  statusOccupied: { backgroundColor: 'rgba(234,88,12,0.95)' },  // orange-600
  statusReserved: { backgroundColor: 'rgba(37,99,235,0.95)' },  // blue-600
  statusCleaning: { backgroundColor: 'rgba(107,114,128,0.95)' }, // gray-600
  statusBadgeText: { color: '#fff', fontWeight: '700', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { marginTop: 6, fontSize: 12 },
  errorText: { fontSize: 12, color: '#b91c1c' },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '86%', borderRadius: 12, borderWidth: 1, padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: AdminColors.text, marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, color: AdminColors.text },
  modalBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  modalBtnText: { fontWeight: '600', color: AdminColors.text },
  modalBtnPrimary: {},
  modalBtnPrimaryText: {},
  // Quick action modal styles
  quickCard: { width: '86%', borderRadius: 12, borderWidth: 1, padding: 16 },
  quickBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  quickBtnText: { fontWeight: '600' },
})
