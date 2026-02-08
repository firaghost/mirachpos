import React, { useEffect, useMemo, useState } from 'react'
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import * as Haptics from 'expo-haptics'
import { AdminColors } from '../../admin/theme/colors'

export type ModifierGroup = {
  id: string
  name: string
  type: 'single' | 'multi'
  options: string[]
  min?: number
  max?: number
}

interface Props {
  visible: boolean
  groups: ModifierGroup[]
  initialSelected?: string[]
  onClose: () => void
  onConfirm: (mods: string[]) => void
}

export function ModifiersSheet({ visible, groups, initialSelected = [], onClose, onConfirm }: Props) {
  const [selected, setSelected] = useState<string[]>(initialSelected)

  useEffect(() => {
    setSelected(initialSelected)
  }, [initialSelected, visible])

  const toggle = (group: ModifierGroup, value: string) => {
    const token = `${group.id}:${value}`
    if (group.type === 'single') {
      const othersRemoved = selected.filter((s) => !s.startsWith(`${group.id}:`))
      setSelected(othersRemoved.includes(token) ? othersRemoved : [...othersRemoved, token])
      return
    }
    setSelected((prev) => (prev.includes(token) ? prev.filter((s) => s !== token) : [...prev, token]))
  }

  const countsByGroup = (sel: string[]) => {
    const map = new Map<string, number>()
    sel.forEach((t) => {
      const gid = t.split(':')[0]
      map.set(gid, (map.get(gid) ?? 0) + 1)
    })
    return map
  }

  const validity = (() => {
    const counts = countsByGroup(selected)
    return groups.map((g) => {
      const c = counts.get(g.id) ?? 0
      const min = g.min ?? 0
      const max = g.max ?? 0
      const withinMax = max === 0 ? true : c <= max
      const meetsMin = c >= min
      return { id: g.id, ok: withinMax && meetsMin, count: c, min, max }
    })
  })()

  const allValid = validity.every((v) => v.ok)

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Customize</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {groups.map((g) => (
              <View key={g.id} style={{ marginBottom: 12 }}>
                <Text style={styles.groupTitle}>
                  {g.name} {g.type === 'single' ? '(choose one)' : '(multi select)'}
                </Text>
                {(() => {
                  const v = validity.find((x) => x.id === g.id)
                  if (!v) return null
                  const rangeLabel = g.min || g.max ? `Required: ${g.min ?? 0}${g.max ? `–${g.max}` : '+'}` : ''
                  const bad = !v.ok
                  return (
                    <Text style={[styles.ruleText, bad && styles.ruleTextError]}>
                      {rangeLabel} {bad ? `(selected ${v.count})` : ''}
                    </Text>
                  )
                })()}
                <View style={styles.optionsRow}>
                  {g.options.map((opt) => {
                    const token = `${g.id}:${opt}`
                    const active = selected.includes(token)
                    return (
                      <TouchableOpacity key={opt} style={[styles.option, active && styles.optionActive]} onPress={() => toggle(g, opt)}>
                        <Text style={[styles.optionText, active && styles.optionTextActive]}>{opt}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancel} onPress={onClose}><Text>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.apply, !allValid && styles.applyDisabled]} onPress={async () => { if (!allValid) return; await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onConfirm(selected) }} disabled={!allValid}>
              <Text style={{ color: '#fff', fontWeight: '700', opacity: allValid ? 1 : 0.6 }}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: AdminColors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 48, height: 4, borderRadius: 2, backgroundColor: AdminColors.border, marginBottom: 8 },
  title: { textAlign: 'center', fontWeight: '700', marginBottom: 8, color: AdminColors.text },
  groupTitle: { fontWeight: '600', marginBottom: 8, color: AdminColors.text },
  ruleText: { fontSize: 12, color: AdminColors.subtext, marginBottom: 6 },
  ruleTextError: { color: '#b91c1c' },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap' },
  option: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: AdminColors.border, marginRight: 8, marginBottom: 8, backgroundColor: AdminColors.card },
  optionActive: { backgroundColor: AdminColors.accent, borderColor: AdminColors.accent },
  optionText: { fontSize: 12, color: AdminColors.text },
  optionTextActive: { color: '#fff', fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 },
  cancel: { paddingHorizontal: 10, paddingVertical: 8 },
  apply: { backgroundColor: AdminColors.accent, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  applyDisabled: { backgroundColor: AdminColors.accentMuted },
})

export default ModifiersSheet
