import React from 'react'
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useAdminRole } from '../hooks/useAdminRole'
import { AdminTabs } from './AdminTabs'
import { WaiterTabs } from '@/screens/WaiterTabs'
import { AdminColors } from '../theme/colors'

export function RoleRouter({ onLogout, onConfigurePin }: { onLogout: () => void; onConfigurePin: () => void }) {
  const { data: role, isLoading, isError } = useAdminRole()

  if (isLoading) {
    return (
      <View style={styles.center}> 
        <ActivityIndicator color={AdminColors.accent} />
        <Text style={styles.label}>Loading role…</Text>
      </View>
    )
  }
  if (isError || role === 'unknown') {
    return (
      <View style={styles.center}>
        <Text style={styles.label}>Your account does not have access to this app.</Text>
        <TouchableOpacity style={styles.btn} onPress={onLogout}>
          <Text style={styles.btnText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (role === 'admin') return <AdminTabs />
  return <WaiterTabs onLogout={onLogout} onConfigurePin={onConfigurePin} />
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: AdminColors.bg },
  label: { marginTop: 6, color: AdminColors.subtext },
  btn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: AdminColors.accent },
  btnText: { color: '#fff', fontWeight: '700' },
})
