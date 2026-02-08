import React from 'react'
import { View, StyleSheet, ViewStyle } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { AdminColors } from '@/admin/theme/colors'

type Props = { children?: React.ReactNode; style?: ViewStyle }

export function RCard({ children, style }: Props) {
  const { spacing, radius } = useResponsive()
  return (
    <View style={[styles.card, { padding: spacing.md, borderRadius: radius, borderColor: AdminColors.border, backgroundColor: AdminColors.card }, style]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
})
