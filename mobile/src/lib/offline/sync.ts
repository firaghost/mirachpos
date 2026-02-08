import { supabase } from '@/lib/supabase'
import { upsertNotification } from '@/lib/db'

export async function syncNotificationsForBranch(branchId: string) {
  try {
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, type, created_at, notification_audience!inner(branch_id)')
      .eq('notification_audience.branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(50)
    const rows = (data ?? []) as any[]
    for (const n of rows) {
      const item = {
        id: String(n.id),
        title: String(n.title || 'Notification'),
        body: String(n.body || ''),
        type: (n.type as string | null) ?? null,
        created_at: String(n.created_at || new Date().toISOString()),
      }
      try { await upsertNotification(item) } catch {}
    }
  } catch {}
}
