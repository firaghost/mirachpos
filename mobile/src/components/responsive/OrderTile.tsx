import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { AdminColors } from '@/admin/theme/colors'

type Props = {
  label: string
  time: string
  amount?: number
  status?: 'pending' | 'preparing' | 'takeaway' | 'completed' | 'cancelled'
  onPress?: () => void
}

export function OrderTile({ label, time, amount = 0, status = 'pending', onPress }: Props) {
  const { spacing, radius, font } = useResponsive()
  const badge = (() => {
    const base = { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 999 }
    if (status === 'completed') return { ...base, backgroundColor: AdminColors.surface }
    if (status === 'cancelled') return { ...base, backgroundColor: AdminColors.danger }
    return { ...base, backgroundColor: AdminColors.warning }
  })()
  return (
    <TouchableOpacity onPress={onPress} style={{ borderWidth: 1, borderColor: AdminColors.border, backgroundColor: AdminColors.card, borderRadius: radius, padding: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: AdminColors.text, fontWeight: '700', fontSize: font.body }}>{label}</Text>
          <Text style={{ color: AdminColors.subtext, fontSize: font.small }}>{time}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: AdminColors.text, fontWeight: '800', fontSize: font.h3 }}>{amount.toFixed(2)}</Text>
          <View style={[badge as any, { marginTop: 4 }]}>
            <Text style={{ color: '#1a1a1a', fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>{status}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  )
}
