import { useEffect, useRef, useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, BackHandler, Animated } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Haptics from 'expo-haptics'
import { AdminColors } from '../admin/theme/colors'
import { useAppTheme } from '../theme/ThemeProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BrandTitle } from '@/components/BrandTitle'
import { registerAndSyncDeviceToken } from '@/lib/notifications'
import { useResponsive } from '@/hooks/useResponsive'

const PIN_LENGTH = 4
const ACCENT = AdminColors.accent

type Mode = 'setup' | 'unlock'

type Props = {
  mode: Mode
  // When true in setup mode, indicates we are changing an existing PIN instead of first-time setup
  isChange?: boolean
  // For setup mode: called when the user has entered and confirmed a new PIN
  onPinConfirmed?: (pin: string) => void
  // For unlock mode: validate a PIN and return true/false
  validatePin?: (pin: string) => Promise<boolean> | boolean
  // For unlock mode: called after successful PIN or biometric validation
  onUnlocked?: () => void
  // Optional cancel handler for setup mode (back to app)
  onCancel?: () => void
  // Branding title for the welcome screen (e.g., venue name)
  brandTitle?: string
  // When true in unlock mode and no PIN exists yet, show an email link to register this device
  showEmailLink?: boolean
  // Handler when user taps the email link
  onEmailLink?: () => void
  // When true, hide/disable PIN keypad (used for first-time welcome where only email link is allowed)
  disableKeypad?: boolean
}

