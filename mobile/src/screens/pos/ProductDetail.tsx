import React, { useEffect, useMemo, useState } from 'react'
import { Modal, View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, TextInput, TouchableWithoutFeedback } from 'react-native'
import { ModifiersSheet, type ModifierGroup } from './ModifiersSheet'
import { supabase } from '@/lib/supabase'
import * as Haptics from 'expo-haptics'
import { AdminColors } from '../../admin/theme/colors'

export interface ProductDetailPayload {
  productId: string
  name: string
  price: number
  quantity: number
  modifiers: string[]
  note?: string
}

interface ProductLike {
  id: string
  name: string
  price: number
  image_url?: string | null
}

interface Props {
  visible: boolean
  product: ProductLike | null
  onClose: () => void
  onAdd: (payload: ProductDetailPayload) => void
  initialQty?: number
  initialModifiers?: string[]
  initialNote?: string
  editingItemId?: string | null
}

export function ProductDetailModal({ visible, product, onClose, onAdd, initialQty, initialModifiers, initialNote, editingItemId }: Props) {
  const [qty, setQty] = useState(initialQty ?? 1)
  const [note, setNote] = useState(initialNote ?? '')
  const [modifiers, setModifiers] = useState<string[]>(initialModifiers ?? [])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [groups, setGroups] = useState<ModifierGroup[]>([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [description, setDescription] = useState<string | null>(null)

  const price = useMemo(() => Number(product?.price ?? 0), [product])
  const total = useMemo(() => price * qty, [price, qty])

  const reset = () => {
    setQty(1)
    setNote('')
    setModifiers([])
  }

  useEffect(() => {
    const load = async () => {
      if (!product?.id) { setGroups([]); return }
      setLoadingGroups(true)
      try {
        const { data: mappings, error: mapErr } = await supabase
          .from('product_modifier_groups')
          .select('group_id, modifier_groups(id, name, min_select, max_select)')
          .eq('product_id', product.id)
        if (mapErr) throw mapErr
        let groupIds = (mappings ?? []).map((r: any) => r.group_id as string)
        // Fallback: if no direct mapping, use groups that apply to this product's category
        if (groupIds.length === 0 && product?.id) {
          const { data: prodRow } = await supabase.from('products').select('category').eq('id', product.id).maybeSingle()
          const cat = (prodRow as any)?.category as string | null
          if (cat) {
            const { data: catGroups } = await supabase
              .from('modifier_groups')
              .select('id, name, min_select, max_select, applies_to_categories')
              .contains('applies_to_categories', [cat])
            groupIds = (catGroups ?? []).map((g: any) => g.id as string)
            if ((catGroups ?? []).length > 0) {
              // synthesize mappings structure for unified mapping below
              (mappings as any) = (catGroups ?? []).map((g: any) => ({ group_id: g.id, modifier_groups: g }))
            }
          }
        }
        if (groupIds.length === 0) { setGroups([]); return }
        const { data: options, error: optErr } = await supabase
          .from('modifiers')
          .select('id, group_id, name, price_delta')
          .in('group_id', groupIds)
        if (optErr) throw optErr
        const mapped: ModifierGroup[] = (mappings ?? []).map((r: any) => {
          const g = (r as any).modifier_groups
          const opts = (options ?? []).filter((o: any) => o.group_id === g.id).map((o: any) => o.name as string)
          const maxSelect = Number(g?.max_select ?? 0)
          const type: 'single' | 'multi' = maxSelect === 1 ? 'single' : 'multi'
          return { id: g.id as string, name: g.name as string, type, options: opts, min: Number(g?.min_select ?? 0) || undefined, max: Number(g?.max_select ?? 0) || undefined }
        })
        setGroups(mapped)
        const { data: prodRow } = await supabase.from('products').select('description').eq('id', product.id).maybeSingle()
        setDescription((prodRow as any)?.description ?? null)
      } catch (e) {
        setGroups([])
      } finally {
        setLoadingGroups(false)
      }
    }
    if (visible) load()
  }, [visible, product?.id])

  useEffect(() => {
    // Reset fields when product changes or modal reopened
    if (visible) {
      setQty(initialQty ?? 1)
      setNote(initialNote ?? '')
      setModifiers(initialModifiers ?? [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, product?.id])

  const countsByGroup = (sel: string[]) => {
    const map = new Map<string, number>()
    sel.forEach((t) => { const gid = t.split(':')[0]; map.set(gid, (map.get(gid) ?? 0) + 1) })
    return map
  }
  const validity = useMemo(() => {
    const counts = countsByGroup(modifiers)
    return groups.map((g) => {
      const c = counts.get(g.id) ?? 0
      const min = g.min ?? 0
      const max = g.max ?? 0
      const withinMax = max === 0 ? true : c <= max
      const meetsMin = c >= min
      return { id: g.id, ok: withinMax && meetsMin }
    })
  }, [groups, modifiers])
  const canCommit = useMemo(() => validity.every((v) => v.ok), [validity])

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableWithoutFeedback onPress={() => { onClose(); reset() }}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>
        <View style={styles.card}>
              <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                <View style={styles.heroWrap}>
                  {product?.image_url ? (
                    <Image source={{ uri: product.image_url }} style={styles.hero} />)
                    : (<View style={[styles.hero, { backgroundColor: AdminColors.surface }]} />)}
                  <TouchableOpacity style={styles.closeBtn} onPress={() => { onClose(); reset() }}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                  <Text style={styles.title}>{product?.name}</Text>
                  <Text style={styles.price}>{price.toFixed(2)} ETB</Text>
                  {!!description && <Text style={styles.desc}>{description}</Text>}

                  <TouchableOpacity style={styles.modifiersBtn} onPress={() => setSheetOpen(true)} disabled={loadingGroups || (groups.length === 0)}>
                    <Text style={styles.modifiersBtnText}>
                      {groups.length === 0 ? 'No modifiers available' : (modifiers.length > 0 ? `${modifiers.length} modifier(s) selected` : 'Choose modifiers')}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.label}>Note</Text>
                  <TextInput
                    placeholder="Add a note (no sugar, less ice, ... )"
                    value={note}
                    onChangeText={setNote}
                    style={styles.note}
                    placeholderTextColor={AdminColors.subtext}
                    multiline
                  />

                  <View style={styles.qtyRow}>
                    <TouchableOpacity style={[styles.qtyPill, qty <= 1 && styles.qtyDisabled]} disabled={qty <= 1} onPress={() => setQty((q) => Math.max(1, q - 1))}>
                      <Text style={styles.qtyText}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyNumber}>{qty}</Text>
                    <TouchableOpacity style={styles.qtyPill} onPress={() => setQty((q) => q + 1)}>
                      <Text style={styles.qtyText}>+</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity
                      style={[styles.addBtn, !canCommit && styles.addBtnDisabled]}
                      onPress={async () => {
                        if (!product || !canCommit) return
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                        onAdd({ productId: product.id, name: product.name, price, quantity: qty, modifiers, note })
                        reset()
                      }}
                      disabled={!canCommit}
                    >
                      <Text style={styles.addBtnText}>{editingItemId ? 'Save' : 'Add'} • {total.toFixed(2)} ETB</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>
        </View>
        <ModifiersSheet
          visible={sheetOpen}
          groups={groups}
          initialSelected={modifiers}
          onClose={() => setSheetOpen(false)}
          onConfirm={(mods: string[]) => { setModifiers(mods); setSheetOpen(false) }}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  card: { backgroundColor: AdminColors.card, maxHeight: '92%', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  heroWrap: { width: '100%', height: 220, backgroundColor: AdminColors.surface },
  hero: { width: '100%', height: '100%' },
  closeBtn: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.45)', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: AdminColors.text },
  price: { marginTop: 4, fontSize: 14, fontWeight: '700', color: AdminColors.text },
  desc: { marginTop: 6, color: AdminColors.subtext },
  label: { marginTop: 12, marginBottom: 6, color: AdminColors.subtext, fontSize: 12 },
  note: { minHeight: 48, borderWidth: 1, borderColor: AdminColors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: AdminColors.card, color: AdminColors.text },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 12 },
  qtyPill: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: AdminColors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: AdminColors.card },
  qtyDisabled: { opacity: 0.4 },
  qtyText: { fontSize: 16, fontWeight: '700', color: AdminColors.text },
  qtyNumber: { width: 32, textAlign: 'center', fontSize: 16, color: AdminColors.text },
  modifiersBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: AdminColors.border, backgroundColor: AdminColors.card },
  modifiersBtnText: { fontSize: 13, fontWeight: '600', color: AdminColors.text },
  addBtn: { backgroundColor: AdminColors.accent, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  addBtnDisabled: { backgroundColor: AdminColors.accentMuted },
  addBtnText: { color: '#fff', fontWeight: '700' },
})
