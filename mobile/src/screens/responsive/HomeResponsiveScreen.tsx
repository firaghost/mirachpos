import React from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { RHeader } from '@/components/responsive/Header'
import { RCard } from '@/components/responsive/Card'
import { RButton } from '@/components/responsive/Button'
import { AdminColors } from '@/admin/theme/colors'

export default function HomeResponsiveScreen() {
  const { spacing, maxContentWidth, gridColumns } = useResponsive()
  const cols = gridColumns
  return (
    <ScrollView style={{ flex: 1, backgroundColor: AdminColors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <RHeader title="Home" subtitle="Responsive demo" />
      <View style={{ width: '100%', alignItems: 'center', paddingHorizontal: 16 }}>
        <View style={{ width: '100%', maxWidth: maxContentWidth }}>
          <View style={{ flexDirection: cols > 1 ? 'row' : 'column', gap: spacing.md }}>
            <RCard style={{ flex: 1 }}><Text style={{ color: AdminColors.text }}>KPI 1</Text></RCard>
            <RCard style={{ flex: 1 }}><Text style={{ color: AdminColors.text }}>KPI 2</Text></RCard>
            {cols > 2 && <RCard style={{ flex: 1 }}><Text style={{ color: AdminColors.text }}>KPI 3</Text></RCard>}
          </View>
          <View style={{ marginTop: spacing.md }}>
            <RButton title="Primary action" />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