export function PinLockScreen({ mode, isChange, onPinConfirmed, validatePin, onUnlocked, onCancel, brandTitle, showEmailLink, onEmailLink, disableKeypad }: Props) {
  const [pin, setPin] = useState('')
  const [step, setStep] = useState<'enter' | 'confirm'>('enter')
  const [firstPin, setFirstPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  // Change PIN flow: verify old PIN first, then enter/confirm new
  const [verifyingOld, setVerifyingOld] = useState<boolean>(Boolean(isChange && mode === 'setup'))
  const [authing, setAuthing] = useState(false)
  const shakeX = useRef(new Animated.Value(0))
  const insets = useSafeAreaInsets()
  const { isDark } = useAppTheme()
  const { spacing, font, isTablet, maxContentWidth } = useResponsive()

  const triggerShake = () => {
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    } catch { }
    shakeX.current.setValue(0)
    Animated.sequence([
      Animated.timing(shakeX.current, { toValue: -8, duration: 40, useNativeDriver: true }),
      Animated.timing(shakeX.current, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX.current, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX.current, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX.current, { toValue: 0, duration: 40, useNativeDriver: true }),
    ]).start()
  }

  useEffect(() => {
    (async () => {
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync()
        const isEnrolled = await LocalAuthentication.isEnrolledAsync()
        const stored = await SecureStore.getItemAsync('mobile_biometrics_enabled')
        const enabled = stored !== 'false' // default to enabled unless explicitly disabled
        setBiometricAvailable(hasHardware && isEnrolled)
        setBiometricEnabled(enabled)
      } catch {
        setBiometricAvailable(false)
      }
    })()
    // Handle Android hardware back while setting PIN
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'setup' && onCancel) {
        onCancel()
        return true
      }
      return false
    })
    return () => {
      sub.remove()
      try { void LocalAuthentication.cancelAuthenticate() } catch { }
    }
  }, [])

  const resetPin = () => {
    setPin('')
    setError(null)
  }

  const handleDigit = (digit: string) => {
    if (disableKeypad && mode === 'unlock') return
    if (pin.length >= PIN_LENGTH) return
    try { void Haptics.selectionAsync() } catch { }
    const next = pin + digit
    setPin(next)
    setError(null)

    if (next.length === PIN_LENGTH) {
      if (mode === 'setup') {
        if (verifyingOld && isChange) {
          void handleVerifyOld(next)
        } else {
          handleSetupComplete(next)
        }
      } else {
        void handleUnlockAttempt(next)
      }
    }
  }

  const handleSetupComplete = (value: string) => {
    if (step === 'enter') {
      setFirstPin(value)
      setStep('confirm')
      setTimeout(() => setPin(''), 100)
    } else {
      if (value === firstPin) {
        onPinConfirmed && onPinConfirmed(value)
      } else {
        setError('PINs do not match. Try again.')
        triggerShake()
        setFirstPin('')
        setStep('enter')
        setTimeout(() => setPin(''), 150)
      }
    }
  }

  const handleVerifyOld = async (value: string) => {
    if (!validatePin) {
      // If we cannot validate, fall back to allowing change
      setVerifyingOld(false)
      setPin('')
      setStep('enter')
      return
    }
    const ok = await validatePin(value)
    if (ok) {
      setVerifyingOld(false)
      setPin('')
      setStep('enter')
    } else {
      setError('Current PIN is incorrect')
      triggerShake()
      setTimeout(() => setPin(''), 150)
    }
  }

  const handleUnlockAttempt = async (value: string) => {
    if (!validatePin) return
    const ok = await validatePin(value)
    if (ok) {
      onUnlocked && onUnlocked()
    } else {
      setError('Wrong PIN')
      triggerShake()
      setTimeout(() => setPin(''), 150)
    }
  }

  const handleBackspace = () => {
    if (pin.length === 0) return
    setPin((prev) => prev.slice(0, -1))
    setError(null)
  }

  const handleBiometric = async () => {
    if (!biometricAvailable || !onUnlocked) return
    try {
      try { await LocalAuthentication.cancelAuthenticate() } catch { }
      setAuthing(true)
      setError(null)
      const timeoutMs = 10000
      const timeout = new Promise<{ success: false; _timeout: true }>((resolve) =>
        setTimeout(async () => {
          try { await LocalAuthentication.cancelAuthenticate() } catch { }
          resolve({ success: false, _timeout: true })
        }, timeoutMs)
      )
      const res: any = await Promise.race([
        LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock Tium Cafe',
          cancelLabel: 'Cancel',
          disableDeviceFallback: true,
        }) as any,
        timeout,
      ])
      if (res && res.success) {
        onUnlocked()
      } else if ((res as any)?._timeout) {
        setError('Biometric timed out. Use your PIN instead.')
        setBiometricAvailable(false)
      } else if (res && (res.error || res.warning)) {
        setError('Biometric unavailable. Use your PIN.')
        setBiometricAvailable(false)
      }
    } finally {
      setAuthing(false)
    }
  }

  const handleSkipBiometric = async () => {
    setError(null)
    try { await LocalAuthentication.cancelAuthenticate() } catch { }
    setBiometricAvailable(false)
  }

  const title = (() => {
    if (mode === 'setup') {
      if (isChange) {
        if (verifyingOld) return 'Enter current PIN'
        return step === 'enter' ? 'Enter new PIN' : 'Confirm new PIN'
      }
      return step === 'enter' ? 'Create PIN' : 'Confirm PIN'
    }
    // Unlock mode: show instruction only; brand is rendered by BrandTitle above
    return 'Enter PIN'
  })()

  const subtitle = (() => {
    if (mode === 'setup') {
      if (isChange) {
        return verifyingOld
          ? 'We need your current PIN to proceed.'
          : 'Choose a new 4-digit PIN to secure this device.'
      }
      return 'Create a 4-digit PIN to unlock Tium Cafe without email.'
    }
    return brandTitle
      ? 'Use your PIN or fingerprint to continue.'
      : 'Use your PIN or fingerprint to unlock.'
  })()

  const styles = useMemo(() => {
    const padH = Math.max(spacing.md, 16)
    const padTop = Math.max(insets.top, spacing.md + 8)
    const padBottom = Math.max(insets.bottom, Math.round(spacing.sm))
    const titleSize = Math.max(28, font.h1)
    const subSize = font.body
    const dotSize = isTablet ? 14 : 12
    const dotRadius = Math.round(dotSize / 2)
    const keyW = isTablet ? 96 : 84
    const keyH = isTablet ? 76 : 66
    const keyRadius = Math.round(keyH / 2)
    const keyTextSize = Math.max(26, font.h2)
    return StyleSheet.create({
      container: {
        flex: 1,
        backgroundColor: AdminColors.bg,
        paddingHorizontal: padH,
        paddingTop: padTop,
        paddingBottom: padBottom,
        alignItems: 'center',
        justifyContent: 'flex-start',
      },
      content: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
      topBar: {
        width: '100%',
        paddingHorizontal: padH,
        paddingVertical: Math.max(8, Math.round(spacing.xs)),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: Math.max(8, Math.round(spacing.xs)),
      },
      backLink: { color: AdminColors.accent, fontWeight: '600' },
      topBarTitle: { fontSize: subSize, fontWeight: '700', color: AdminColors.text },
      title: { fontSize: titleSize, fontWeight: '800', marginBottom: Math.round(spacing.sm), textAlign: 'center', color: AdminColors.text },
      subtitle: { fontSize: subSize, color: AdminColors.subtext, textAlign: 'center', marginBottom: Math.round(spacing.md) },
      dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: Math.round(spacing.sm), marginBottom: Math.round(spacing.md) },
      dot: { width: dotSize, height: dotSize, borderRadius: dotRadius, borderWidth: 1, borderColor: AdminColors.border, marginHorizontal: Math.max(6, Math.round(spacing.xs)) },
      dotFilled: { backgroundColor: ACCENT, borderColor: ACCENT },
      dotEmpty: { backgroundColor: 'transparent', borderColor: AdminColors.border },
      error: { color: AdminColors.danger, fontSize: 12, marginBottom: 4, textAlign: 'center' },
      keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: Math.round(spacing.md), marginBottom: Math.round(spacing.sm) },
      footer: { width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
      emailLinkWrap: { marginTop: Math.round(spacing.sm) },
      key: { width: keyW, height: keyH, marginHorizontal: Math.max(6, Math.round(spacing.xs)), marginVertical: Math.max(6, Math.round(spacing.xs)), borderRadius: keyRadius, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', shadowOpacity: 0, elevation: 0 },
      keyText: { fontSize: keyTextSize, fontWeight: '700', color: AdminColors.text },
      biometricButton: { marginTop: Math.round(spacing.md), paddingHorizontal: Math.round(spacing.md + 8), paddingVertical: Math.round(spacing.sm), borderRadius: 999, borderWidth: 1, borderColor: AdminColors.border },
      biometricText: { fontSize: subSize, color: AdminColors.text },
      biometricButtonLarge: { marginTop: Math.round(spacing.lg), paddingHorizontal: Math.round(spacing.lg), paddingVertical: Math.round(spacing.md) },
      biometricTextLarge: { fontSize: Math.max(font.h3, 16), fontWeight: '600' },
      emailLink: { color: ACCENT, fontSize: subSize, fontWeight: '600', textDecorationLine: 'underline' },
    })
  }, [isDark, insets.top, insets.bottom, spacing, font, isTablet])

  return (
    <View style={styles.container}>
      {/* Brand header */}
      {mode === 'unlock' && (
        <View style={{ width: '100%', alignItems: 'center', marginTop: 8 }}>
          <BrandTitle text={brandTitle || 'Tium Cafe'} align="center" size={'xl'} />
        </View>
      )}
      {mode === 'setup' && (
        <View style={styles.topBar}>
          {onCancel ? (
            <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.backLink}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <Text style={styles.topBarTitle}>{isChange ? 'Security' : 'Set up security'}</Text>
          <View style={{ width: 40 }} />
        </View>
      )}

      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {!(mode === 'unlock' && !disableKeypad) && (
          <Text style={styles.subtitle}>{subtitle}</Text>
        )}

        {mode === 'unlock' && disableKeypad && biometricAvailable && biometricEnabled && (
          <TouchableOpacity onPress={handleBiometric} disabled={authing} style={{ marginTop: 12 }}>
            <MaterialCommunityIcons name="fingerprint" size={72} color={AdminColors.accent} />
          </TouchableOpacity>
        )}

        {mode === 'unlock' && disableKeypad ? (
          <View style={{ height: 28 }} />
        ) : (
          <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeX.current }] }]}>
            {Array.from({ length: PIN_LENGTH }).map((_, idx) => (
              <View key={idx} style={[styles.dot, idx < pin.length ? styles.dotFilled : styles.dotEmpty]} />
            ))}
          </Animated.View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : <View style={{ height: 18 }} />}
      </View>

      <View style={styles.footer}>
        {!(mode === 'unlock' && disableKeypad) && (
          <View style={styles.keypad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <TouchableOpacity key={d} style={styles.key} onPress={() => handleDigit(d)}>
                <Text style={styles.keyText}>{d}</Text>
              </TouchableOpacity>
            ))}
            {biometricAvailable && biometricEnabled ? (
              <TouchableOpacity style={styles.key} onPress={handleBiometric} disabled={authing}>
                <MaterialCommunityIcons name="fingerprint" size={28} color={AdminColors.accent} />
              </TouchableOpacity>
            ) : (
              <View style={styles.key} />
            )}
            <TouchableOpacity style={styles.key} onPress={() => handleDigit('0')}>
              <Text style={styles.keyText}>0</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.key} onPress={handleBackspace}>
              <MaterialCommunityIcons name="backspace-outline" size={28} color={AdminColors.accent} />
            </TouchableOpacity>
          </View>
        )}

        {mode === 'unlock' && showEmailLink && (
          <TouchableOpacity onPress={onEmailLink} style={styles.emailLinkWrap}>
            <Text style={styles.emailLink}>Use email instead</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}
