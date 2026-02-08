import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { OrdersListScreen } from './OrdersListScreen'
import { OrderDetailScreen } from './OrderDetailScreen'

const Stack = createNativeStackNavigator()

export function OrdersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OrdersList" component={OrdersListScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
    </Stack.Navigator>
  )
}
