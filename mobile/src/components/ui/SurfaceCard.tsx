import React, { useMemo } from 'react'
import { View, ViewProps, StyleSheet } from 'react-native'
import { AdminColors } from '../../admin/theme/colors'
import { useAppTheme } from '../../theme/ThemeProvider'

type Props = ViewProps & {
  variant?: 'card' | 'surface'
  padded?: boolean
  rounded?: number
  elevated?: boolean
}

export function SurfaceCard({ variant = 'card', padded = true, rounded = 12, elevated = false, style, ...rest }: Props) {
  const { isDark } = useAppTheme()

  const styles = useMemo(() => StyleSheet.create({
    root: {
      backgroundColor: variant === 'card' ? AdminColors.card : AdminColors.surface,
      borderColor: AdminColors.border,
      borderWidth: 1,
      borderRadius: rounded,
      padding: padded ? 12 : 0,
      shadowColor: '#000',
      shadowOpacity: elevated ? (isDark ? 0.16 : 0.08) : 0,
      shadowRadius: elevated ? 6 : 0,
      elevation: elevated ? 2 : 0,
    },
  }), [variant, padded, rounded, elevated, isDark])

  return <View style={[styles.root, style]} {...rest} />
}
