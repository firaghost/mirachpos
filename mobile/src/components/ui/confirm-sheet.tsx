import React from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native'

export interface ConfirmSheetProps {
  open: boolean
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void | Promise<void>
  onOpenChange?: (open: boolean) => void
}

export function ConfirmSheet({
  open,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  loading = false,
  onConfirm,
  onOpenChange,
}: ConfirmSheetProps) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange?.(false)}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => onOpenChange?.(false)} />
        <View style={styles.sheet}>
          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!description && <Text style={styles.desc}>{description}</Text>}
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => onOpenChange?.(false)} disabled={loading}>
              <Text style={[styles.btnOutlineText]}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]} onPress={() => onConfirm()} disabled={loading}>
              <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#eee' },
  title: { fontSize: 14, fontWeight: '700', color: '#2C1810', marginBottom: 4 },
  desc: { fontSize: 12, color: '#666', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, minWidth: 92, alignItems: 'center' },
  btnOutline: { backgroundColor: '#f5f5f5' },
  btnOutlineText: { color: '#444', fontWeight: '600' },
  btnPrimary: { backgroundColor: '#2C1810' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  btnDisabled: { opacity: 0.7 },
})
