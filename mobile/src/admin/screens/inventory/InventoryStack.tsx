import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { InventoryScreen } from './InventoryScreen'
import { ItemDetailScreen } from './ItemDetailScreen'

const Stack = createNativeStackNavigator()

export function InventoryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="InventoryList" component={InventoryScreen} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen} />
    </Stack.Navigator>
  )
}
