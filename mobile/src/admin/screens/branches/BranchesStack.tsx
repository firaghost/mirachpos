import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { BranchesListScreen } from './BranchesListScreen'
import { BranchDetailScreen } from './BranchDetailScreen'

const Stack = createNativeStackNavigator()

export function BranchesStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="BranchesList" component={BranchesListScreen} />
      <Stack.Screen name="BranchDetail" component={BranchDetailScreen} />
    </Stack.Navigator>
  )
}
