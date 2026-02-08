import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function ItemDetailScreen() {
  const nav = useNavigation<any>()
  const route = useRoute<any>()
  const itemId = String(route.params?.itemId || '')
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [item, setItem] = useState<any>(null)
  const [batches, setBatches] = useState<Array<{ lot?: string | null; qty: number; expiry?: string | null }>>([])
  const [delta, setDelta] = useState<string>('1')
  const [reason, setReason] = useState<string>('Adjustment')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: it } = await supabase
          .from('inventory_items')
          .select('id, name, current_stock, low_stock_threshold, branch_id')
          .eq('id', itemId)
          .maybeSingle()
        setItem(it)
        // Try to read batches/expiry if present (best-effort)
        try {
          const { data: bt } = await supabase
            .from('inventory_batches')
            .select('lot, quantity, expiry_date')
            .eq('inventory_item_id', itemId)
            .order('expiry_date', { ascending: true })
          const mapped = (bt ?? []).map((b: any) => ({ lot: (b?.lot as string) ?? null, qty: Number(b?.quantity ?? 0), expiry: b?.expiry_date ? new Date(b.expiry_date as string).toLocaleDateString() : null }))
          setBatches(mapped)
        } catch {}
      } catch (e: any) {
        setError(e?.message || 'Failed to load item')
      } finally {
        setLoading(false)
      }
    })()
  }, [itemId])

  const adjust = async (sign: 1 | -1) => {
    const n = parseFloat(delta.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return Alert.alert('Enter a positive number')
    const change = sign * Math.round(n)
    setBusy(true)
    try {
      // Load branch for movements
      const { data: it } = await supabase
        .from('inventory_items')
        .select('branch_id, current_stock')
        .eq('id', itemId)
        .maybeSingle()
      const branchId = (it as any)?.branch_id ?? null
      const current = Number((it as any)?.current_stock ?? 0)
      const next = Math.max(0, current + change)

      // 1) Write stock_movements (best-effort)
      try {
        await supabase.from('stock_movements').insert({
          inventory_item_id: itemId,
          branch_id: branchId,
          movement_type: change >= 0 ? 'in' : 'out',
          quantity: Math.abs(change),
          reason: reason || 'Adjustment',
        })
      } catch {}

      // 2) Update inventory_items current stock
      await supabase
        .from('inventory_items')
        .update({ current_stock: next })
        .eq('id', itemId)

      // Reload
      const { data: it2 } = await supabase
        .from('inventory_items')
        .select('id, name, current_stock, low_stock_threshold, branch_id')
        .eq('id', itemId)
        .maybeSingle()
      setItem(it2)
      setDelta('1')
    } finally {
      setBusy(false)
    }
  }

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    headerBar: { height: 50, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: AdminColors.border },
    title: { color: AdminColors.text, fontWeight: '800' },
    link: { color: AdminColors.accent, fontWeight: '600' },
    card: { backgroundColor: AdminColors.card, borderRadius: 14, borderWidth: 1, borderColor: AdminColors.border, padding: 12, marginBottom: 12 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    label: { color: AdminColors.subtext, fontSize: 12 },
    value: { color: AdminColors.text, fontSize: 14, fontWeight: '700' },
    sectionTitle: { color: AdminColors.text, fontWeight: '700', marginBottom: 6, marginTop: 6, paddingHorizontal: 2 },
    sub: { color: AdminColors.subtext },
    error: { color: AdminColors.danger },
    input: { backgroundColor: AdminColors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: AdminColors.text, minWidth: 60, borderWidth: 1, borderColor: AdminColors.border },
  }), [isDark, insets.top, insets.bottom])

  if (loading) return <View style={styles.center}><ActivityIndicator color={AdminColors.accent} /></View>
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
  if (!item) return <View style={styles.center}><Text style={styles.sub}>Item not found</Text></View>

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={styles.link}>Back</Text></TouchableOpacity>
        <Text style={styles.title}>{item.name || `#${String(item.id).slice(0,6)}`}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <View style={styles.card}>
          <View style={styles.row}><Text style={styles.label}>Current stock</Text><Text style={styles.value}>{Number(item.current_stock ?? 0)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Threshold</Text><Text style={styles.value}>{Number(item.low_stock_threshold ?? 0)}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Adjust</Text>
        <View style={styles.card}>
          <View style={[styles.row, { alignItems: 'center', gap: 8 }]}> 
            <Text style={styles.label}>Qty</Text>
            <TextInput value={delta} onChangeText={setDelta} keyboardType="numeric" style={styles.input} />
            <Text style={[styles.label, { marginLeft: 8 }]}>Reason</Text>
            <TextInput value={reason} onChangeText={setReason} placeholder="Reason" style={[styles.input, { flex: 1 }]} />
          </View>
          <View style={[styles.row, { gap: 12, marginTop: 8 }]}> 
            <TouchableOpacity onPress={() => adjust(+1)} disabled={busy}><Text style={[styles.link, { opacity: busy ? 0.6 : 1 }]}>Increase</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => adjust(-1)} disabled={busy}><Text style={[styles.link, { opacity: busy ? 0.6 : 1, color: AdminColors.warning }]}>Decrease</Text></TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Batches / Expiry</Text>
        <View style={styles.card}>
          {batches.length === 0 ? (
            <Text style={styles.sub}>No batch info</Text>
          ) : batches.map((b, idx) => (
            <View key={idx} style={styles.row}> 
              <Text style={[styles.value, { flex: 1 }]}>{b.lot || '-'}</Text>
              <Text style={styles.sub}>{b.expiry || '-'}</Text>
              <Text style={styles.value}>{b.qty}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
