import React, { useMemo } from 'react'
import { Pressable, Text, ViewStyle, TextStyle, StyleSheet, GestureResponderEvent, View } from 'react-native'
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'

export type ChatButtonProps = {
  title: string
  onPress?: (event: GestureResponderEvent) => void
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  style?: ViewStyle
  textStyle?: TextStyle
  disabled?: boolean
  left?: React.ReactNode
  right?: React.ReactNode
}

export function ChatButton({ title, onPress, variant = 'secondary', size = 'md', style, textStyle, disabled, left, right }: ChatButtonProps) {
  const { isDark } = useAppTheme()

  const styles = useMemo(() => {
    const padV = size === 'sm' ? 8 : 12
    const padH = size === 'sm' ? 12 : 16
    const background = variant === 'primary' ? AdminColors.accent : variant === 'ghost' ? 'transparent' : AdminColors.card
    const textColor = variant === 'primary' ? (isDark ? '#1B1B1B' : '#FFFFFF') : AdminColors.text
    const borderColor = variant === 'ghost' ? 'transparent' : AdminColors.border

    return StyleSheet.create({
      root: {
        backgroundColor: background,
        borderColor,
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: padV,
        paddingHorizontal: padH,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        opacity: disabled ? 0.6 : 1,
      },
      label: {
        color: textColor,
        fontSize: size === 'sm' ? 14 : 16,
        fontWeight: '600',
      },
      side: { marginHorizontal: 6 },
    })
  }, [isDark, variant, size, disabled])

  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.root, style]}
      android_ripple={variant === 'ghost' ? undefined : { color: 'rgba(0,0,0,0.05)' }}>
      {left ? <View style={styles.side}>{left}</View> : null}
      <Text style={[styles.label, textStyle]}>{title}</Text>
      {right ? <View style={styles.side}>{right}</View> : null}
    </Pressable>
  )
}
