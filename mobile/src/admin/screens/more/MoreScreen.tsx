import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AdminColors } from '../../theme/colors'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function MoreScreen() {
  const nav = useNavigation<any>()
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const items = [
    { key: 'Staff', desc: 'Manage staff and performance', route: 'Staff' },
    { key: 'Reports', desc: 'Sales, products, KPIs', route: 'Reports' },
    { key: 'Finance', desc: 'Cash & settlements', route: 'Finance' },
    { key: 'Settings', desc: 'Branch & app settings', route: 'Settings' },
    { key: 'Profile', desc: 'Your account & device', route: 'Profile' },
  ]
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, padding: 16, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
    title: { color: AdminColors.text, fontSize: 18, fontWeight: '800' },
    menu: { marginTop: 12, gap: 10 },
    item: { backgroundColor: AdminColors.card, borderWidth: 1, borderColor: AdminColors.border, borderRadius: 12, padding: 14 },
    itemTitle: { color: AdminColors.text, fontWeight: '800' },
    itemDesc: { color: AdminColors.subtext, marginTop: 2 },
  }), [isDark, insets.top, insets.bottom])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>More</Text>
      <View style={styles.menu}>
        {items.map((it) => (
          <TouchableOpacity key={it.key} style={styles.item} onPress={() => nav.navigate(it.route)}>
            <Text style={styles.itemTitle}>{it.key}</Text>
            <Text style={styles.itemDesc}>{it.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}
