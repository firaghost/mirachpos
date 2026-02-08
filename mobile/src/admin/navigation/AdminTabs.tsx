import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer, DarkTheme as NavDark, DefaultTheme as NavLight } from '@react-navigation/native'
import { AdminDashboardScreen } from '../screens/dashboard/AdminDashboardScreen'
import { OrdersStack } from '../screens/orders/OrdersStack'
import { InventoryStack } from '../screens/inventory/InventoryStack'
import { BranchesStack } from '../screens/branches/BranchesStack'
import { MoreStack } from '../screens/more/MoreStack'
import { AdminColors } from '../theme/colors'
import { MaterialIcons } from '@expo/vector-icons'
import { useAppTheme } from '../../theme/ThemeProvider'
import { HomeScreen } from '../screens/HomeScreen'

const Tab = createBottomTabNavigator()

export function AdminTabs() {
  const { isDark } = useAppTheme()
  return (
    <NavigationContainer independent theme={isDark ? { ...NavDark, colors: { ...NavDark.colors, background: AdminColors.bg, card: AdminColors.card, text: AdminColors.text, border: AdminColors.border } } : { ...NavLight, colors: { ...NavLight.colors, background: AdminColors.bg, card: AdminColors.card, text: AdminColors.text, border: AdminColors.border } }}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: { backgroundColor: AdminColors.card, borderTopColor: AdminColors.border },
          tabBarActiveTintColor: AdminColors.accent,
          tabBarInactiveTintColor: AdminColors.subtext,
          tabBarIcon: ({ color, size }) => {
            const map: Record<string, keyof typeof MaterialIcons.glyphMap> = {
              Home: 'home',
              Dashboard: 'dashboard',
              Orders: 'receipt',
              Inventory: 'inventory',
              Branches: 'place',
              More: 'more-horiz',
            }
            const name = map[route.name] || 'dashboard'
            return <MaterialIcons name={name as any} size={size} color={color} />
          },
          tabBarLabelStyle: { fontSize: 11 },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Dashboard" component={AdminDashboardScreen} />
        <Tab.Screen name="Orders" component={OrdersStack} />
        <Tab.Screen name="Inventory" component={InventoryStack} />
        <Tab.Screen name="Branches" component={BranchesStack} />
        <Tab.Screen name="More" component={MoreStack} />
      </Tab.Navigator>
    </NavigationContainer>
  )
}
