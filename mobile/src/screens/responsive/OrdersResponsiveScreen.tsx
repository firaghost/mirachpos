import React from 'react'
import { ScrollView, View } from 'react-native'
import { useResponsive } from '@/hooks/useResponsive'
import { RHeader } from '@/components/responsive/Header'
import { OrderTile } from '@/components/responsive/OrderTile'
import { AdminColors } from '@/admin/theme/colors'

export default function OrdersResponsiveScreen() {
  const { spacing, maxContentWidth, gridColumns } = useResponsive()
  const cols = Math.max(1, Math.min(2, gridColumns))
  const orders: { id: string; label: string; time: string; amount: number; status: 'pending' | 'completed' }[] =
    new Array(8).fill(0).map((_, i) => ({ id: String(i), label: `Table ${i + 1}`, time: 'Fri, 10:12', amount: 45 + i, status: (i % 3 ? 'pending' : 'completed') as 'pending' | 'completed' }))
  return (
    <ScrollView style={{ flex: 1, backgroundColor: AdminColors.bg }}>
      <RHeader title="Orders" />
      <View style={{ width: '100%', alignItems: 'center', paddingHorizontal: 16 }}>
        <View style={{ width: '100%', maxWidth: maxContentWidth }}>
          <View style={{ flexDirection: cols > 1 ? 'row' : 'column', flexWrap: 'wrap', gap: spacing.md }}>
            {orders.map(o => (
              <View key={o.id} style={{ flexBasis: cols > 1 ? '48%' as any : '100%' }}>
                <OrderTile label={o.label} time={o.time} amount={o.amount} status={o.status} />
              </View>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
