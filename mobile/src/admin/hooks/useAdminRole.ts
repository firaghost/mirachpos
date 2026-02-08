import { useQuery } from '@tanstack/react-query'
import NetInfo from '@react-native-community/netinfo'
import { getLastProfile } from '@/lib/db'
import { fetchMe, getStoredSession } from '@/lib/mirachposSession'

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Role lookup timeout')), ms)
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

export type AdminRole = 'admin' | 'waiter' | 'unknown'

function mapRole(role: string): AdminRole {
  const r = String(role || '').toLowerCase().trim()
  if (!r) return 'unknown'
  if (['cafe owner', 'super_admin', 'admin', 'branch_admin', 'manager', 'branch_manager'].includes(r)) return 'admin'
  if (['waiter', 'cashier', 'waiter_manager', 'waiter manager'].includes(r)) return 'waiter'
  return 'waiter'
}

export function useAdminRole() {
  return useQuery({
    queryKey: ['admin_role'],
    queryFn: async (): Promise<AdminRole> => {
      // Fast fallback logic: if network is slow/flaky, rely on local DB immediately
      const fetchRole = async () => {
        const net = await NetInfo.fetch()
        try {
          const session = await withTimeout(getStoredSession(), 500)
          if (!session) {
            if (!net.isConnected) {
              const lp = await getLastProfile()
              return mapRole(String(lp?.role || ''))
            }
            return 'unknown'
          }

          if (!net.isConnected) {
            const lp = await getLastProfile()
            return mapRole(String(lp?.role || session.role || ''))
          }

          const meRes = await withTimeout(fetchMe(), 3000)
          if (!meRes.ok) return mapRole(session.role)
          return mapRole(meRes.me.role)

        } catch (e: any) {
          throw e // trigger fallback catch below
        }
      }

      try {
        return await fetchRole()
      } catch (e) {
        // Network or timeout failure: SAFE FALLBACK
        // We verified that LoginScreen updates `last_profile` on success,
        // so this local data is reliable for the logged-in user.
        const lp = await getLastProfile()
        return mapRole(String(lp?.role || ''))
      }
    },
    staleTime: 60_000, // Increased stale time to avoid varying role mid-session
    retry: 1,
  })
}
