export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export const Breakpoints = {
  xs: 0,
  sm: 360,
  md: 390,
  lg: 450,
  xl: 768,
}

export type ResponsiveScale = {
  baseSpacing: number
  baseRadius: number
  fontScale: number
  iconScale: number
  gridColumns: number
  maxContentWidth: number
}

export const ResponsiveByBp: Record<Breakpoint, ResponsiveScale> = {
  xs: { baseSpacing: 6, baseRadius: 6, fontScale: 0.92, iconScale: 0.9, gridColumns: 1, maxContentWidth: 420 },
  sm: { baseSpacing: 8, baseRadius: 8, fontScale: 1.0, iconScale: 1.0, gridColumns: 1, maxContentWidth: 480 },
  md: { baseSpacing: 10, baseRadius: 10, fontScale: 1.05, iconScale: 1.05, gridColumns: 2, maxContentWidth: 560 },
  lg: { baseSpacing: 12, baseRadius: 12, fontScale: 1.12, iconScale: 1.12, gridColumns: 2, maxContentWidth: 900 },
  xl: { baseSpacing: 14, baseRadius: 14, fontScale: 1.2, iconScale: 1.2, gridColumns: 3, maxContentWidth: 1100 },
}

export const Font = {
  xs: { h1: 22, h2: 18, h3: 16, body: 14, small: 12 },
  sm: { h1: 24, h2: 20, h3: 17, body: 15, small: 12.5 },
  md: { h1: 26, h2: 22, h3: 18, body: 16, small: 13 },
  lg: { h1: 28, h2: 23, h3: 19, body: 17, small: 14 },
  xl: { h1: 30, h2: 24, h3: 20, body: 18, small: 15 },
} as const

export const Icon = {
  xs: { sm: 14, md: 18, lg: 22 },
  sm: { sm: 16, md: 20, lg: 24 },
  md: { sm: 18, md: 22, lg: 26 },
  lg: { sm: 20, md: 24, lg: 28 },
  xl: { sm: 22, md: 26, lg: 32 },
} as const
