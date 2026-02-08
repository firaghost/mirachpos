import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { AdminColors } from '../../theme/colors'
import { useAppTheme } from '../../../theme/ThemeProvider'

interface Props {
  label: string
  value: string | number
  hint?: string
}

export function KpiCard({ label, value, hint }: Props) {
  const { isDark } = useAppTheme()
  const styles = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: AdminColors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: AdminColors.border,
      padding: 14,
      shadowColor: '#000',
      shadowOpacity: isDark ? 0.25 : 0.08,
      shadowRadius: 8,
      elevation: isDark ? 2 : 1,
    },
    label: { color: AdminColors.subtext, fontSize: 12 },
    value: { color: AdminColors.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
    hint: { color: AdminColors.subtext, fontSize: 11, marginTop: 4 },
  }), [isDark])

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{String(value)}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}
