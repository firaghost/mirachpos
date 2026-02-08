import { createClient } from '@supabase/supabase-js'
// Lazy-load AsyncStorage to avoid hard crash if not installed yet
let AsyncStorage: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AsyncStorage = require('@react-native-async-storage/async-storage').default
} catch {}

let supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim()
if (supabaseUrl) {
  supabaseUrl = supabaseUrl.replace(/\/+$/,'')
  // Strip accidental API path segments like /auth/v1, /rest/v1, /functions/v1
  supabaseUrl = supabaseUrl.replace(/\/(auth|rest|functions)\/v1.*$/i, '')
  if (!/^https?:\/\//i.test(supabaseUrl)) {
    if (/\.supabase\.co$/i.test(supabaseUrl)) {
      supabaseUrl = `https://${supabaseUrl}`
    } else if (/^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/i.test(supabaseUrl)) {
      supabaseUrl = `http://${supabaseUrl}`
    } else {
      supabaseUrl = `https://${supabaseUrl}`
    }
  }
  if (supabaseUrl.endsWith('/')) supabaseUrl = supabaseUrl.replace(/\/+$/,'')
}
if (!supabaseUrl) supabaseUrl = 'https://osbjpqhzcthwytlvvqfi.supabase.co'

const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim() ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zYmpwcWh6Y3Rod3l0bHZ2cWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5NzcwMDAsImV4cCI6MjA3OTU1MzAwMH0.1Oj-j4Rf2ASD5FSzYvXm8Lf4SqtHpJUtT_eR9BJaEQc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'cafev-mobile-auth',
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // Use AsyncStorage when available so login survives offline restarts
    storage: AsyncStorage ?? undefined,
  },
})

export const SUPABASE_URL = supabaseUrl

export async function authHealthcheck(): Promise<boolean> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { method: 'GET' })
    const ct = res.headers.get('content-type') || ''
    if (!res.ok) return false
    if (!/application\/json/i.test(ct)) return false
    return true
  } catch {
    return false
  }
}
