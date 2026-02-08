import React from 'react'
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { AdminColors } from '@/admin/theme/colors'

type Tab = { key: string; label: string }

type Props = { tabs: Tab[]; value: string; onChange: (key: string) => void }

export function RTabs({ tabs, value, onChange }: Props) {
  const { spacing, radius, font } = useResponsive()
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: spacing.sm }}>
      {tabs.map(t => {
        const active = t.key === value
        return (
          <TouchableOpacity key={t.key} onPress={() => onChange(t.key)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius, borderWidth: 1, borderColor: active ? AdminColors.accent : AdminColors.border, backgroundColor: active ? AdminColors.accent : 'transparent' }}>
            <Text style={{ color: active ? '#1a1a1a' : AdminColors.subtext, fontWeight: '700', fontSize: font.small }}>{t.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}
