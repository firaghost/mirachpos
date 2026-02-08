import React, { useMemo, useState } from 'react'
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, TextInput, Platform, ToastAndroid, KeyboardAvoidingView } from 'react-native'
import { useMobileOrderStore, type MobileOrderItem } from '@/state/orderStore'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialIcons, Ionicons } from '@expo/vector-icons'
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'

interface Props {
  visible: boolean
  onClose: () => void
  items: MobileOrderItem[]
  subtotal: number
  tax: number
  total: number
  placing: boolean
  error: string | null
  onSend: () => Promise<void> | void
  onEditItem?: (item: MobileOrderItem) => void
  vatRatePct?: number
  guestEnabled?: boolean
  guestLabel?: string
  onToggleGuest?: (enabled: boolean) => void
  onPickGuest?: () => void
  multiCount?: number
  onSendAll?: () => Promise<void> | void
  otherDrafts?: Array<{ tableId: string; tableName: string | null; items: MobileOrderItem[]; isGuest: boolean; guestName: string }>
  onProceedToCheckout?: () => void
  proceedLabel?: string
  cartNote?: string
  couponCode?: string
  onChangeCartNote?: (v: string) => void
  onChangeCouponCode?: (v: string) => void
  discount?: number
  couponError?: string | null
  onCouponBlur?: () => void
  onValidateCoupon?: () => void
}

