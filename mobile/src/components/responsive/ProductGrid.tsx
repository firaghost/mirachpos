import React, { useMemo } from 'react'
import { View, Text, Image, TouchableOpacity, FlatList } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { AdminColors } from '@/admin/theme/colors'

type Product = { id: string; name: string; price: number; image_url?: string | null }

type Props = { products: Product[]; onPress?: (p: Product) => void }

export function ProductGrid({ products, onPress }: Props) {
  const { gridColumns, spacing, radius, font, maxContentWidth } = useResponsive()
  const numColumns = gridColumns
  const size = useMemo(() => {
    return numColumns === 1 ? 120 : numColumns === 2 ? 100 : 90
  }, [numColumns])
  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: maxContentWidth }}>
        <FlatList
          data={products}
          key={numColumns}
          numColumns={numColumns}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: spacing.sm }}
          columnWrapperStyle={numColumns > 1 ? { gap: spacing.sm } : undefined}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => onPress?.(item)} style={{ flex: 1, borderWidth: 1, borderColor: AdminColors.border, backgroundColor: AdminColors.card, borderRadius: radius, padding: spacing.sm }}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={{ width: '100%', height: size, borderRadius: radius }} resizeMode="cover" />
              ) : (
                <View style={{ width: '100%', height: size, borderRadius: radius, backgroundColor: 'rgba(0,0,0,0.06)' }} />
              )}
              <Text style={{ color: AdminColors.text, fontWeight: '700', marginTop: spacing.xs, fontSize: font.body }} numberOfLines={1}>{item.name}</Text>
              <Text style={{ color: AdminColors.subtext, fontSize: font.small }}>{item.price.toFixed(2)}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    </View>
  )
}
