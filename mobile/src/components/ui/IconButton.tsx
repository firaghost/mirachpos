import React, { useMemo } from 'react'
import { Pressable, ViewStyle, StyleSheet } from 'react-native'
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'

export type IconButtonProps = {
  onPress?: () => void
  size?: number
  style?: ViewStyle
  rounded?: boolean
  disabled?: boolean
  children?: React.ReactNode
}

export function IconButton({ onPress, size = 40, style, rounded = true, disabled, children }: IconButtonProps) {
  useAppTheme()
  const styles = useMemo(() => StyleSheet.create({
    root: {
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: rounded ? size / 2 : 8,
      backgroundColor: AdminColors.card,
      borderColor: AdminColors.border,
      borderWidth: 1,
      opacity: disabled ? 0.6 : 1,
    },
  }), [size, rounded, disabled, AdminColors.card, AdminColors.border])

  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.root, style]}
      android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: true }}>
      {children}
    </Pressable>
  )
}
