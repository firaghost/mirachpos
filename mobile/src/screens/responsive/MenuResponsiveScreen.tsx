import React from 'react'
import { View } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { RHeader } from '@/components/responsive/Header'
import { ProductGrid } from '@/components/responsive/ProductGrid'
import { AdminColors } from '@/admin/theme/colors'

export default function MenuResponsiveScreen() {
  const { maxContentWidth } = useResponsive()
  const products = new Array(15).fill(0).map((_, i) => ({ id: String(i), name: `Product ${i + 1}`, price: Math.round(5 + Math.random() * 50) }))
  return (
    <View style={{ flex: 1, backgroundColor: AdminColors.bg }}>
      <RHeader title="Menu" />
      <View style={{ width: '100%', alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: maxContentWidth }}>
          <ProductGrid products={products} />
        </View>
      </View>
    </View>
  )
}
