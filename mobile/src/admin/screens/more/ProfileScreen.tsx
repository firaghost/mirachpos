import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function ProfileScreen() {
  const nav = useNavigation<any>()
  const [name, setName] = useState<string>('')
  const [email, setEmail] = useState<string>('')
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      setEmail(user?.email || '')
      if (user?.id) {
        const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
        setName(String((prof as any)?.full_name || ''))
      }
    })()
  }, [])

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
    header: { height: 50, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: AdminColors.border },
    title: { color: AdminColors.text, fontWeight: '800' },
    link: { color: AdminColors.accent, fontWeight: '600' },
    card: { margin: 16, backgroundColor: AdminColors.card, borderRadius: 12, borderWidth: 1, borderColor: AdminColors.border, padding: 14 },
    sectionTitle: { color: AdminColors.text, fontWeight: '800', marginBottom: 8 },
    label: { color: AdminColors.subtext, fontSize: 12 },
    value: { color: AdminColors.text, fontSize: 14, fontWeight: '700' },
    sub: { color: AdminColors.subtext, marginTop: 6 },
    segment: { flexDirection: 'row', backgroundColor: AdminColors.surface, borderRadius: 999, padding: 2, alignSelf: 'flex-start', marginTop: 8 },
    segChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
    segChipActive: { backgroundColor: AdminColors.accent },
    segText: { color: AdminColors.subtext, fontSize: 12, fontWeight: '700' },
    segTextActive: { color: '#1a1a1a' },
  }), [isDark, insets.top, insets.bottom])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={styles.link}>Back</Text></TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <Text style={styles.value}>{name || '—'}</Text>
        <Text style={[styles.label, { marginTop: 10 }]}>Email</Text>
        <Text style={styles.value}>{email || '—'}</Text>
      </View>
      
    </View>
  )
}
