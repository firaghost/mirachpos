import React from 'react'
import { View, Text, StyleSheet, ViewStyle } from 'react-native'
import { AdminColors } from '../admin/theme/colors'

export function BrandTitle({
  text,
  style,
  align = 'left',
  size = 'lg',
}: {
  text: string
  style?: ViewStyle
  align?: 'left' | 'center'
  size?: 'xl' | 'lg' | 'md' | 'sm'
}) {
  const words = (text || '').trim().split(/\s+/)
  const script = words[0] || ''
  const rest = words.slice(1).join(' ')

  const s = styles(size, align)

  return (
    <View style={[s.row, style]} pointerEvents="none">
      <Text
        style={[s.script, { color: AdminColors.text }]}
        numberOfLines={1}
        ellipsizeMode="clip"
        allowFontScaling={false}
      >
        {script}
      </Text>
      {!!rest && (
        <Text
          style={[s.sans, { color: AdminColors.text }]}
          numberOfLines={1}
          ellipsizeMode="clip"
          allowFontScaling={false}
        >
          {rest}
        </Text>
      )}
    </View>
  )
}

function styles(size: 'xl' | 'lg' | 'md' | 'sm', align: 'left' | 'center') {
  const cfg = size === 'xl'
    ? { fs: 52, lh: 60, sansFs: 18, sansLh: 24 }
    : size === 'lg'
      ? { fs: 44, lh: 52, sansFs: 16, sansLh: 22 }
      : size === 'md'
        ? { fs: 36, lh: 42, sansFs: 14, sansLh: 20 }
        : { fs: 28, lh: 34, sansFs: 12, sansLh: 18 }
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: align === 'center' ? 'center' : 'flex-start' },
    script: { fontSize: cfg.fs, lineHeight: cfg.lh, fontWeight: '600', fontStyle: 'normal', letterSpacing: 0, marginRight: 1, fontFamily: 'BrandScript' },
    sans: { fontSize: cfg.sansFs, lineHeight: cfg.sansLh, fontWeight: '600', opacity: 0.98, letterSpacing: 0.1 },
  })
}
