import React from 'react'
import { View, TextInput, Text, StyleSheet, ViewStyle } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { AdminColors } from '@/admin/theme/colors'

type Props = { label?: string; placeholder?: string; value?: string; onChangeText?: (t: string) => void; style?: ViewStyle; secureTextEntry?: boolean }

export function RInput({ label, placeholder, value, onChangeText, style, secureTextEntry }: Props) {
  const { spacing, radius, font } = useResponsive()
  return (
    <View style={style}>
      {!!label && <Text style={{ marginBottom: spacing.xs, color: AdminColors.subtext, fontSize: font.small }}>{label}</Text>}
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={AdminColors.subtext}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        style={{ borderWidth: 1, borderColor: AdminColors.border, backgroundColor: AdminColors.card, color: AdminColors.text, borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 48, fontSize: font.body }}
      />
    </View>
  )
}

const styles = StyleSheet.create({})
