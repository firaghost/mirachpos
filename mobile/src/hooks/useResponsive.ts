import { useEffect, useMemo, useRef, useState } from 'react'
import { Dimensions, PixelRatio, Platform, ScaledSize } from 'react-native'
import type { Breakpoint } from '@/theme/responsive'
import { Breakpoints, ResponsiveByBp, Font, Icon } from '@/theme/responsive'

function getBp(width: number): Breakpoint {
  if (width >= Breakpoints.xl) return 'xl'
  if (width >= Breakpoints.lg) return 'lg'
  if (width >= Breakpoints.md) return 'md'
  if (width >= Breakpoints.sm) return 'sm'
  return 'xs'
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

export function useResponsive() {
  const get = () => Dimensions.get('window')
  const initial = get()
  const [dims, setDims] = useState<ScaledSize>({ ...initial })
  const timer = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      if (timer.current) clearTimeout(timer.current as any)
      timer.current = setTimeout(() => setDims(window), 50)
    })
    return () => { if ('remove' in sub) (sub as any).remove(); else (sub as any)() }
  }, [])

  const width = Math.min(dims.width, dims.height) // portrait width base
  const height = Math.max(dims.width, dims.height)
  const bp = getBp(width)
  const scale = ResponsiveByBp[bp]

  const isTablet = width >= 600 || (width >= Breakpoints.lg && height >= 900)
  const isLargeTablet = width >= Breakpoints.xl
  const isPhone = !isTablet

  const spacing = useMemo(() => ({
    xs: scale.baseSpacing,
    sm: scale.baseSpacing * 1.25,
    md: scale.baseSpacing * 1.5,
    lg: scale.baseSpacing * 2,
  }), [bp])

  const radius = useMemo(() => clamp(scale.baseRadius, 4, 20), [bp])

  const font = useMemo(() => {
    const base = Font[bp]
    const pr = PixelRatio.getFontScale()
    const adj = scale.fontScale * (Platform.OS === 'ios' ? 1 : 0.98)
    const f = (v: number) => clamp(v * adj * pr, 11, 40)
    return {
      h1: f(base.h1),
      h2: f(base.h2),
      h3: f(base.h3),
      body: f(base.body),
      small: f(base.small),
    }
  }, [bp])

  const icon = useMemo(() => {
    const base = Icon[bp]
    const f = (v: number) => clamp(v * scale.iconScale, 12, 48)
    return { sm: f(base.sm), md: f(base.md), lg: f(base.lg) }
  }, [bp])

  const gridColumns = useMemo(() => scale.gridColumns, [bp])
  const maxContentWidth = useMemo(() => scale.maxContentWidth, [bp])

  return {
    isPhone,
    isTablet,
    isLargeTablet,
    bp,
    radius,
    spacing,
    font,
    icon,
    gridColumns,
    maxContentWidth,
  }
}

export type UseResponsive = ReturnType<typeof useResponsive>
