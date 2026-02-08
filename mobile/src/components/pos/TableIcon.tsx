import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, GestureResponderEvent } from 'react-native'
import { useAppTheme } from '../../theme/ThemeProvider'
import { AdminColors } from '../../admin/theme/colors'
import TableSvg from '../../../assets/Table/Table.svg'
import { MaterialIcons } from '@expo/vector-icons'

export type TableIconProps = {
  label: string
  selected?: boolean
  multiSelected?: boolean
  status?: 'available' | 'occupied' | 'reserved' | 'cleaning' | string | null
  onPress?: (e: GestureResponderEvent) => void
  onLongPress?: (e: GestureResponderEvent) => void
}

export function TableIcon({ label, selected, multiSelected, status, onPress, onLongPress }: TableIconProps) {
  useAppTheme()

  const styles = useMemo(() => StyleSheet.create({
    root: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: 12,
      marginHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: AdminColors.border,
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: selected ? AdminColors.text : AdminColors.card,
    },
    overlayNumber: {
      color: selected ? AdminColors.bg : AdminColors.text,
      fontSize: 18,
      fontWeight: '800',
    },
    svg: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: selected ? 1 : 0.5 },
    checkWrap: {
      position: 'absolute',
      bottom: 6,
      left: 6,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: AdminColors.text,
      borderWidth: 0,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
  }), [selected, AdminColors.bg, AdminColors.card, AdminColors.text, AdminColors.border])

  const fill = selected ? AdminColors.text : AdminColors.surface
  const dimOpacity = !selected && (status === 'occupied' || status === 'reserved') ? 0.2 : 0.4

  return (
    <TouchableOpacity onPress={onPress} onLongPress={onLongPress} activeOpacity={0.85} style={styles.root}>
      <TableSvg width="100%" height="100%" style={styles.svg} fill={fill as any} fillOpacity={dimOpacity as any} />
      <Text style={styles.overlayNumber}>{label}</Text>
      {multiSelected ? (
        <View style={styles.checkWrap}>
          <MaterialIcons name="check" size={14} color={AdminColors.bg} />
        </View>
      ) : null}
    </TouchableOpacity>
  )
}
