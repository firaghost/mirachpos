import { useState, useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { loginWithEmailPassword } from '@/lib/mirachposSession'
import NetInfo from '@react-native-community/netinfo'
import { getLastProfile, setLastProfile } from '@/lib/db'
import { AdminColors } from '../admin/theme/colors'
import { useAppTheme } from '../theme/ThemeProvider'
import { BrandTitle } from '@/components/BrandTitle'
import { registerAndSyncDeviceToken } from '@/lib/notifications'
import { useResponsive } from '@/hooks/useResponsive'
import { RInput } from '@/components/responsive/Input'
import { RButton } from '@/components/responsive/Button'

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Login request timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(id)
        resolve(value)
      },
      (err) => {
        clearTimeout(id)
        reject(err)
      }
    )
  })
}

type Props = {
  onLoggedIn: () => void
}

export function LoginScreen({ onLoggedIn }: Props) {
  useAppTheme() // re-render on theme change
  const { spacing, font, maxContentWidth } = useResponsive()
  const [tenantSlug, setTenantSlug] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async () => {
    setError(null)
    setLoading(true)
    try {
      const net = await NetInfo.fetch()
      if (!net.isConnected) {
        // Offline: allow entry if we have a last known profile persisted locally
        try {
          const lp = await getLastProfile()
          if (lp) {
            onLoggedIn()
            return
          }
          setError('Offline login unavailable. Connect to the internet once to sign in, then you can use the app offline.')
          return
        } finally {
          setLoading(false)
        }
      }
      const out = await withTimeout(
        loginWithEmailPassword({ tenantSlug, email, password }),
        15000
      )

      if (!out.ok) {
        const emsg = String(out.error || '').toLowerCase().trim()
        if (
          emsg &&
          (/network|fetch|timeout|connection/.test(emsg)
            || /an error occurred/.test(emsg)
            || /try again later/.test(emsg)
            || /press the refresh button/.test(emsg))
        ) {
          // Network-related failure: try offline fallback
          const lp = await getLastProfile()
          if (lp) { onLoggedIn(); return }
          setError('Offline login unavailable. Connect once to sign in, then you can use the app offline.')
          return
        }
        // Treat empty or non-network messages as invalid credentials so the user always sees feedback
        setError(String(out.error || 'Invalid credentials'))
        return
      }
      try {
        const role = String(out.session.role || '').trim()
        const branchId = String(out.session.branchId || 'global')
        const staffId = String(out.session.staffId || '').trim()
        if (!staffId || !role) {
          setError('Unable to verify your account. Please try again.')
          return
        }
        try {
          await setLastProfile({ id: staffId, role, branch_id: branchId })
        } catch {}
      } catch (e: any) {
        // If profile lookup fails unexpectedly
        const emsg = (e?.message || '').toLowerCase()
        if (
          /network|fetch|timeout|connection/.test(emsg)
          || /an error occurred/.test(emsg)
          || /try again later/.test(emsg)
          || /press the refresh button/.test(emsg)
        ) {
          const lp = await getLastProfile()
          if (lp) { onLoggedIn(); return }
        }
        setError('Unable to verify your account. Please try again or contact support.')
        return
      }
      // Immediately register a push token for this account (dev/preview/prod build only)
      try { await registerAndSyncDeviceToken() } catch {}
      // Let the app-level RoleRouter decide which UI (Admin vs Waiter) to show based on profile.role
      // No role gate here — only invalid credentials are blocked
      onLoggedIn()
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase()
      if (/timeout|network|fetch|connection/.test(msg)) {
        const lp = await getLastProfile()
        if (lp) {
          onLoggedIn()
          return
        }
        setError('Unable to reach the server. Check your internet connection and try again.')
      } else {
        setError('Login failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError(null)
    setLoading(true)
    try {
      const net = await NetInfo.fetch()
      if (!net.isConnected) {
        setError('Google sign-in requires internet. Connect and try again, or use email/password when online once to enable offline use.')
        return
      }
      setError('Google sign-in is not supported on cPanel login yet. Use email/password.')
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (/sign in cancelled/i.test(msg)) setError('Google sign-in was cancelled')
      else setError(msg || 'Google sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', backgroundColor: AdminColors.bg },
    inner: { width: '100%', alignItems: 'center', paddingHorizontal: 16 },
    maxWrap: { width: '100%', maxWidth: maxContentWidth },
    subtitle: { fontSize: font.body, color: AdminColors.subtext, marginBottom: spacing.md, textAlign: 'center' },
    error: { color: '#b91c1c', fontSize: 12, marginBottom: 4, textAlign: 'right' },
  }), [maxContentWidth, spacing.md, font.body])

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.maxWrap}>
          <BrandTitle text="Tium Cafe" align="center" size="xl" />
          <Text style={styles.subtitle}>Sign in</Text>
          <RInput
            label="Tenant"
            placeholder="tenant-slug"
            value={tenantSlug}
            onChangeText={setTenantSlug}
          />
          <View style={{ height: spacing.sm }} />
          <RInput
            label="Email"
            placeholder="name@example.com"
            value={email}
            onChangeText={setEmail}
          />
          <View style={{ height: spacing.sm }} />
          <RInput
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={{ height: spacing.sm }} />
          <RButton title={loading ? 'Please wait…' : 'Sign in'} onPress={handleLogin} disabled={loading} />
          <View style={{ height: spacing.sm }} />
          <RButton title={loading ? 'Please wait…' : 'Continue with Google'} onPress={handleGoogleLogin} disabled={loading} variant="secondary" />
        </View>
      </View>
    </View>
  )
}
