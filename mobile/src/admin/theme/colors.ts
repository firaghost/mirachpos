export type Palette = {
  bg: string
  card: string
  surface: string
  text: string
  subtext: string
  accent: string
  accentMuted: string
  border: string
  success: string
  warning: string
  danger: string
}

export const DarkAdminPalette: Palette = {
  bg: '#14110F',            // Warm near-black (coffee tint)
  card: '#1E1A17',          // Deep brown surface (glass-like base)
  surface: '#171311',       // Primary UI surface
  text: '#F4F1EC',          // Soft warm white
  subtext: '#BEB6AD',       // Muted warm grey
  accent: '#C89B67',        // Caramel-gold signature
  accentMuted: '#AD8354',   // Muted caramel tone
  border: 'rgba(255,255,255,0.08)',
  success: '#22C3A6',       // Teal
  warning: '#E9A63A',       // Amber
  danger: '#E05656',        // Soft red
}


export const LightAdminPalette: Palette = {
  bg: '#F5F1EB',            // Soft warm neutral
  card: '#FFFFFF',          // White cards
  surface: '#EEE9E2',       // Warm light surface
  text: '#1F1B18',          // Warm black
  subtext: '#6F6862',       // Muted warm grey
  accent: '#C89B67',        // Caramel-gold
  accentMuted: '#AD8354',   // Muted caramel
  border: 'rgba(0,0,0,0.08)',
  success: '#18A889',
  warning: '#D79432',
  danger: '#D94A4A',
}


// Mutable color map used across the app; ThemeProvider will mutate this at runtime
export const AdminColors: Palette = { ...DarkAdminPalette }

export function applyAdminPalette(p: Palette) {
  Object.assign(AdminColors, p)
}
