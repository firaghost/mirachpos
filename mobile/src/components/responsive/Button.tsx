import React from 'react'
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { AdminColors } from '@/admin/theme/colors'

type Props = {
  title: string
  onPress?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  style?: ViewStyle
}

export function RButton({ title, onPress, variant = 'primary', disabled, style }: Props) {
  const { spacing, radius, font, isPhone } = useResponsive()
  const base = [
    styles.btn,
    { paddingVertical: Math.max(12, spacing.sm), paddingHorizontal: Math.max(16, spacing.md), borderRadius: radius, minHeight: 48 },
  ]
  const theme = (() => {
    if (variant === 'secondary') return { backgroundColor: 'transparent', borderWidth: 1, borderColor: AdminColors.border }
    if (variant === 'ghost') return { backgroundColor: 'transparent' }
    return { backgroundColor: AdminColors.accent }
  })()
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[...base, theme as any, disabled ? { opacity: 0.6 } : null, style]}>
      <Text style={{ color: variant === 'primary' ? '#1a1a1a' : AdminColors.text, fontSize: font.body, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
})
