import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'
import { Platform } from 'react-native'

const ANDROID_EMULATOR_HOST = '10.0.2.2'

const TENANT_KEY = 'mirach_tenant_slug'
const TOKEN_KEY = 'mirach_access_token'
const BRANCH_KEY = 'mirach_branch_id'
const ROLE_KEY = 'mirach_role'
const STAFF_ID_KEY = 'mirach_staff_id'
const TENANT_ID_KEY = 'mirach_tenant_id'

export type MirachMe = {
  tenantId: string
  branchId: string
  staffId: string
  role: string
  staffName: string
  permissions: string[]
}

export type MirachSession = {
  apiBaseUrl: string
  tenantSlug: string
  token: string
  tenantId: string
  branchId: string
  staffId: string
  role: string
}

export type PosTable = {
  id: string
  name: string
  status: string
  area: string | null
  seats: number
  openOrderId: string | null
  updatedAt: string | null
}

export type PosMenuProduct = {
  id: string
  name: string
  price: number
  category: string
  image: string
  updatedAt: string
}

export type BranchRow = {
  id: string
  name: string
}

export type PosOrderPayloadItem = {
  productId: string
  name: string
  qty: number
  unitPrice: number
}

export type PosOrderPayload = {
  tableId?: string
  tableName?: string
  items: Array<PosOrderPayloadItem>
  tipAmount?: number
  discountPct?: number
  paymentMethod?: string
  paymentReference?: string
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  const hostish = trimmed.replace(/^https?:\/\//i, '')
  const mapped =
    Platform.OS === 'android' && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostish)
      ? hostish.replace(/^(localhost|127\.0\.0\.1)/i, ANDROID_EMULATOR_HOST)
      : hostish

  if (/^https?:\/\//i.test(trimmed)) {
    const u = trimmed.replace(/^https?:\/\//i, '')
    const remapped =
      Platform.OS === 'android' && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)
        ? u.replace(/^(localhost|127\.0\.0\.1)/i, ANDROID_EMULATOR_HOST)
        : u
    return `${trimmed.toLowerCase().startsWith('https') ? 'https' : 'http'}://${remapped}`
  }
  if (/^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/i.test(mapped)) return `http://${mapped}`
  return `https://${mapped}`
}

export function getApiBaseUrl(): string {
  const fromEnv = String(process.env.EXPO_PUBLIC_API_BASE_URL || '').trim()
  const fromExtra = String((Constants?.expoConfig as any)?.extra?.apiBaseUrl || '').trim()
  return normalizeBaseUrl(fromEnv || fromExtra)
}

async function read(key: string): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(key)) || ''
  } catch {
    return ''
  }
}

async function write(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value)
  } catch {}
}

async function del(key: string) {
  try {
    await SecureStore.deleteItemAsync(key)
  } catch {}
}

export async function getStoredSession(): Promise<MirachSession | null> {
  const apiBaseUrl = getApiBaseUrl()
  const tenantSlug = await read(TENANT_KEY)
  const token = await read(TOKEN_KEY)
  const tenantId = await read(TENANT_ID_KEY)
  const branchId = await read(BRANCH_KEY)
  const staffId = await read(STAFF_ID_KEY)
  const role = await read(ROLE_KEY)

  if (!apiBaseUrl || !tenantSlug || !token || !tenantId || !staffId || !role) return null

  return {
    apiBaseUrl,
    tenantSlug,
    token,
    tenantId,
    branchId: branchId || 'global',
    staffId,
    role,
  }
}

function makeHeaders(params: { tenantSlug: string; token?: string }) {
  const h: Record<string, string> = {
    'X-Tenant': params.tenantSlug,
    Accept: 'application/json',
  }
  if (params.token) h.Authorization = `Bearer ${params.token}`
  return h
}

