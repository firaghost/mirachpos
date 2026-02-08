import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Switch, ActivityIndicator, Alert, Image, Modal, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, useWindowDimensions, ToastAndroid, BackHandler } from 'react-native'
import { supabase } from '@/lib/supabase'
import { getOrderLocal, getOrderItemsLocal, upsertOrderItems } from '@/lib/db'
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'
import { captureRef } from 'react-native-view-shot'
 
import * as MediaLibrary from 'expo-media-library'
import { GuestPicker, GuestRow } from '@/components/ui/guest-picker'
import { enqueue, newId } from '@/lib/offlineQueue'
import LottieView from 'lottie-react-native'
import { useQueryClient } from '@tanstack/react-query'

export type PaymentDetailProps = {
  orderId: string
  tableLabel: string
  totalAmount: number
  onBack: () => void
}

type OrderRow = {
  id: string
  status: string | null
  total_amount: number
  tax_amount?: number | null
  discount_amount?: number | null
  payment_status?: string | null
}

type ItemRow = { name: string; quantity: number; total: number }

export function PaymentDetailScreen({ orderId, tableLabel, totalAmount, onBack }: PaymentDetailProps) {
  useAppTheme()
  const { width, height } = useWindowDimensions()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<OrderRow | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const receiptRef = useRef<View>(null)

  const [method, setMethod] = useState<'cash' | 'telebirr' | 'bank'>('cash')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [split, setSplit] = useState(false)
  const [tip, setTip] = useState('')
  const [discount, setDiscount] = useState('')
  const [qrUrl, setQrUrl] = useState<string>('')
  const [qrOpen, setQrOpen] = useState(false)
  const [vatRatePct, setVatRatePct] = useState<number | null>(null)
  const [guest, setGuest] = useState(false)
  const [guestPickerOpen, setGuestPickerOpen] = useState(false)
  const [selectedGuest, setSelectedGuest] = useState<GuestRow | null>(null)
  const [branchName, setBranchName] = useState<string>('')
  const allowQr = useMemo(() => (method === 'telebirr') && !!qrUrl, [method, qrUrl])
  const [successOpen, setSuccessOpen] = useState(false)
  const [successLabel, setSuccessLabel] = useState('Payment successful')

  // Split payments ledger
  type PartialPay = { method: 'cash' | 'telebirr' | 'bank'; amount: number; reference?: string }
  const [partials, setPartials] = useState<PartialPay[]>([])
  const [pMethod, setPMethod] = useState<PartialPay['method']>('cash')
  const [pAmount, setPAmount] = useState('')
  const [pRef, setPRef] = useState('')

  // Android hardware back: close modals first, otherwise go back via onBack
  useEffect(() => {
    const handler = () => {
      if (qrOpen) { setQrOpen(false); return true }
      if (guestPickerOpen) { setGuestPickerOpen(false); return true }
      if (saving) return true
      if (onBack) onBack()
      return true
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', handler)
    return () => sub.remove()
  }, [qrOpen, guestPickerOpen, onBack, saving])

  useEffect(() => {
    (async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: ord } = await supabase
          .from('orders')
          .select('id, status, total_amount, tax_amount, discount_amount, payment_status')
          .eq('id', orderId)
          .maybeSingle()
        setOrder((ord as any) ?? null)
        const { data: rows } = await supabase
          .from('order_items')
          .select('id, product_id, quantity, unit_price, total_price, products(name)')
          .eq('order_id', orderId)
        setItems((rows ?? []).map((r: any) => ({ name: r.products?.name ?? 'Item', quantity: Number(r.quantity ?? 0), total: Number(r.total_price ?? 0) })))
        try {
          await upsertOrderItems((rows ?? []).map((r: any) => ({ id: String(r.id), order_id: orderId, product_id: String(r.product_id), qty: Number(r.quantity ?? 0), price: Number(r.unit_price ?? 0), total: Number(r.total_price ?? 0), note: null })))
        } catch {}
      } catch (e: any) {
        // Offline fallback: read local header and items
        try {
          const hdr = await getOrderLocal(orderId)
          if (hdr) {
            setOrder({ id: hdr.id, status: hdr.status ?? null, total_amount: Number(hdr.total ?? 0), tax_amount: null, discount_amount: null, payment_status: hdr.payment_status ?? null })
          }
          const rows = await getOrderItemsLocal(orderId)
          setItems(rows.map((r) => ({ name: r.product_id, quantity: Number(r.qty ?? 0), total: Number(r.total ?? 0) })))
          setError(null)
        } catch (e2: any) {
          setError(e?.message ?? 'Failed to load order')
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [orderId])

  // Fetch branch settings for QR and VAT/tax percent
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('branch_id')
          .eq('id', user.id)
          .maybeSingle()
        const bid = (profile as any)?.branch_id
        if (!bid) return
        const { data: branch } = await supabase
          .from('branches')
          .select('settings, name')
          .eq('id', bid)
          .maybeSingle()
        const settings = (branch as any)?.settings || {}
        const url = settings.mobile_qr_url || settings.qr_url || ''
        if (typeof url === 'string') setQrUrl(url)
        const vat = settings.vat_rate ?? settings.vat ?? settings.tax_percent ?? settings.tax_rate ?? null
        const v = Number(vat)
        setVatRatePct(Number.isFinite(v) ? v : null)
        setBranchName(((branch as any)?.name as string) || '')
      } catch {}
    })()
  }, [])

  const totals = useMemo(() => {
    const total = Number(order?.total_amount ?? totalAmount ?? 0)
    const disc = Number(order?.discount_amount ?? 0)
    let taxKnown = Number(order?.tax_amount ?? 0)
    let subtotal: number
    let tax: number
    if (taxKnown > 0 && taxKnown < total) {
      tax = taxKnown
      subtotal = total - taxKnown
    } else if (vatRatePct != null && vatRatePct > 0) {
      const r = Math.max(0, vatRatePct) / 100
      subtotal = total / (1 + r)
      tax = total - subtotal
    } else {
      subtotal = total
      tax = 0
    }
    return { subtotal, tax, discount: disc, total }
  }, [order?.total_amount, order?.tax_amount, order?.discount_amount, totalAmount, vatRatePct])

  // Prefill amount for manual methods
  useEffect(() => {
    const net = Math.max(0, totals.total - totals.discount)
    if (method === 'cash') setAmount(net.toFixed(2))
  }, [method, totals.total, totals.discount])

  const splitRemaining = useMemo(() => {
    const net = Math.max(0, totals.total - totals.discount)
    const paid = partials.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0)
    return Math.max(0, net - paid)
  }, [partials, totals.total, totals.discount])

  const onConfirm = async () => {
    try {
      setError(null)
      setSaving(true)
      // Validate cash amount if cash
      if (method === 'cash') {
        const got = parseFloat((amount || '').replace(',', '.'))
        if (!Number.isFinite(got) || got < Number(totals.total - totals.discount)) {
          Alert.alert('Amount', 'Enter received amount equal or above total')
          setSaving(false)
          return
        }
      }
      // Update order paid + method + collected_by
      let upErr: any = null
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id ?? null
        const payload: any = { payment_status: 'paid', payment_method: method }
        if (uid) payload.collected_by = uid
        if (guest) {
          payload.is_guest = true
          payload.customer_name = (selectedGuest?.full_name || '').trim() || null
        }
        const { error } = await supabase.from('orders').update(payload).eq('id', orderId)
        upErr = error
      } catch (e: any) {
        upErr = e
      }
      if (upErr) {
        // if column missing or enum mismatch, just set status paid
        const msg = String(upErr?.message ?? '')
        if (/(payment_method|collected_by|42703|enum)/i.test(msg)) {
          const { error } = await supabase.from('orders').update({ payment_status: 'paid' }).eq('id', orderId)
          if (error) throw error
        } else {
          throw upErr
        }
      }
      // Audit log
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id ?? null
        if (split) {
          // Log each partial
          for (const p of partials) {
            await supabase.from('order_change_logs').insert({
              order_id: orderId,
              staff_id: uid,
              previous_items: [],
              new_items: [],
              reason: `payment-partial:${p.method}:${p.amount.toFixed(2)}${p.reference ? ':' + p.reference : ''}`,
            })
          }
          await supabase.from('order_change_logs').insert({ order_id: orderId, staff_id: uid, previous_items: [], new_items: [], reason: 'payment:split:close' })
        } else {
          await supabase.from('order_change_logs').insert({
            order_id: orderId,
            staff_id: uid,
            previous_items: [],
            new_items: [],
            reason: guest ? 'payment:guest' : `payment:${method}${reference ? ':' + reference : ''}`,
          })
        }
      } catch {}
      // Free tables
      try {
        const { data: ord } = await supabase.from('orders').select('table_id').eq('id', orderId).maybeSingle()
        const baseId = (ord as any)?.table_id as string | null
        const { data: extras } = await supabase.from('order_tables').select('table_id').eq('order_id', orderId)
        const ids = Array.from(new Set([baseId, ...((extras ?? []).map((r: any) => r.table_id as string))].filter(Boolean))) as string[]
        if (ids.length > 0) await supabase.from('tables').update({ status: 'available' }).in('id', ids)
      } catch {}

      // Show success animation, then go back
      setSuccessLabel('Payment successful')
      // Optimistically remove this order from unpaid cache so list updates instantly
      try {
        queryClient.setQueryData<any[]>(['payments_unpaid_orders'], (old) => Array.isArray(old) ? old.filter((o) => String(o.id) !== String(orderId)) : old)
      } catch {}
      setSuccessOpen(true)
      setTimeout(() => { setSuccessOpen(false); onBack() }, 2000)
    } catch (e: any) {
      const msg = String(e?.message ?? '')
      const maybeOffline = /network|fetch|timeout|offline/i.test(msg)
      if (maybeOffline) {
        try {
          await enqueue({
            id: newId(),
            type: 'pay',
            createdAt: Date.now(),
            payload: {
              orderId,
              method,
              guest: { isGuest: guest, name: selectedGuest?.full_name ?? null },
            },
          })
          setSuccessLabel('Payment queued')
          setSuccessOpen(true)
          setTimeout(() => { setSuccessOpen(false); onBack() }, 1600)
          return
        } catch {}
      }
      setError(e?.message ?? 'Payment failed')
    } finally {
      setSaving(false)
    }
  }
  
  const saveReceipt = async () => {
    try {
      const target = receiptRef.current
      if (!target) throw new Error('Nothing to save')
      // Capture to temp file
      const tmpUri = await captureRef(target, { format: 'png', quality: 1, result: 'tmpfile' })
      // Request media library permission (use stable API)
      let granted = false
      const cur = await MediaLibrary.getPermissionsAsync()
      if (cur.status === 'granted') granted = true
      else {
        const req = await MediaLibrary.requestPermissionsAsync()
        granted = req.status === 'granted'
      }
      if (!granted) {
        Alert.alert('Permission required', 'Please allow Photos access to save receipts to your gallery.')
        return
      }
      // Create asset (fallback to saveToLibrary if createAsset fails on some devices)
      let asset: MediaLibrary.Asset | null = null
      try {
        asset = await MediaLibrary.createAssetAsync(tmpUri)
      } catch {
        try { await MediaLibrary.saveToLibraryAsync(tmpUri) } catch {}
      }
      // Best-effort album organization; if anything fails, we still consider save successful
      const date = new Date()
      const y = date.getFullYear()
      const m = String(date.getMonth()+1).padStart(2,'0')
      const d = String(date.getDate()).padStart(2,'0')
      const dateAlbumName = `Receipt-${y}-${m}-${d}`
      try {
        if (asset) {
          const base = await MediaLibrary.getAlbumAsync('Receipt')
          if (!base) {
            await MediaLibrary.createAlbumAsync('Receipt', asset, false)
          } else {
            await MediaLibrary.addAssetsToAlbumAsync([asset], base, false)
          }
          let dated = await MediaLibrary.getAlbumAsync(dateAlbumName)
          if (!dated) {
            dated = await MediaLibrary.createAlbumAsync(dateAlbumName, asset, false)
          } else {
            await MediaLibrary.addAssetsToAlbumAsync([asset], dated, false)
          }
        }
      } catch {}
      if (Platform.OS === 'android') {
        ToastAndroid.show('Receipt saved to Photos (Receipt, dated)', ToastAndroid.SHORT)
      } else {
        Alert.alert('Saved', 'Receipt saved to Photos (Receipt, dated)')
      }
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Could not save receipt')
    }
  }

  return (
    <KeyboardAvoidingView style={styles().container} behavior={Platform.select({ ios: 'padding', android: undefined })}>
    <View style={{ flex: 1 }}>
      <View style={styles().header}>
        <TouchableOpacity onPress={onBack}><Text style={styles().back}>Order #{orderId.slice(0,6)}</Text></TouchableOpacity>
        <Text style={styles().headerMid}>{tableLabel}</Text>
        <Text style={styles().headerRight}>TOTAL: <Text style={styles().total}>ETB {totals.total.toFixed(2)}</Text></Text>
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={AdminColors.accent} />
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingBottom: Math.max(12, 24) }}>
          {error ? <Text style={[styles().subtle, { color: AdminColors.danger }]}>{error}</Text> : null}

          {/* Receipt capture area */}
          <View ref={receiptRef} collapsable={false}>
            {/* Header snapshot for receipt */}
            <View style={[styles().card, { marginBottom: 8, alignItems: 'center', paddingVertical: 10 }]}>
              <Text style={[styles().bold, { fontSize: 14 }]}>{branchName || 'Receipt'}</Text>
              <Text style={[styles().subtle, { marginTop: 2 }]}>
                {tableLabel} 
                • #{orderId.slice(0,6)} 
                • {new Date().toLocaleString()}
              </Text>
            </View>
            <Text style={styles().sectionTitle}>ORDER SUMMARY</Text>
            <View style={styles().card}>
            {items.map((it, idx) => (
              <View key={idx} style={styles().row}>
                <Text style={styles().cellLeft}>{it.quantity}x {it.name}</Text>
                <Text style={styles().cellRight}>ETB {it.total.toFixed(2)}</Text>
              </View>
            ))}
            <View style={styles().divider} />
            <View style={styles().row}><Text style={styles().subtle}>Subtotal</Text><Text style={styles().cellRight}>ETB {totals.subtotal.toFixed(2)}</Text></View>
            <View style={styles().row}><Text style={styles().subtle}>Tax</Text><Text style={styles().cellRight}>ETB {totals.tax.toFixed(2)}</Text></View>
            <View style={[styles().row, { marginTop: 6 }]}>
              <Text style={[styles().bold]}>TOTAL</Text>
              <Text style={[styles().bold]}>ETB {totals.total.toFixed(2)}</Text>
            </View>
            </View>
            {/* Method snapshot */}
            <View style={[styles().card, { marginTop: 8, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between' }]}>
              <Text style={styles().subtle}>Method</Text>
              <Text style={styles().bold}>{method === 'telebirr' ? 'Telebirr' : method.charAt(0).toUpperCase()+method.slice(1)}{reference?` · ${reference}`:''}</Text>
            </View>
          </View>

          {!guest && (
            <>
              <Text style={[styles().sectionTitle, { marginTop: 12 }]}>PAYMENT OPTIONS</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['cash','telebirr','bank'] as const).map((m) => (
                  <TouchableOpacity key={m} onPress={() => setMethod(m)} style={[styles().pill, method===m && styles().pillActive]}>
                    <Text style={method===m ? styles().pillTextActive : styles().pillText}>{(m==='telebirr')?'Telebirr': m.charAt(0).toUpperCase()+m.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles().subtle}>AMOUNT RECEIVED</Text>
                  <TextInput style={styles().input} placeholder="ETB 0.00" keyboardType="decimal-pad" editable={method==='cash'} value={amount} onChangeText={setAmount} />
                </View>
                <View style={{ width: 160 }}>
                  <Text style={styles().subtle}>REF. NUMBER</Text>
                  <TextInput style={styles().input} placeholder="Optional" value={reference} onChangeText={setReference} />
                </View>
              </View>
            </>
          )}

          {/* QR code / Guest */}
          <View style={{ flexDirection: width < 380 ? 'column' : 'row', gap: 12, marginTop: 12 }}>
            {!guest && (allowQr ? (
              <TouchableOpacity style={[styles().card, { flex: 1, height: 96, alignItems: 'center', justifyContent: 'center' }]} onPress={() => setQrOpen(true)} activeOpacity={0.85}>
                <Image source={{ uri: qrUrl }} style={{ width: '90%', height: '90%', borderRadius: 8 }} resizeMode="contain" />
              </TouchableOpacity>
            ) : (
              <View style={[styles().card, { flex: 1, height: 96, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={styles().subtle}>QR available for Telebirr</Text>
              </View>
            ))}
            {/* Guest section */}
            <View style={[styles().card, { flex: 1, minHeight: 96, padding: 12, marginTop: width < 380 ? 12 : 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles().subtle}>Paid by guest</Text>
                <Switch
                  value={guest}
                  onValueChange={(v)=>{ setGuest(v); if (v) setGuestPickerOpen(true) }}
                  trackColor={{ false: AdminColors.border, true: AdminColors.accent }}
                  thumbColor={guest ? '#fff' : '#fff'}
                  ios_backgroundColor={AdminColors.border}
                />
              </View>
              
              <TouchableOpacity
                disabled={!guest}
                onPress={() => setGuestPickerOpen(true)}
                style={[styles().input, { justifyContent: 'center', height: 40 }]}
              >
                <Text style={{ color: guest ? (selectedGuest ? AdminColors.text : AdminColors.subtext) : AdminColors.subtext }}>
                  {selectedGuest ? selectedGuest.full_name : 'Select or create guest'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {!guest && (
            <>
              <Text style={[styles().sectionTitle, { marginTop: 12 }]}>OPTIONAL INPUTS</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles().subtle}>TIP AMOUNT</Text>
                  <TextInput style={styles().input} placeholder="0.00" keyboardType="decimal-pad" value={tip} onChangeText={setTip} />
                </View>
                <View style={styles().switchRow}>
                  <Text style={styles().subtle}>SPLIT PAYMENT</Text>
                  <Switch
                    value={split}
                    onValueChange={setSplit}
                    trackColor={{ false: AdminColors.border, true: AdminColors.accent }}
                    thumbColor={split ? '#fff' : '#fff'}
                    ios_backgroundColor={AdminColors.border}
                  />
                </View>
              </View>
            </>
          )}

          {/* Split payments UI */}
          {!guest && split && (
            <View style={[styles().card, { marginTop: 12, paddingVertical: 8 }]}>
              <Text style={styles().sectionTitle}>Split payments</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
                {(['cash','telebirr','bank'] as const).map((m) => (
                  <TouchableOpacity key={m} onPress={() => setPMethod(m)} style={[styles().pill, pMethod===m && styles().pillActive]}>
                    <Text style={pMethod===m ? styles().pillTextActive : styles().pillText}>{(m==='telebirr')?'Telebirr': m.charAt(0).toUpperCase()+m.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextInput style={[styles().input, { flex: 1 }]} placeholder="Amount" keyboardType="decimal-pad" value={pAmount} onChangeText={setPAmount} />
                <TextInput style={[styles().input, { flex: 1 }]} placeholder="Reference (optional)" value={pRef} onChangeText={setPRef} />
                <TouchableOpacity onPress={() => {
                  const v = parseFloat((pAmount || '').replace(',', '.'))
                  if (!Number.isFinite(v) || v <= 0) { Alert.alert('Split', 'Enter a valid amount'); return }
                  setPartials((arr) => [...arr, { method: pMethod, amount: v, reference: pRef.trim() || undefined }])
                  setPAmount(''); setPRef('')
                }} style={[styles().pill, styles().pillActive]}>
                  <Text style={styles().pillTextActive}>Add</Text>
                </TouchableOpacity>
              </View>
              {partials.map((p, idx) => (
                <View key={idx} style={[styles().row, { marginTop: 6 }]}>
                  <Text style={styles().cellLeft}>{p.method.toUpperCase()}{p.reference?` • ${p.reference}`:''}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles().cellRight}>ETB {p.amount.toFixed(2)}</Text>
                    <TouchableOpacity onPress={() => setPartials((arr) => arr.filter((_,i)=>i!==idx))} style={{ marginLeft: 10 }}>
                      <Text style={[styles().subtle, { color: AdminColors.danger }]}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <Text style={[styles().subtle, { marginTop: 8 }]}>Remaining: ETB {splitRemaining.toFixed(2)}</Text>
            </View>
          )}

          {/* Footer actions */}
          <View style={{ marginTop: 12 }}>
            <TouchableOpacity disabled={saving} style={[styles().primaryBtn, saving && { opacity: 0.7 }]} onPress={async () => {
              if (split && splitRemaining > 0) { Alert.alert('Split', 'Remaining balance must be zero'); return }
              if (guest && !selectedGuest) { setGuestPickerOpen(true); Alert.alert('Guest required', 'Please select or create a guest'); return }
              await onConfirm()
            }}>
              <Text style={styles().primaryBtnText}>{saving ? 'Processing…' : (split ? 'CLOSE BILL' : 'CONFIRM PAYMENT')}</Text>
            </TouchableOpacity>
            {split && (
              <Text style={[styles().subtle, { marginTop: 6, textAlign: 'center' }]}>Remaining: ETB {splitRemaining.toFixed(2)}</Text>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 10 }}>
              <TouchableOpacity style={[styles().pill, { flex: 1, height: 44, justifyContent: 'center' }]} onPress={onBack}>
                <Text style={styles().pillText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles().pill, styles().pillActive, { flex: 1, height: 44, justifyContent: 'center' }]} onPress={saveReceipt}>
                <Text style={styles().pillTextActive}>SAVE RECEIPT</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}
      {/* Full-screen QR modal */}
      <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setQrOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }}>
            {qrUrl ? (
              <Image source={{ uri: qrUrl }} style={{ width: '90%', height: '80%' }} resizeMode="contain" />
            ) : null}
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      {/* Guest picker modal */}
      <GuestPicker open={guestPickerOpen} onOpenChange={setGuestPickerOpen} onSelect={(g)=>{ setSelectedGuest(g); setGuestPickerOpen(false) }} />
      {/* Success overlay */}
      <Modal visible={successOpen} transparent animationType="fade" onRequestClose={() => setSuccessOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: AdminColors.card, borderRadius: 12, borderWidth: 1, borderColor: AdminColors.border, padding: 16, alignItems: 'center', justifyContent: 'center', width: 220 }}>
            <LottieView source={require('../../../assets/lottie/Success.json')} autoPlay loop={false} style={{ width: 140, height: 140 }} />
            <Text style={{ color: AdminColors.text, fontWeight: '800', marginTop: 8 }}>{successLabel}</Text>
          </View>
        </View>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  )
}

const styles = () => StyleSheet.create({
  container: { flex: 1, backgroundColor: AdminColors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: AdminColors.border, backgroundColor: AdminColors.card },
  back: { color: AdminColors.text, fontWeight: '700' },
  headerMid: { color: AdminColors.subtext, fontWeight: '600' },
  headerRight: { color: AdminColors.text, fontWeight: '700' },
  total: { color: AdminColors.text },

  sectionTitle: { marginTop: 6, marginBottom: 6, fontSize: 12, fontWeight: '800', color: AdminColors.text },
  card: { backgroundColor: AdminColors.card, borderRadius: 8, borderWidth: 1, borderColor: AdminColors.border, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  divider: { height: 1, backgroundColor: AdminColors.border, marginVertical: 6 },
  subtle: { fontSize: 12, color: AdminColors.subtext },
  bold: { fontWeight: '800', color: AdminColors.text },
  cellLeft: { fontSize: 13, color: AdminColors.text },
  cellRight: { fontSize: 13, color: AdminColors.text },

  pill: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: AdminColors.border, borderRadius: 8, backgroundColor: AdminColors.card },
  pillActive: { backgroundColor: AdminColors.accent, borderColor: AdminColors.accent },
  pillText: { fontSize: 12, fontWeight: '600', color: AdminColors.text },
  pillTextActive: { fontSize: 12, fontWeight: '700', color: '#1a1a1a' },

  input: { height: 40, borderRadius: 8, borderWidth: 1, borderColor: AdminColors.border, paddingHorizontal: 10, backgroundColor: AdminColors.card, color: AdminColors.text },
  switchRow: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: AdminColors.border, alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row' },

  primaryBtn: { marginTop: 14, backgroundColor: AdminColors.accent, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#1a1a1a', fontWeight: '700' },
  link: { color: AdminColors.text, fontWeight: '700' },
})

export default PaymentDetailScreen