export function FinalizeOrderModal({ visible, onClose, items, subtotal, tax, total, placing, error, onSend, onEditItem, vatRatePct = 0, guestEnabled = false, guestLabel, onToggleGuest, onPickGuest, multiCount, onSendAll, otherDrafts = [], onProceedToCheckout, proceedLabel, cartNote = '', couponCode = '', onChangeCartNote, onChangeCouponCode, discount = 0, couponError = null, onCouponBlur, onValidateCoupon }: Props) {
  const insets = useSafeAreaInsets()
  const removeItem = useMobileOrderStore((s) => s.removeItem)
  const updateQty = useMobileOrderStore((s) => s.updateQty)
  useAppTheme()
  const [showDetails, setShowDetails] = useState(false)

  const styles = useMemo(() => StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
    card: { backgroundColor: AdminColors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 14, paddingTop: 8 },
    handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: AdminColors.border, marginBottom: 10 },
    titleBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
    backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 18, fontWeight: '700', color: AdminColors.text, flex: 1, textAlign: 'center' },
    content: { maxHeight: '58%', paddingTop: 6 },
    row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
    rowQty: { fontSize: 15, fontWeight: '600', color: AdminColors.text },
    rowTitle: { fontSize: 15, fontWeight: '600', color: AdminColors.text },
    rowSub: { color: AdminColors.subtext, fontSize: 13, marginTop: 2, marginLeft: 20 },
    rowNote: { color: AdminColors.subtext, fontSize: 13, fontStyle: 'italic', marginTop: 2, marginLeft: 20 },
    rowRight: { alignItems: 'flex-end' },
    rowAmount: { fontSize: 15, fontWeight: '700', color: AdminColors.text, marginBottom: 8 },
    actionButtons: { flexDirection: 'row', gap: 6 },
    iconButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: AdminColors.surface, alignItems: 'center', justifyContent: 'center' },
    footer: { paddingTop: 10, borderTopWidth: 1, borderTopColor: AdminColors.border },
    guestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    guestLabel: { fontSize: 13, color: AdminColors.subtext },
    guestPickBtn: { backgroundColor: AdminColors.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
    guestPickText: { color: '#1a1a1a', fontWeight: '700', fontSize: 12 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    totalLabel: { fontSize: 18, fontWeight: '700', color: AdminColors.text },
    totalValue: { fontSize: 18, fontWeight: '700', color: AdminColors.text },
    sendBtn: { backgroundColor: AdminColors.accent, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
    sendBtnDisabled: { opacity: 0.7 },
    sendBtnText: { color: '#1a1a1a', fontSize: 16, fontWeight: '700' },
    input: { borderWidth: 1, borderColor: AdminColors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: AdminColors.card, marginTop: 6, color: AdminColors.text },
  }), [])

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: undefined })}>
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={styles.handle} />
          <View style={styles.titleBar}>
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={AdminColors.accent} />
            </TouchableOpacity>
            <Text style={styles.title}>Finalize order ({items.reduce((sum, i) => sum + i.quantity, 0)})</Text>
            <TouchableOpacity>
              <MaterialIcons name="content-copy" size={24} color={AdminColors.accent} />
            </TouchableOpacity>
          </View>

        <ScrollView style={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          {items.length === 0 && (
            <Text style={{ textAlign: 'center', color: AdminColors.subtext, paddingVertical: 24 }}>No items yet</Text>
          )}
          {items.map((i) => (
            <View key={i.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={styles.rowQty}>{i.quantity}  </Text>
                  <Text style={styles.rowTitle}>{i.name}</Text>
                </View>
                {!!(i.modifiers && i.modifiers.length) && (
                  <Text style={styles.rowSub}>{i.modifiers.map((m) => m.split(':')[1] ?? m).join(', ')}</Text>
                )}
                {!!i.note && <Text style={styles.rowNote}>"{i.note}"</Text>}
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmount}>{(i.price * i.quantity).toFixed(2)} ETB</Text>
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => onEditItem && onEditItem(i)}
                  >
                    <MaterialIcons name="edit" size={18} color={AdminColors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => updateQty(i.id, 1)}
                  >
                    <MaterialIcons name="content-copy" size={18} color={AdminColors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => removeItem(i.id)}
                  >
                    <MaterialIcons name="delete-outline" size={18} color={AdminColors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
          {/* Other table drafts */}
          {!!otherDrafts.length && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: '700', marginBottom: 6 }}>Other tables</Text>
              {otherDrafts.map((d, idx) => {
                const sub = d.items.reduce((s, it) => s + it.price * it.quantity, 0)
                const tx = sub * (Math.max(0, vatRatePct) / 100)
                const tot = sub + tx
                return (
                  <View key={`${d.tableId}-${idx}`} style={[styles.row, { paddingVertical: 10 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{d.tableName ?? `Table ${d.tableId.slice(0, 4)}`}</Text>
                      <Text style={styles.rowSub}>{d.items.reduce((n, it) => n + it.quantity, 0)} items</Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={styles.rowAmount}>{tot.toFixed(2)} ETB</Text>
                    </View>
                  </View>
                )
              })}
            </View>
          )}
        </ScrollView>

        <View style={[styles.footer] }>
          <TouchableOpacity onPress={() => setShowDetails((v) => !v)} style={{ alignSelf: 'flex-end', marginBottom: 8 }}>
            <Text style={{ color: AdminColors.subtext, fontWeight: '700' }}>{showDetails ? 'Hide details' : 'Show details'}</Text>
          </TouchableOpacity>
          {showDetails && (
            <>
              <View style={styles.guestRow}>
                <Text style={styles.guestLabel}>Paid by guest</Text>
                <Switch value={guestEnabled} onValueChange={(v) => onToggleGuest && onToggleGuest(v)} />
              </View>
              {guestEnabled && (
                <View style={[styles.guestRow, { marginTop: 6 }]}> 
                  <Text style={styles.guestLabel}>Guest</Text>
                  <TouchableOpacity onPress={onPickGuest} style={styles.guestPickBtn}>
                    <Text style={styles.guestPickText}>{guestLabel || 'Select guest'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Order instructions */}
              <View style={{ marginBottom: 10 }}>
                <Text style={styles.totalLabel}>Add instructions</Text>
                <TextInput
                  value={cartNote}
                  onChangeText={(v) => onChangeCartNote && onChangeCartNote(v)}
                  placeholder="e.g. No onions, extra spicy"
                  style={styles.input}
                  multiline
                  placeholderTextColor={AdminColors.subtext}
                  onBlur={() => { if (Platform.OS === 'android') { try { ToastAndroid.show('Instructions saved', ToastAndroid.SHORT) } catch {} } }}
                />
              </View>

              {/* Coupon */}
              <View style={{ marginBottom: 10 }}>
                <Text style={styles.totalLabel}>Apply coupon</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={couponCode}
                      onChangeText={(v) => onChangeCouponCode && onChangeCouponCode(v)}
                      placeholder="Enter coupon code"
                      style={styles.input}
                      autoCapitalize="characters"
                      onBlur={() => { onCouponBlur && onCouponBlur(); if (Platform.OS === 'android') { try { ToastAndroid.show((couponCode || '').trim() ? 'Coupon applied' : 'Coupon cleared', ToastAndroid.SHORT) } catch {} } }}
                    />
                  </View>
                  <TouchableOpacity onPress={onValidateCoupon} style={[styles.iconButton, { width: 80 }]}>
                    <Text style={{ fontWeight: '700', color: AdminColors.accent }}>Validate</Text>
                  </TouchableOpacity>
                </View>
                {!!couponError && (
                  <Text style={{ color: AdminColors.danger, marginTop: 4 }}>{couponError}</Text>
                )}
              </View>
            </>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{subtotal.toFixed(2)} ETB</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>VAT{vatRatePct ? ` (${Math.max(0, vatRatePct)}%)` : ''}</Text>
            <Text style={styles.totalValue}>{tax.toFixed(2)} ETB</Text>
          </View>
          {!!discount && discount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>- {discount.toFixed(2)} ETB</Text>
            </View>
          )}
          <View style={[styles.totalRow, { marginTop: 4 }]} >
            <Text style={[styles.totalLabel, { fontWeight: '800' }]}>{discount > 0 ? 'Net due' : 'Total'}</Text>
            <Text style={[styles.totalValue, { fontWeight: '900' }]}>{Math.max(0, total - (discount || 0)).toFixed(2)} ETB</Text>
          </View>
          {error ? <Text style={{ color: AdminColors.danger, textAlign: 'center', marginTop: 6, marginBottom: 8 }}>{error}</Text> : null}

          {!!multiCount && multiCount > 1 && (
            <TouchableOpacity
              style={[styles.sendBtn, (items.length === 0 || placing) && styles.sendBtnDisabled, { marginBottom: 8 }]}
              onPress={onSendAll}
              disabled={placing}
            >
              <Text style={styles.sendBtnText}>{placing ? 'Sending…' : `Send all drafts (${multiCount})`}</Text>
            </TouchableOpacity>
          )}

          {onProceedToCheckout && (
            <TouchableOpacity
              style={[styles.sendBtn, (items.length === 0 || placing) && styles.sendBtnDisabled, { marginBottom: 8 }]}
              onPress={onProceedToCheckout}
              disabled={items.length === 0 || placing}
            >
              <Text style={styles.sendBtnText}>{proceedLabel || 'Proceed to Checkout'}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.sendBtn, (items.length === 0 || placing) && styles.sendBtnDisabled]}
            onPress={onSend}
            disabled={items.length === 0 || placing}
          >
            <Text style={styles.sendBtnText}>{placing ? 'Sending…' : 'Send order'}</Text>
          </TouchableOpacity>
        </View>
        </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

