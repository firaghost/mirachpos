import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Appearance, Platform, StatusBar } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as NavigationBar from 'expo-navigation-bar'
import { supabase } from '@/lib/supabase'
import { AdminColors, applyAdminPalette, DarkAdminPalette, LightAdminPalette } from '../admin/theme/colors'

export type ThemeSetting = 'auto' | 'light' | 'dark'

export interface AppThemeContext {
  setting: ThemeSetting
  isDark: boolean
  systemIsDark: boolean
  setSetting: (s: ThemeSetting) => void
}

const Ctx = createContext<AppThemeContext | null>(null)

const STORAGE_KEY = 'app_theme_setting'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [setting, _setSetting] = useState<ThemeSetting>('auto')
  const [ready, setReady] = useState(false)
  const [accentOverride, setAccentOverride] = useState<string | null>(null)
  const [systemIsDark, setSystemIsDark] = useState<boolean>(Appearance.getColorScheme() === 'dark')
  const isDark = systemIsDark

  function mutedFrom(hex: string): string {
    try {
      // Simple darken ~15%
      const v = hex.replace('#','')
      const r = Math.max(0, parseInt(v.slice(0,2),16) - 0x26)
      const g = Math.max(0, parseInt(v.slice(2,4),16) - 0x26)
      const b = Math.max(0, parseInt(v.slice(4,6),16) - 0x26)
      const toHex = (n:number)=> n.toString(16).padStart(2,'0')
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`
    } catch { return hex }
  }

  // Apply palettes to mutable AdminColors so all admin screens update without refactor
  useEffect(() => {
    const base = isDark ? DarkAdminPalette : LightAdminPalette
    const pal = accentOverride ? { ...base, accent: accentOverride, accentMuted: mutedFrom(accentOverride) } : base
    applyAdminPalette(pal)
    // StatusBar blend
    try {
      StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content')
      if (Platform.OS === 'android') {
        // Use edge-to-edge behavior with surface inset and only set button style
        NavigationBar.setBehaviorAsync('inset-surface' as any).catch(() => {})
        NavigationBar.setButtonStyleAsync(isDark ? 'light' : 'dark').catch(() => {})
        // Match nav bar background to theme to avoid inversion
        NavigationBar.setBackgroundColorAsync(AdminColors.bg as any).catch(() => {})
      }
    } catch {}
  }, [isDark, accentOverride])

  // Ready immediately; force 'auto'
  useEffect(() => { setReady(true) }, [])

  // Persist 'auto' only (no-op for external changes)
  useEffect(() => {
    (async () => { try { await AsyncStorage.setItem(STORAGE_KEY, 'auto') } catch {} })()
  }, [setting])

  // Per-branch accent override (best-effort)
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id || null
        if (!uid) { setAccentOverride(null); return }
        const { data: profile } = await supabase.from('profiles').select('branch_id').eq('id', uid).maybeSingle()
        const bid = (profile as any)?.branch_id || null
        if (!bid) { setAccentOverride(null); return }
        const { data: branch } = await supabase.from('branches').select('settings').eq('id', bid).maybeSingle()
        const settings: any = (branch as any)?.settings || {}
        const hex: string | null = settings.theme_accent || settings.accent || settings.accent_hex || null
        setAccentOverride(typeof hex === 'string' && /^#?[0-9a-fA-F]{6}$/.test(hex) ? (hex.startsWith('#') ? hex : `#${hex}`) : null)
      } catch { setAccentOverride(null) }
    })()
  }, [])

  // React to system changes: update internal state so isDark recomputes and palettes apply via the main effect
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemIsDark(colorScheme === 'dark')
    })
    return () => sub.remove()
  }, [])

  const setSetting: AppThemeContext['setSetting'] = () => { _setSetting('auto') }
  const value = useMemo(() => ({ setting: 'auto' as ThemeSetting, isDark, systemIsDark, setSetting }), [isDark, systemIsDark])
  if (!ready) return null
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppTheme must be used within ThemeProvider')
  return ctx
}