async function apiFetchJson<T>(params: { path: string; method?: string; body?: any; branchId?: string | null }): Promise<T> {
  const s = await getStoredSession()
  if (!s) throw new Error('unauthorized')

  const method = params.method || 'GET'
  const url = (() => {
    const base = `${s.apiBaseUrl}${params.path.startsWith('/') ? '' : '/'}${params.path}`
    const bid = String(params.branchId ?? '').trim()
    if (!bid) return base
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}branchId=${encodeURIComponent(bid)}`
  })()

  const res = await fetch(url, {
    method,
    headers: {
      ...makeHeaders({ tenantSlug: s.tenantSlug, token: s.token }),
      ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : null),
    } as any,
    body: method !== 'GET' && params.body != null ? JSON.stringify(params.body) : undefined,
  })

  const json = (await res.json().catch(() => null)) as any
  if (!res.ok) throw new Error(String(json?.error || 'request_failed'))
  return json as T
}

async function resolveEffectiveBranchId(preferred: string | null | undefined): Promise<string> {
  const s = await getStoredSession()
  if (!s) return ''

  const candidate = String(preferred ?? s.branchId ?? '').trim()
  if (candidate && candidate !== 'global') return candidate

  const json = await apiFetchJson<{ ok: boolean; branches: Array<{ id: string; name?: string }> }>({ path: '/api/branches' })
  const first = Array.isArray(json?.branches) ? json.branches[0] : null
  const id = first?.id ? String(first.id).trim() : ''
  if (id) {
    await write(BRANCH_KEY, id)
    return id
  }

  return ''
}

export async function fetchPosTables(params?: { branchId?: string | null }): Promise<PosTable[]> {
  const s = await getStoredSession()
  if (!s) return []
  const branchId = await resolveEffectiveBranchId(params?.branchId)
  if (!branchId) return []
  const json = await apiFetchJson<{ ok: boolean; tables: any[] }>({ path: '/api/pos/tables', branchId })
  const rows = Array.isArray(json?.tables) ? json.tables : []
  return rows
    .map((t: any) => ({
      id: String(t?.id || ''),
      name: String(t?.name || ''),
      status: String(t?.status || ''),
      area: t?.area == null ? null : String(t.area || ''),
      seats: Number(t?.seats || 0) || 0,
      openOrderId: t?.openOrderId ? String(t.openOrderId) : null,
      updatedAt: t?.updatedAt ? String(t.updatedAt) : null,
    }))
    .filter((t) => t.id && t.name)
}

export async function fetchPosMenuProducts(params?: { branchId?: string | null; limit?: number }): Promise<{ products: PosMenuProduct[]; categories: string[] }> {
  const s = await getStoredSession()
  if (!s) return { products: [], categories: [] }
  const branchId = await resolveEffectiveBranchId(params?.branchId)
  if (!branchId) return { products: [], categories: [] }
  const limit = Math.max(1, Math.min(500, Number(params?.limit || 500) || 500))
  const json = await apiFetchJson<{ ok: boolean; products: any[]; categories?: any[] }>({ path: `/api/pos/menu/products?limit=${limit}`, branchId })
  const rows = Array.isArray(json?.products) ? json.products : []
  const products = rows
    .map((p: any) => ({
      id: String(p?.id || ''),
      name: String(p?.name || ''),
      price: Number(p?.price ?? 0) || 0,
      category: String(p?.category || ''),
      image: String(p?.image || ''),
      updatedAt: String(p?.updatedAt || ''),
    }))
    .filter((p) => p.id && p.name)

  const categories = (() => {
    const c1 = Array.isArray(json?.categories) ? json.categories.map(String) : []
    if (c1.length > 0) return c1
    return Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  })()

  return { products, categories }
}

export async function createPosOrder(params: { branchId?: string | null; payload: PosOrderPayload; status?: string; tip?: number; discount?: number; discountPct?: number }) {
  const branchId = await resolveEffectiveBranchId(params.branchId)
  if (!branchId) throw new Error('branch_required')
  const status = String(params.status || 'Pending')
  const tip = Number(params.tip || 0) || 0
  const discount = Number(params.discount || 0) || 0
  const discountPct = params.discountPct != null ? Number(params.discountPct) : undefined
  return apiFetchJson<{ ok: boolean; id: string; createdAt: string }>({
    path: '/api/pos/orders',
    method: 'POST',
    branchId,
    body: { status, tip, discount, discountPct, payload: params.payload },
  })
}

export async function updatePosOrder(params: { orderId: string; branchId?: string | null; payload: PosOrderPayload; status?: string; tip?: number; discount?: number; discountPct?: number }) {
  const orderId = String(params.orderId || '').trim()
  if (!orderId) throw new Error('id_required')
  const branchId = await resolveEffectiveBranchId(params.branchId)
  if (!branchId) throw new Error('branch_required')
  const status = params.status != null ? String(params.status) : undefined
  const tip = params.tip != null ? Number(params.tip || 0) || 0 : undefined
  const discount = params.discount != null ? Number(params.discount || 0) || 0 : undefined
  const discountPct = params.discountPct != null ? Number(params.discountPct) : undefined

  const body: any = { payload: params.payload }
  if (status) body.status = status
  if (tip != null) body.tip = tip
  if (discount != null) body.discount = discount
  if (discountPct != null) body.discountPct = discountPct

  return apiFetchJson<{ ok: boolean }>({
    path: `/api/pos/orders/${encodeURIComponent(orderId)}`,
    method: 'PUT',
    branchId,
    body,
  })
}

export async function createPosTable(params: { name: string; area?: string | null; seats?: number; status?: string; branchId?: string | null }) {
  const branchId = await resolveEffectiveBranchId(params.branchId)
  if (!branchId) throw new Error('branch_required')
  const name = String(params.name || '').trim()
  if (!name) throw new Error('name_required')

  const body: any = { name }
  if (params.area != null) body.area = params.area
  if (params.seats != null) body.seats = params.seats
  if (params.status != null) body.status = params.status

  return apiFetchJson<{ ok: boolean; table?: any }>({
    path: '/api/pos/tables',
    method: 'POST',
    branchId,
    body,
  })
}

export async function updatePosTable(params: { tableId: string; patch: { status?: string; name?: string; area?: string | null; seats?: number }; branchId?: string | null }) {
  const branchId = await resolveEffectiveBranchId(params.branchId)
  if (!branchId) throw new Error('branch_required')
  const tableId = String(params.tableId || '').trim()
  if (!tableId) throw new Error('table_required')

  return apiFetchJson<{ ok: boolean; table?: any }>({
    path: `/api/pos/tables/${encodeURIComponent(tableId)}`,
    method: 'PUT',
    branchId,
    body: params.patch,
  })
}

export async function loginWithEmailPassword(params: { tenantSlug: string; email: string; password: string }) {
  const apiBaseUrl = getApiBaseUrl()
  if (!apiBaseUrl) return { ok: false as const, error: 'api_base_url_required' }

  const tenantSlug = String(params.tenantSlug || '').trim().toLowerCase()
  const email = String(params.email || '').trim().toLowerCase()
  const password = String(params.password || '')
  if (!tenantSlug || !email || !password) return { ok: false as const, error: 'invalid_credentials' }

  const res = await fetch(`${apiBaseUrl}/api/login`, {
    method: 'POST',
    headers: {
      ...makeHeaders({ tenantSlug }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  const json = (await res.json().catch(() => null)) as any
  if (!res.ok) return { ok: false as const, error: String(json?.error || 'login_failed') }

  const token = String(json?.token || '')
  const tenantId = String(json?.tenantId || json?.tenant?.id || '')
  const staffId = String(json?.staffId || '')
  const role = String(json?.role || '')
  const branchId = String(json?.branchId || 'global')

  if (!token || !tenantId || !staffId || !role) return { ok: false as const, error: 'login_failed' }

  await write(TENANT_KEY, tenantSlug)
  await write(TOKEN_KEY, token)
  await write(TENANT_ID_KEY, tenantId)
  await write(STAFF_ID_KEY, staffId)
  await write(ROLE_KEY, role)
  await write(BRANCH_KEY, branchId)

  return {
    ok: true as const,
    session: { apiBaseUrl, tenantSlug, token, tenantId, staffId, role, branchId },
    raw: json,
  }
}

export async function fetchMe(): Promise<{ ok: true; me: MirachMe } | { ok: false; error: string }> {
  const s = await getStoredSession()
  if (!s) return { ok: false, error: 'unauthorized' }

  const res = await fetch(`${s.apiBaseUrl}/api/me`, {
    method: 'GET',
    headers: makeHeaders({ tenantSlug: s.tenantSlug, token: s.token }),
  })

  const json = (await res.json().catch(() => null)) as any
  if (!res.ok) return { ok: false, error: String(json?.error || 'unauthorized') }

  const me = json?.me || {}
  return {
    ok: true,
    me: {
      tenantId: String(me?.tenantId || s.tenantId),
      branchId: String(me?.branchId || s.branchId || 'global'),
      staffId: String(me?.staffId || s.staffId),
      role: String(me?.role || s.role),
      staffName: String(me?.staffName || ''),
      permissions: Array.isArray(me?.permissions) ? me.permissions.map(String) : [],
    },
  }
}

export async function logout() {
  await del(TENANT_KEY)
  await del(TOKEN_KEY)
  await del(TENANT_ID_KEY)
  await del(BRANCH_KEY)
  await del(STAFF_ID_KEY)
  await del(ROLE_KEY)
}
