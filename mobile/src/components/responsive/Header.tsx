import React from 'react'
import { View, Text, StyleSheet, ViewStyle } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { AdminColors } from '@/admin/theme/colors'

type Props = { title: string; subtitle?: string; right?: React.ReactNode; left?: React.ReactNode; style?: ViewStyle }

export function RHeader({ title, subtitle, right, left, style }: Props) {
  const { spacing, font, maxContentWidth } = useResponsive()
  return (
    <View style={[styles.wrap, style]}> 
      <View style={[styles.inner, { maxWidth: maxContentWidth }]}> 
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: font.h1, fontWeight: '800', color: AdminColors.text }}>{title}</Text>
            {!!subtitle && <Text style={{ marginTop: 2, fontSize: font.body, color: AdminColors.subtext }}>{subtitle}</Text>}
          </View>
          {!!right && <View style={{ marginLeft: spacing.md }}>{right}</View>}
          {!!left && <View style={{ marginRight: spacing.md }}>{left}</View>}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  inner: { width: '100%', alignSelf: 'center' },
})
