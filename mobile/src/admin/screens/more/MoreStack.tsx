import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { MoreScreen } from './MoreScreen'
import { StaffScreen } from './StaffScreen'
import { ReportsScreen } from './ReportsScreen'
import { FinanceScreen } from './FinanceScreen'
import { SettingsScreen } from './SettingsScreen'
import { ProfileScreen } from './ProfileScreen'

const Stack = createNativeStackNavigator()

export function MoreStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MoreHome" component={MoreScreen} />
      <Stack.Screen name="Staff" component={StaffScreen} />
      <Stack.Screen name="Reports" component={ReportsScreen} />
      <Stack.Screen name="Finance" component={FinanceScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
    </Stack.Navigator>
  )
}
