import React from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { RHeader } from '@/components/responsive/Header'
import { RCard } from '@/components/responsive/Card'
import { RInput } from '@/components/responsive/Input'
import { RButton } from '@/components/responsive/Button'
import { AdminColors } from '@/admin/theme/colors'

export default function SettingsResponsiveScreen() {
  const { spacing, isTablet, maxContentWidth } = useResponsive()
  const contentWidth = isTablet ? Math.min(maxContentWidth, 900) : maxContentWidth
  return (
    <ScrollView style={{ flex: 1, backgroundColor: AdminColors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <RHeader title="Settings" />
      <View style={{ flexDirection: isTablet ? 'row' : 'column', width: '100%' }}>
        {isTablet && (
          <View style={{ width: 260, borderRightWidth: 1, borderColor: AdminColors.border, padding: 16 }}>
            <Text style={{ color: AdminColors.subtext, fontWeight: '700' }}>Sidebar</Text>
            <Text style={{ color: AdminColors.subtext, marginTop: 8 }}>Profile</Text>
            <Text style={{ color: AdminColors.subtext, marginTop: 8 }}>Preferences</Text>
            <Text style={{ color: AdminColors.subtext, marginTop: 8 }}>Notifications</Text>
          </View>
        )}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ width: '100%', maxWidth: contentWidth, paddingHorizontal: 16, marginTop: spacing.md }}>
            <RCard>
              <RInput label="Name" placeholder="Your name" />
              <View style={{ height: spacing.md }} />
              <RInput label="Email" placeholder="Your email" />
              <View style={{ height: spacing.md }} />
              <RButton title="Save changes" />
            </RCard>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
