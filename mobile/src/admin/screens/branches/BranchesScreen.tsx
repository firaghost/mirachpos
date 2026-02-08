import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { AdminColors } from '../../theme/colors'
import { useAppTheme } from '../../../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function BranchesScreen() {
  const { isDark } = useAppTheme()
  const insets = useSafeAreaInsets()

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: AdminColors.bg, padding: 16, paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
    title: { color: AdminColors.text, fontSize: 18, fontWeight: '800' },
    sub: { color: AdminColors.subtext, marginTop: 6 },
  }), [isDark, insets.top, insets.bottom])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Branches</Text>
      <Text style={styles.sub}>Live branch stats, online staff/devices, remote shift control — coming soon</Text>
    </View>
  )
}
