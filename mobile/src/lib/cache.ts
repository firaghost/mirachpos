// Simple AsyncStorage-backed cache with in-memory fallback
let AsyncStorage: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AsyncStorage = require('@react-native-async-storage/async-storage').default
} catch {}

const Memory: Record<string, string> = {}

import { supabase } from '@/lib/supabase'

async function userScopedKey(base: string): Promise<string> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id || 'anon'
    return `${base}::${uid}`
  } catch {
    return `${base}::anon`
  }
}

async function getItem(key: string): Promise<string | null> {
  const realKey = await userScopedKey(key)
  try {
    if (AsyncStorage) return await AsyncStorage.getItem(realKey)
  } catch {}
  return Memory[realKey] ?? null
}

async function setItem(key: string, value: string): Promise<void> {
  const realKey = await userScopedKey(key)
  try {
    if (AsyncStorage) return await AsyncStorage.setItem(realKey, value)
  } catch {}
  Memory[realKey] = value
}

export async function cacheSet<T = any>(key: string, value: T) {
  try { await setItem(key, JSON.stringify(value)) } catch {}
}

export async function cacheGet<T = any>(key: string): Promise<T | null> {
  try {
    const raw = await getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const CacheKeys = {
  Menu: 'menu_cache_v1',
  VatRate: 'vat_cache_v1',
  Profile: 'profile_cache_v1',
  Tables: 'tables_cache_v1',
  PaymentsUnpaid: 'payments_unpaid_cache_v1',
  Orders: 'orders_cache_v1',
}
