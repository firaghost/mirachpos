import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api';
import { PortalMenu, type PortalMenuAnchorRect } from '../../components/PortalMenu';
import { OwnerPageHeader } from '../../components/OwnerPageHeader';

type ApiRole = { id: string; name: string; scope: 'global' | 'branch'; permissions: string[] };
type ApiBranch = { id: string; name: string; status: string };

type ApiStaff = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  branchId: string;
  roleId: string;
  roleName: string;
  roleKind: 'super' | 'manager' | 'barista' | 'server' | 'kitchen' | 'other';
  status: 'Active' | 'On Leave' | 'Suspended';
  lastLoginAt: string;
  lastLoginLabel: string;
  createdAt: string;
};

type ApiResp = {
  staff: ApiStaff[];
  roles: ApiRole[];
  branches: ApiBranch[];
  stats: { superAdmins: number; managers: number; baristasServers: number; kitchen: number };
  page: number;
  pageSize: number;
  total: number;
  meta: { q: string; roleId: string; status: string; branchId: string; generatedAt: string };
};

type ActivityEvent = {
  id: string;
  type: string;
  branchId: string;
  at: string;
  payload: Record<string, unknown>;
};

type ActivityResp = { events: ActivityEvent[]; page: number; pageSize: number; total: number };

type ApiInvite = {
  id: string;
  code: string;
  roleName: string;
  branchId: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string;
  usedByEmail: string;
};

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

const fmtDateTime = (v: string) => {
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return '';
  }
};

const ModalSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}> = ({ value, onChange, options, placeholder }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<PortalMenuAnchorRect | null>(null);

  const label = options.find((o) => o.value === value)?.label || '';

  const toggle = (ev: React.MouseEvent) => {
    const next = !open;
    setOpen(next);
    if (!next) {
      setAnchorRect(null);
      return;
    }
    try {
      const r = (ev.currentTarget as any)?.getBoundingClientRect?.();
      if (r) {
        setAnchorRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      } else {
        setAnchorRect(null);
      }
    } catch {
      setAnchorRect(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="h-10 w-full rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm text-left text-[#221c10] dark:text-white focus:border-primary focus:outline-none flex items-center justify-between"
      >
        <span className={cx('truncate', label ? '' : 'text-[#897c61] dark:text-gray-500')}>{label || placeholder || 'Select ¦'}</span>
        <span className="material-symbols-outlined text-[18px] opacity-70">expand_more</span>
      </button>

      <PortalMenu
        open={open}
        anchorRect={anchorRect}
        onClose={() => {
          setOpen(false);
          setAnchorRect(null);
        }}
        width={Math.max(280, anchorRect?.width || 280)}
      >
        <div className="max-h-72 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[#c9b792]">No options</div>
          ) : (
            options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  setAnchorRect(null);
                }}
                className={cx(
                  'w-full px-4 py-3 text-left text-sm select-none',
                  o.value === value
                    ? 'bg-[#eead2b] text-[#181611] font-extrabold'
                    : 'text-white hover:bg-[#2c241b]',
                )}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      </PortalMenu>
    </div>
  );
};

const roleBadgeClass = (roleName: string, kind: ApiStaff['roleKind']) => {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border';
  switch (kind) {
    case 'super':
      return `${base} bg-white-50 text-white-700 border-white-100 dark:bg-white-900/30 dark:text-white-300 dark:border-white-800`;
    case 'manager':
      return `${base} bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800`;
    case 'kitchen':
      return `${base} bg-green-50 text-green-700 border-green-100 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800`;
    default:
      if (roleName.toLowerCase().includes('barista') || roleName.toLowerCase().includes('server') || roleName.toLowerCase().includes('wait')) {
        return `${base} bg-primary/10 text-primary border-primary/20`;
      }
      return `${base} bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700`;
  }
};

const statusBadgeClass = (status: ApiStaff['status']) => {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border';
  if (status === 'Active') return `${base} bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800`;
  if (status === 'On Leave') return `${base} bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700`;
  return `${base} bg-red-50 text-red-700 border-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800`;
};

const statCard = (label: string, value: number, icon: string, iconClass: string) => {
  return (
    <div className="bg-white dark:bg-[#2c241b] p-4 rounded-xl shadow-soft border border-[#e6e2db] dark:border-[#3d3429] flex items-center gap-4">
      <div className={cx('size-12 rounded-full flex items-center justify-center', iconClass)}>
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div>
        <p className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-black text-[#221c10] dark:text-white">{value}</p>
      </div>
    </div>
  );
};

const copyText = async (v: string) => {
  try {
    await navigator.clipboard.writeText(v);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = v;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
};

export const OwnerStaffManagement: React.FC = () => {
  const [tab, setTab] = useState<'staff' | 'roles' | 'invites' | 'activity'>('staff');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResp | null>(null);

  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesData, setRolesData] = useState<ApiRole[]>([]);

  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityResp | null>(null);
  const [activityQ, setActivityQ] = useState('');
  const [activityType, setActivityType] = useState('');
  const [activityPage, setActivityPage] = useState(1);

  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [invites, setInvites] = useState<ApiInvite[]>([]);

  const [inviteRoleName, setInviteRoleName] = useState<'Branch Manager' | 'Waiter'>('Branch Manager');
  const [inviteBranchId, setInviteBranchId] = useState<string>('');
  const [inviteExpiresDays, setInviteExpiresDays] = useState<number>(7);
  const [inviteCreating, setInviteCreating] = useState(false);

  const [q, setQ] = useState('');
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState<'' | 'Active' | 'On Leave' | 'Suspended'>('Active');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [banner, setBanner] = useState<null | { kind: 'success' | 'error'; message: string }>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPassword, setDraftPassword] = useState('');
  const [draftPin, setDraftPin] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftRoleId, setDraftRoleId] = useState('');
  const [draftBranchId, setDraftBranchId] = useState('');
  const [draftStatus, setDraftStatus] = useState<ApiStaff['status']>('Active');

  const [rowMenuStaffId, setRowMenuStaffId] = useState<string | null>(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<PortalMenuAnchorRect | null>(null);

  const [staffEditOpen, setStaffEditOpen] = useState(false);
  const [staffEditLoading, setStaffEditLoading] = useState(false);
  const [staffEditTarget, setStaffEditTarget] = useState<ApiStaff | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRoleId, setEditRoleId] = useState('');
  const [editBranchId, setEditBranchId] = useState('');
  const [editStatus, setEditStatus] = useState<ApiStaff['status']>('Active');
  const [editPin, setEditPin] = useState('');

  const [roleCreateOpen, setRoleCreateOpen] = useState(false);
  const [roleCreateLoading, setRoleCreateLoading] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleScope, setNewRoleScope] = useState<'global' | 'branch'>('branch');
  const [newRolePerms, setNewRolePerms] = useState('');

  const [roleRowMenuId, setRoleRowMenuId] = useState<string | null>(null);
  const [roleRowMenuAnchor, setRoleRowMenuAnchor] = useState<PortalMenuAnchorRect | null>(null);

  const [roleEditOpen, setRoleEditOpen] = useState(false);
  const [roleEditLoading, setRoleEditLoading] = useState(false);
  const [roleEditTarget, setRoleEditTarget] = useState<ApiRole | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleScope, setEditRoleScope] = useState<'global' | 'branch'>('branch');
  const [editRolePerms, setEditRolePerms] = useState('');

  const [roleDeleteOpen, setRoleDeleteOpen] = useState(false);
  const [roleDeleteLoading, setRoleDeleteLoading] = useState(false);
  const [roleDeleteTarget, setRoleDeleteTarget] = useState<ApiRole | null>(null);

  const roles = data?.roles || [];
  const branches = data?.branches || [];
  const effectiveRoles = roles.length ? roles : rolesData;

  const defaultRoleId = useMemo(() => {
    const waiter = effectiveRoles.find((r) => String(r.name || '').toLowerCase() === 'waiter');
    return waiter?.id || effectiveRoles[0]?.id || '';
  }, [effectiveRoles]);

  const defaultBranchId = useMemo(() => branches[0]?.id || '', [branches]);
  const staff = data?.staff || [];
  const stats = data?.stats || { superAdmins: 0, managers: 0, baristasServers: 0, kitchen: 0 };

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (roleId) params.set('roleId', roleId);
      if (status) params.set('status', status);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await apiFetch(`/api/owner/staff?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as ApiResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, q, roleId, status]);

  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);
    setRolesError(null);
    try {
      const res = await apiFetch('/api/owner/roles');
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { roles: ApiRole[] };
      setRolesData(Array.isArray(json.roles) ? json.roles : []);
    } catch (e) {
      setRolesError(e instanceof Error ? e.message : 'Failed to load roles');
      setRolesData([]);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError(null);
    try {
      const params = new URLSearchParams();
      if (activityQ.trim()) params.set('q', activityQ.trim());
      if (activityType) params.set('type', activityType);
      params.set('page', String(activityPage));
      params.set('pageSize', '10');
      const res = await apiFetch(`/api/owner/staff/activity?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      setActivity((await res.json()) as ActivityResp);
    } catch (e) {
      setActivityError(e instanceof Error ? e.message : 'Failed to load activity');
      setActivity(null);
    } finally {
      setActivityLoading(false);
    }
  }, [activityPage, activityQ, activityType]);

  const fetchInvites = useCallback(async () => {
    setInvitesLoading(true);
    setInvitesError(null);
    try {
      const res = await apiFetch('/api/owner/invites');
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json().catch(() => null)) as any;
      const rows = Array.isArray(json?.invites) ? (json.invites as ApiInvite[]) : [];
      setInvites(rows);
    } catch (e) {
      setInvitesError(e instanceof Error ? e.message : 'Failed to load invites');
      setInvites([]);
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  const refreshActive = useCallback(() => {
    if (tab === 'staff') {
      fetchStaff();
      return;
    }
    if (tab === 'roles') {
      fetchRoles();
      return;
    }
    if (tab === 'invites') {
      fetchInvites();
      return;
    }
    fetchActivity();
  }, [fetchActivity, fetchInvites, fetchRoles, fetchStaff, tab]);

  useEffect(() => {
    if (tab !== 'staff') return;
    fetchStaff();
  }, [fetchStaff, tab]);

  useEffect(() => {
    if (tab !== 'roles') return;
    fetchRoles();
  }, [fetchRoles, tab]);

  useEffect(() => {
    if (tab !== 'activity') return;
    fetchActivity();
  }, [fetchActivity, tab]);

  useEffect(() => {
    if (tab !== 'invites') return;
    fetchInvites();
  }, [fetchInvites, tab]);

  useEffect(() => {
    setPage(1);
  }, [q, roleId, status]);

  useEffect(() => {
    setActivityPage(1);
  }, [activityQ, activityType]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddOpen(false);
        setRowMenuStaffId(null);
        setRowMenuAnchor(null);
        setStaffEditOpen(false);
        setRoleCreateOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const showing = useMemo(() => {
    if (!total) return { start: 0, end: 0, total: 0 };
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(total, (page - 1) * pageSize + pageSize);
    return { start, end, total };
  }, [page, pageSize, total]);

  const openAdd = () => {
    setBanner(null);
    setAddOpen(true);
    setAddLoading(false);
    setDraftName('');
    setDraftCode('');
    setDraftEmail('');
    setDraftPassword('');
    setDraftPin('');
    setDraftPhone('');
    setDraftRoleId(defaultRoleId);
    setDraftBranchId(defaultBranchId);
    setDraftStatus('Active');
  };

  const closeAdd = () => {
    setAddOpen(false);
    setAddLoading(false);
  };

  const submitAdd = async () => {
    if (addLoading) return;
    const name = draftName.trim();
    if (!name) {
      setBanner({ kind: 'error', message: 'Name is required.' });
      return;
    }
    const roleName = (roles.find((r) => r.id === draftRoleId)?.name || '').toLowerCase();
    const isWaiter = roleName === 'waiter';
    const email = draftEmail.trim();
    if (!isWaiter && !email) {
      setBanner({ kind: 'error', message: 'Email is required for login.' });
      return;
    }
    setAddLoading(true);
    setBanner(null);
    try {
      const res = await apiFetch('/api/owner/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: draftCode.trim(),
          email,
          password: draftPassword,
          pin: isWaiter ? draftPin : '',
          phone: draftPhone.trim(),
          roleId: draftRoleId,
          branchId: draftBranchId,
          status: draftStatus,
        }),
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(payload?.error || String(res.status));
      if (typeof payload?.code === 'string' && payload.code) {
        setDraftCode(payload.code);
      }
      closeAdd();
      const tp = typeof payload?.tempPassword === 'string' ? payload.tempPassword : '';
      const tpin = typeof payload?.tempPin === 'string' ? payload.tempPin : '';
      const msg = tp && tpin ? `Staff member added. Temp password: ${tp}. PIN: ${tpin}` : tp ? `Staff member added. Temp password: ${tp}` : tpin ? `Staff member added. PIN: ${tpin}` : 'Staff member added.';
      setBanner({ kind: 'success', message: msg });
      await fetchStaff();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to add staff.' });
      setAddLoading(false);
    }
  };

  const openEditStaff = (s: ApiStaff) => {
    setBanner(null);
    setStaffEditTarget(s);
    setEditName(s.name || '');
    setEditCode(s.code || '');
    setEditEmail(s.email || '');
    setEditPhone(s.phone || '');
    setEditRoleId(s.roleId || defaultRoleId);
    setEditBranchId(s.branchId || defaultBranchId);
    setEditStatus(s.status || 'Active');
    setEditPin('');
    setStaffEditLoading(false);
    setStaffEditOpen(true);
  };

  useEffect(() => {
    if (!addOpen) return;
    if (!draftRoleId && defaultRoleId) setDraftRoleId(defaultRoleId);
    if (!draftBranchId && defaultBranchId) setDraftBranchId(defaultBranchId);
  }, [addOpen, defaultBranchId, defaultRoleId, draftBranchId, draftRoleId]);

  useEffect(() => {
    if (!staffEditOpen) return;
    if (!editRoleId && defaultRoleId) setEditRoleId(defaultRoleId);
    if (!editBranchId && defaultBranchId) setEditBranchId(defaultBranchId);
  }, [defaultBranchId, defaultRoleId, editBranchId, editRoleId, staffEditOpen]);

  const closeEditStaff = () => {
    setStaffEditOpen(false);
    setStaffEditLoading(false);
    setStaffEditTarget(null);
  };

  const updateStaff = async (id: string, patch: Record<string, unknown>) => {
    const res = await apiFetch(`/api/owner/staff/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const payload = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new Error(payload?.error || String(res.status));
  };

  const submitEditStaff = async () => {
    if (staffEditLoading || !staffEditTarget) return;
    const name = editName.trim();
    if (!name) {
      setBanner({ kind: 'error', message: 'Name is required.' });
      return;
    }
    setStaffEditLoading(true);
    try {
      const roleName = (roles.find((r) => r.id === editRoleId)?.name || '').toLowerCase();
      const isWaiter = roleName === 'waiter';
      await updateStaff(staffEditTarget.id, {
        name,
        code: editCode.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
        roleId: editRoleId,
        branchId: editBranchId,
        status: editStatus,
        pin: isWaiter ? editPin : '',
      });
      closeEditStaff();
      setBanner({ kind: 'success', message: 'Staff updated.' });
      await fetchStaff();
      if (tab === 'activity') await fetchActivity();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update staff.' });
      setStaffEditLoading(false);
    }
  };

  const resetWaiterPin = async () => {
    if (staffEditLoading || !staffEditTarget) return;
    setStaffEditLoading(true);
    try {
      const res = await apiFetch(`/api/owner/staff/${encodeURIComponent(staffEditTarget.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetPin: true }),
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(payload?.error || String(res.status));
      const tpin = typeof payload?.tempPin === 'string' ? payload.tempPin : '';
      setStaffEditLoading(false);
      if (tpin) {
        await copyText(tpin);
        setBanner({ kind: 'success', message: `PIN reset and copied: ${tpin}` });
      } else {
        setBanner({ kind: 'success', message: 'PIN reset.' });
      }
      await fetchStaff();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to reset PIN.' });
      setStaffEditLoading(false);
    }
  };

  const openRoleCreate = () => {
    setBanner(null);
    setRoleCreateOpen(true);
    setRoleCreateLoading(false);
    setNewRoleName('');
    setNewRoleScope('branch');
    setNewRolePerms('orders.read\norders.write\n');
  };

  const closeRoleCreate = () => {
    setRoleCreateOpen(false);
    setRoleCreateLoading(false);
  };

  const openRoleEdit = (role: ApiRole) => {
    setBanner(null);
    setRoleEditTarget(role);
    setEditRoleName(role.name);
    setEditRoleScope(role.scope);
    setEditRolePerms((role.permissions || []).join('\n'));
    setRoleEditLoading(false);
    setRoleEditOpen(true);
  };

  const closeRoleEdit = () => {
    if (roleEditLoading) return;
    setRoleEditOpen(false);
    setRoleEditTarget(null);
  };

  const submitRoleEdit = async () => {
    if (roleEditLoading || !roleEditTarget) return;
    const name = editRoleName.trim();
    if (!name) {
      setBanner({ kind: 'error', message: 'Role name is required.' });
      return;
    }
    const permissions = editRolePerms
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);

    setRoleEditLoading(true);
    setBanner(null);
    try {
      const res = await apiFetch(`/api/owner/roles/${encodeURIComponent(roleEditTarget.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scope: editRoleScope, permissions }),
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(payload?.error || String(res.status));
      setRoleEditOpen(false);
      setRoleEditTarget(null);
      setBanner({ kind: 'success', message: 'Role updated.' });
      await fetchRoles();
      if (tab === 'activity') await fetchActivity();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update role.' });
    } finally {
      setRoleEditLoading(false);
    }
  };

  const openRoleDelete = (role: ApiRole) => {
    setBanner(null);
    setRoleDeleteTarget(role);
    setRoleDeleteLoading(false);
    setRoleDeleteOpen(true);
  };

  const closeRoleDelete = () => {
    if (roleDeleteLoading) return;
    setRoleDeleteOpen(false);
    setRoleDeleteTarget(null);
  };

  const confirmRoleDelete = async () => {
    if (roleDeleteLoading || !roleDeleteTarget) return;
    setRoleDeleteLoading(true);
    setBanner(null);
    try {
      const res = await apiFetch(`/api/owner/roles/${encodeURIComponent(roleDeleteTarget.id)}`, { method: 'DELETE' });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(payload?.error || String(res.status));
      closeRoleDelete();
      setBanner({ kind: 'success', message: 'Role deleted.' });
      await fetchRoles();
      if (tab === 'activity') await fetchActivity();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to delete role.' });
      setRoleDeleteLoading(false);
    }
  };

  const submitRoleCreate = async () => {
    if (roleCreateLoading) return;
    const name = newRoleName.trim();
    if (!name) {
      setBanner({ kind: 'error', message: 'Role name is required.' });
      return;
    }
    const permissions = newRolePerms
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);

    setRoleCreateLoading(true);
    try {
      const res = await apiFetch('/api/owner/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scope: newRoleScope, permissions }),
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(payload?.error || String(res.status));
      closeRoleCreate();
      setBanner({ kind: 'success', message: 'Role created.' });
      await fetchRoles();
      if (tab === 'activity') await fetchActivity();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to create role.' });
      setRoleCreateLoading(false);
    }
  };

  const activityTypes = useMemo(() => {
    const base = ['staff_created', 'staff_updated', 'role_created', 'role_updated', 'role_deleted'];
    return base;
  }, []);

  const inviteBranchOptions = useMemo(() => {
    const list = branches.slice();
    return list;
  }, [branches]);

  const submitInvite = useCallback(async () => {
    if (inviteCreating) return;
    setInviteCreating(true);
    setBanner(null);
    try {
      const days = Math.max(1, Math.min(14, Number(inviteExpiresDays || 7)));
      const res = await apiFetch('/api/owner/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleName: inviteRoleName, branchId: inviteBranchId || '', expiresInDays: days }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || String(res.status));
      const code = String(json?.invite?.code || '');
      if (code) {
        await copyText(code);
        setBanner({ kind: 'success', message: 'Invite created and copied.' });
      } else {
        setBanner({ kind: 'success', message: 'Invite created.' });
      }
      await fetchInvites();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to create invite.' });
    } finally {
      setInviteCreating(false);
    }
  }, [fetchInvites, inviteBranchId, inviteCreating, inviteExpiresDays, inviteRoleName]);

  const exportCsv = () => {
    const header = ['code', 'name', 'role', 'email', 'phone', 'status', 'lastLogin'];
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header.join(','),
      ...staff.map((s) => header.map((k) => esc(((s as any)[k] ?? (k === 'role' ? s.roleName : '')) || '')).join(',')),
    ].join('\n');
    const blob = new Blob([lines], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBanner({ kind: 'success', message: 'Export downloaded.' });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#f8f7f6] dark:bg-[#221c10] text-[#221c10] dark:text-[#f8f7f6]">
      <OwnerPageHeader
        title="Staff Management"
        rightSlot={
          <div className="flex items-center gap-3">
            <button
              onClick={openRoleCreate}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>shield_person</span>
              <span className="hidden sm:inline">Create Role</span>
            </button>
            <button
              onClick={exportCsv}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>download</span>
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={refreshActive}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={openAdd}
              className="flex items-center justify-center gap-2 h-10 px-4 bg-[#eead2b] text-[#181611] rounded-lg text-sm font-bold hover:bg-[#d99a20] transition-colors shadow-[0_0_15px_rgba(238,173,43,0.3)]"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
              <span className="hidden sm:inline">Add Staff</span>
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <main className="w-full max-w-[1440px] mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-sm font-medium mb-6">
            <span className="text-[#897c61] hover:text-primary transition-colors">Dashboard</span>
            <span className="text-[#897c61]/50">/</span>
            <span className="text-[#897c61] hover:text-primary transition-colors">Settings</span>
            <span className="text-[#897c61]/50">/</span>
            <span className="text-[#221c10] dark:text-white">Staff & Roles</span>
          </div>

          {banner ? (
            <div
              className={cx(
                'rounded-xl border p-4 flex items-center justify-between gap-4 mb-6',
                banner.kind === 'success'
                  ? 'border-emerald-500/20 bg-emerald-900/10 text-emerald-200'
                  : 'border-red-500/20 bg-red-900/10 text-red-200',
              )}
            >
              <div className="text-sm font-medium">{banner.message}</div>
              <button
                onClick={() => setBanner(null)}
                className="h-9 px-3 rounded-lg bg-white/10 border border-white/10 text-white hover:border-primary/50"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            {statCard('Super Admins', stats.superAdmins, 'admin_panel_settings', 'bg-white-50 text-white-600 dark:bg-white-900/30 dark:text-white-300')}
            {statCard('Managers', stats.managers, 'manage_accounts', 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300')}
            {statCard('Baristas/Servers', stats.baristasServers, 'coffee_maker', 'bg-primary/10 text-primary')}
            {statCard('Kitchen Staff', stats.kitchen, 'restaurant', 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300')}
          </div>

          <div className="bg-white dark:bg-[#2c241b] rounded-xl shadow-soft border border-[#e6e2db] dark:border-[#3d3429] overflow-hidden flex flex-col min-h-[600px]">
            <div className="flex border-b border-[#e6e2db] dark:border-[#3d3429] px-6">
              <button
                onClick={() => setTab('staff')}
                className={cx(
                  'relative flex items-center gap-2 px-4 py-4 border-b-[3px] font-bold text-sm',
                  tab === 'staff' ? 'text-primary border-primary' : 'text-[#5c554a] dark:text-gray-400 border-transparent hover:text-[#221c10] dark:hover:text-white',
                )}
              >
                <span className={cx('material-symbols-outlined text-[20px]', tab === 'staff' ? 'icon-filled' : '')}>group</span>
                Staff List
              </button>
              <button
                onClick={() => setTab('roles')}
                className={cx(
                  'relative flex items-center gap-2 px-4 py-4 border-b-[3px] font-medium text-sm transition-colors',
                  tab === 'roles' ? 'text-primary border-primary font-bold' : 'text-[#5c554a] dark:text-gray-400 border-transparent hover:text-[#221c10] dark:hover:text-white',
                )}
              >
                <span className="material-symbols-outlined text-[20px]">verified_user</span>
                Role Definitions
              </button>
              <button
                onClick={() => setTab('invites')}
                className={cx(
                  'relative flex items-center gap-2 px-4 py-4 border-b-[3px] font-medium text-sm transition-colors',
                  tab === 'invites' ? 'text-primary border-primary font-bold' : 'text-[#5c554a] dark:text-gray-400 border-transparent hover:text-[#221c10] dark:hover:text-white',
                )}
              >
                <span className="material-symbols-outlined text-[20px]">mail</span>
                Invites
              </button>
              <button
                onClick={() => setTab('activity')}
                className={cx(
                  'relative flex items-center gap-2 px-4 py-4 border-b-[3px] font-medium text-sm transition-colors',
                  tab === 'activity' ? 'text-primary border-primary font-bold' : 'text-[#5c554a] dark:text-gray-400 border-transparent hover:text-[#221c10] dark:hover:text-white',
                )}
              >
                <span className="material-symbols-outlined text-[20px]">history</span>
                Activity Log
              </button>
            </div>

            {tab === 'staff' ? (
              <>
                <div className="p-5 flex flex-wrap items-center justify-between gap-4 border-b border-[#f4f3f0] dark:border-[#3d3429]">
                  <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                    <div className="relative w-full max-w-md">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#897c61]">search</span>
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        className="w-full h-10 pl-10 pr-4 rounded-lg bg-[#f8f7f6] dark:bg-[#221c10] border border-transparent focus:bg-white dark:focus:bg-[#2c241b] focus:border-primary focus:ring-0 text-sm transition-all"
                        placeholder="Search by name, ID, or email..."
                        type="text"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={roleId}
                      onChange={(e) => setRoleId(e.target.value)}
                      className="h-10 bg-[#f8f7f6] dark:bg-[#221c10] rounded-lg border border-transparent hover:border-[#e6e2db] dark:hover:border-[#4a4238] cursor-pointer transition-all text-sm font-semibold text-[#221c10] dark:text-white px-3"
                    >
                      <option value="">Filter: All Roles</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as any)}
                      className="h-10 bg-[#f8f7f6] dark:bg-[#221c10] rounded-lg border border-transparent hover:border-[#e6e2db] dark:hover:border-[#4a4238] cursor-pointer transition-all text-sm font-semibold text-[#221c10] dark:text-white px-3"
                    >
                      <option value="Active">Status: Active</option>
                      <option value="">Status: All</option>
                      <option value="On Leave">Status: On Leave</option>
                      <option value="Suspended">Status: Suspended</option>
                    </select>
                    <button
                      onClick={exportCsv}
                      disabled={loading || !staff.length}
                      className="flex items-center gap-2 px-3 h-10 bg-[#f8f7f6] dark:bg-[#221c10] rounded-lg border border-transparent hover:border-[#e6e2db] dark:hover:border-[#4a4238] transition-all text-sm font-semibold text-[#221c10] dark:text-white disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[#897c61] text-[20px]">download</span>
                      Export
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="p-6 text-sm text-red-500 flex items-center justify-between">
                    <div>Failed to load staff: {error}</div>
                    <button
                      onClick={fetchStaff}
                      className="h-10 px-4 rounded-lg bg-primary hover:bg-[#d49a26] text-white font-bold"
                    >
                      Retry
                    </button>
                  </div>
                ) : null}

                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#fcfbf9] dark:bg-[#251f15] border-b border-[#e6e2db] dark:border-[#3d3429]">
                      <tr>
                        <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Employee</th>
                        <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Role</th>
                        <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Contact Info</th>
                        <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Status</th>
                        <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Last Login</th>
                        <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f4f3f0] dark:divide-[#3d3429]">
                      {loading ? (
                        <tr>
                          <td colSpan={6} className="py-10 px-6 text-sm text-[#5c554a] dark:text-gray-400">
                            Loading ¦
                          </td>
                        </tr>
                      ) : staff.length ? (
                        staff.map((s) => (
                          <tr key={s.id} className="group hover:bg-[#fcfbf9] dark:hover:bg-[#332b22] transition-colors">
                            <td className="py-4 px-6">
                              <div>
                                <p className="text-sm font-bold text-[#221c10] dark:text-white">{s.name}</p>
                                <p className="text-xs text-[#897c61]">ID: #{s.code}</p>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <span className={roleBadgeClass(s.roleName, s.roleKind)}>
                                <span className="material-symbols-outlined text-[14px]">
                                  {s.roleKind === 'super'
                                    ? 'admin_panel_settings'
                                    : s.roleKind === 'manager'
                                      ? 'manage_accounts'
                                      : s.roleKind === 'kitchen'
                                        ? 'restaurant'
                                        : s.roleName.toLowerCase().includes('server')
                                          ? 'room_service'
                                          : 'coffee_maker'}
                                </span>
                                {s.roleName}
                              </span>
                            </td>
                            <td className="py-4 px-6">
                              <p className="text-sm text-[#221c10] dark:text-gray-200">{s.email || ' ”'}</p>
                              <p className="text-xs text-[#897c61]">{s.phone || ' ”'}</p>
                            </td>
                            <td className="py-4 px-6">
                              <span className={statusBadgeClass(s.status)}>
                                <span
                                  className={cx(
                                    'w-1.5 h-1.5 rounded-full',
                                    s.status === 'Active' ? 'bg-emerald-500' : s.status === 'On Leave' ? 'bg-gray-400' : 'bg-red-500',
                                  )}
                                ></span>
                                {s.status}
                              </span>
                            </td>
                            <td className="py-4 px-6">
                              <p className="text-sm text-[#5c554a] dark:text-gray-400">{s.lastLoginLabel || ' ”'}</p>
                            </td>
                            <td className="py-4 px-6 text-right relative">
                              <button
                                onMouseDown={(ev) => {
                                  ev.stopPropagation();
                                }}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  let rect: any = null;
                                  try {
                                    rect = (ev.currentTarget as any)?.getBoundingClientRect?.() || null;
                                  } catch {
                                    rect = null;
                                  }
                                  setRowMenuStaffId((prev) => {
                                    const next = prev === s.id ? null : s.id;
                                    if (!next) {
                                      setRowMenuAnchor(null);
                                      return null;
                                    }
                                    if (rect) {
                                      setRowMenuAnchor({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
                                    } else {
                                      setRowMenuAnchor(null);
                                    }
                                    return next;
                                  });
                                }}
                                className="text-[#897c61] hover:text-primary transition-colors p-1"
                              >
                                <span className="material-symbols-outlined">more_vert</span>
                              </button>
                              <PortalMenu
                                open={rowMenuStaffId === s.id}
                                anchorRect={rowMenuStaffId === s.id ? rowMenuAnchor : null}
                                onClose={() => {
                                  setRowMenuStaffId(null);
                                  setRowMenuAnchor(null);
                                }}
                                width={224}
                              >
                                <button
                                  onClick={async () => {
                                    const ok = await copyText(s.code || '');
                                    setBanner({ kind: ok ? 'success' : 'error', message: ok ? 'Staff code copied.' : 'Copy failed.' });
                                    setRowMenuStaffId(null);
                                    setRowMenuAnchor(null);
                                  }}
                                  disabled={!s.code}
                                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b] disabled:opacity-50"
                                  type="button"
                                >
                                  Copy Staff Code
                                </button>
                                <button
                                  onClick={async () => {
                                    const ok = await copyText(s.email || '');
                                    setBanner({ kind: ok ? 'success' : 'error', message: ok ? 'Email copied.' : 'Copy failed.' });
                                    setRowMenuStaffId(null);
                                    setRowMenuAnchor(null);
                                  }}
                                  disabled={!s.email}
                                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b] disabled:opacity-50"
                                  type="button"
                                >
                                  Copy Email
                                </button>
                                <button
                                  onClick={async () => {
                                    const ok = await copyText(s.phone || '');
                                    setBanner({ kind: ok ? 'success' : 'error', message: ok ? 'Phone copied.' : 'Copy failed.' });
                                    setRowMenuStaffId(null);
                                    setRowMenuAnchor(null);
                                  }}
                                  disabled={!s.phone}
                                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b] disabled:opacity-50"
                                  type="button"
                                >
                                  Copy Phone
                                </button>
                                <button
                                  onClick={() => {
                                    openEditStaff(s);
                                    setRowMenuStaffId(null);
                                    setRowMenuAnchor(null);
                                  }}
                                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b]"
                                  type="button"
                                >
                                  Manage
                                </button>

                                {(s.roleName || '').toLowerCase() === 'waiter' ? (
                                  <button
                                    onClick={async () => {
                                      try {
                                        const res = await apiFetch(`/api/owner/staff/${encodeURIComponent(s.id)}`, {
                                          method: 'PUT',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ resetPin: true }),
                                        });
                                        const payload = (await res.json().catch(() => null)) as any;
                                        if (!res.ok) throw new Error(payload?.error || String(res.status));
                                        const tpin = typeof payload?.tempPin === 'string' ? payload.tempPin : '';
                                        if (tpin) {
                                          await copyText(tpin);
                                          setBanner({ kind: 'success', message: `PIN reset and copied: ${tpin}` });
                                        } else {
                                          setBanner({ kind: 'success', message: 'PIN reset.' });
                                        }
                                        setRowMenuStaffId(null);
                                        setRowMenuAnchor(null);
                                        await fetchStaff();
                                      } catch (e) {
                                        setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to reset PIN.' });
                                      }
                                    }}
                                    className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b]"
                                    type="button"
                                  >
                                    Reset PIN
                                  </button>
                                ) : null}
                                <div className="h-px bg-[#675532]/40" />
                                <button
                                  onClick={async () => {
                                    try {
                                      await updateStaff(s.id, { status: 'Active' });
                                      setBanner({ kind: 'success', message: 'Status set to Active.' });
                                      setRowMenuStaffId(null);
                                      setRowMenuAnchor(null);
                                      await fetchStaff();
                                    } catch (e) {
                                      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update status.' });
                                    }
                                  }}
                                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b]"
                                  type="button"
                                >
                                  Set Active
                                </button>
                                <button
                                  onClick={async () => {
                                    try {
                                      await updateStaff(s.id, { status: 'On Leave' });
                                      setBanner({ kind: 'success', message: 'Status set to On Leave.' });
                                      setRowMenuStaffId(null);
                                      setRowMenuAnchor(null);
                                      await fetchStaff();
                                    } catch (e) {
                                      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update status.' });
                                    }
                                  }}
                                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b]"
                                  type="button"
                                >
                                  Set On Leave
                                </button>
                                <button
                                  onClick={async () => {
                                    try {
                                      await updateStaff(s.id, { status: 'Suspended' });
                                      setBanner({ kind: 'success', message: 'Status set to Suspended.' });
                                      setRowMenuStaffId(null);
                                      setRowMenuAnchor(null);
                                      await fetchStaff();
                                    } catch (e) {
                                      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update status.' });
                                    }
                                  }}
                                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b]"
                                  type="button"
                                >
                                  Set Suspended
                                </button>
                              </PortalMenu>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="py-12 px-6 text-sm text-[#5c554a] dark:text-gray-400">
                            No staff found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="px-6 py-4 border-t border-[#e6e2db] dark:border-[#3d3429] flex items-center justify-between">
                  <p className="text-sm text-[#5c554a] dark:text-gray-400">
                    Showing <span className="font-bold text-[#221c10] dark:text-white">{showing.start}-{showing.end}</span> of{' '}
                    <span className="font-bold text-[#221c10] dark:text-white">{showing.total}</span> staff members
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1 || loading}
                      className="flex items-center justify-center size-9 rounded-lg border border-[#e6e2db] dark:border-[#4a4238] text-[#5c554a] hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429] hover:text-primary transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                    </button>
                    <button className="flex items-center justify-center size-9 rounded-lg bg-primary text-white font-bold shadow-sm">{page}</button>
                    <button
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      disabled={page >= pageCount || loading}
                      className="flex items-center justify-center size-9 rounded-lg border border-[#e6e2db] dark:border-[#4a4238] text-[#5c554a] hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429] hover:text-primary transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {tab === 'roles' ? (
                  <>
                    <div className="p-5 flex items-center justify-between gap-4 border-b border-[#f4f3f0] dark:border-[#3d3429]">
                      <div className="text-sm font-bold text-[#221c10] dark:text-white">Role Definitions</div>
                      <button
                        onClick={openRoleCreate}
                        className="flex items-center gap-2 px-3 h-10 bg-primary hover:bg-[#d49a26] text-white rounded-lg text-sm font-bold"
                      >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        New Role
                      </button>
                    </div>

                    {rolesError ? (
                      <div className="p-6 text-sm text-red-500 flex items-center justify-between">
                        <div>Failed to load roles: {rolesError}</div>
                        <button onClick={fetchRoles} className="h-10 px-4 rounded-lg bg-primary hover:bg-[#d49a26] text-white font-bold">
                          Retry
                        </button>
                      </div>
                    ) : null}

                    <div className="overflow-x-auto flex-1">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-[#fcfbf9] dark:bg-[#251f15] border-b border-[#e6e2db] dark:border-[#3d3429]">
                          <tr>
                            <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Role</th>
                            <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Scope</th>
                            <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Permissions</th>
                            <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f4f3f0] dark:divide-[#3d3429]">
                          {rolesLoading ? (
                            <tr>
                              <td colSpan={4} className="py-10 px-6 text-sm text-[#5c554a] dark:text-gray-400">
                                Loading ¦
                              </td>
                            </tr>
                          ) : rolesData.length ? (
                            rolesData.map((r) => (
                              <tr key={r.id} className="group hover:bg-[#fcfbf9] dark:hover:bg-[#332b22] transition-colors">
                                <td className="py-4 px-6">
                                  <div className="text-sm font-bold text-[#221c10] dark:text-white">{r.name}</div>
                                  <div className="text-xs text-[#897c61]">{r.id}</div>
                                </td>
                                <td className="py-4 px-6">
                                  <span className="text-sm text-[#5c554a] dark:text-gray-300">{r.scope}</span>
                                </td>
                                <td className="py-4 px-6">
                                  <div className="text-sm text-[#5c554a] dark:text-gray-300">
                                    {(r.permissions || []).slice(0, 5).join(', ') || ' ”'}
                                    {(r.permissions || []).length > 5 ? ' ¦' : ''}
                                  </div>
                                </td>
                                <td className="py-4 px-6 text-right">
                                  <button
                                    type="button"
                                    onMouseDown={(ev) => {
                                      ev.stopPropagation();
                                    }}
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      let rect: any = null;
                                      try {
                                        rect = (ev.currentTarget as any)?.getBoundingClientRect?.() || null;
                                      } catch {
                                        rect = null;
                                      }
                                      setRoleRowMenuId((prev) => {
                                        const next = prev === r.id ? null : r.id;
                                        if (!next) {
                                          setRoleRowMenuAnchor(null);
                                          return null;
                                        }
                                        if (rect) {
                                          setRoleRowMenuAnchor({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
                                        } else {
                                          setRoleRowMenuAnchor(null);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="text-[#897c61] hover:text-primary transition-colors p-1"
                                  >
                                    <span className="material-symbols-outlined">more_vert</span>
                                  </button>
                                  <PortalMenu
                                    open={roleRowMenuId === r.id}
                                    anchorRect={roleRowMenuId === r.id ? roleRowMenuAnchor : null}
                                    onClose={() => {
                                      setRoleRowMenuId(null);
                                      setRoleRowMenuAnchor(null);
                                    }}
                                    width={240}
                                  >
                                    <button
                                      type="button"
                                      className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b]"
                                      onClick={async () => {
                                        const permsText = Array.isArray(r.permissions) ? r.permissions.join('\n') : String((r as any)?.permissions || '');
                                        const ok = await copyText(permsText);
                                        setBanner({ kind: ok ? 'success' : 'error', message: ok ? 'Permissions copied.' : 'Copy failed.' });
                                        setRoleRowMenuId(null);
                                        setRoleRowMenuAnchor(null);
                                      }}
                                    >
                                      Copy Permissions
                                    </button>
                                    <button
                                      type="button"
                                      className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b]"
                                      onClick={() => {
                                        openRoleEdit(r);
                                        setRoleRowMenuId(null);
                                        setRoleRowMenuAnchor(null);
                                      }}
                                    >
                                      Edit Role
                                    </button>
                                    <div className="h-px bg-[#675532]/40" />
                                    <button
                                      type="button"
                                      className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b] text-red-300"
                                      onClick={() => {
                                        openRoleDelete(r);
                                        setRoleRowMenuId(null);
                                        setRoleRowMenuAnchor(null);
                                      }}
                                    >
                                      Delete Role
                                    </button>
                                  </PortalMenu>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="py-12 px-6 text-sm text-[#5c554a] dark:text-gray-400">
                                No roles found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : tab === 'invites' ? (
                  <>
                    <div className="p-5 flex flex-wrap items-center justify-between gap-4 border-b border-[#f4f3f0] dark:border-[#3d3429]">
                      <div>
                        <div className="text-sm font-bold text-[#221c10] dark:text-white">Invite Codes</div>
                        <div className="text-xs text-[#897c61] dark:text-gray-400 mt-1">Create one-time invite codes for Branch Managers and Waiters.</div>
                      </div>
                      <button
                        onClick={fetchInvites}
                        className="h-10 px-4 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-white dark:bg-[#221c10] text-sm font-bold hover:bg-[#f4f3f0] dark:hover:bg-[#2c241b] transition-colors flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[18px]">refresh</span>
                        Refresh
                      </button>
                    </div>

                    <div className="p-5 border-b border-[#f4f3f0] dark:border-[#3d3429]">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-bold uppercase tracking-wider text-[#897c61] dark:text-gray-400">Role</span>
                          <select
                            value={inviteRoleName}
                            onChange={(e) => setInviteRoleName((e.target.value as any) === 'Waiter' ? 'Waiter' : 'Branch Manager')}
                            className="h-11 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-white dark:bg-[#221c10] px-3 text-sm"
                          >
                            <option value="Branch Manager">Branch Manager</option>
                            <option value="Waiter">Waiter</option>
                          </select>
                        </label>

                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-bold uppercase tracking-wider text-[#897c61] dark:text-gray-400">Branch (optional)</span>
                          <select
                            value={inviteBranchId}
                            onChange={(e) => setInviteBranchId(e.target.value)}
                            className="h-11 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-white dark:bg-[#221c10] px-3 text-sm"
                          >
                            <option value="">Any</option>
                            {inviteBranchOptions.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-bold uppercase tracking-wider text-[#897c61] dark:text-gray-400">Expires (days)</span>
                          <input
                            value={String(inviteExpiresDays)}
                            onChange={(e) => setInviteExpiresDays(Number(e.target.value || 7))}
                            className="h-11 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-white dark:bg-[#221c10] px-3 text-sm"
                            type="number"
                            min={1}
                            max={14}
                          />
                        </label>

                        <div className="flex items-end">
                          <button
                            onClick={submitInvite}
                            disabled={inviteCreating}
                            className="w-full h-11 rounded-lg bg-primary text-white text-sm font-black hover:opacity-90 disabled:opacity-60 transition-opacity"
                          >
                            {inviteCreating ? 'Creating ¦' : 'Create Invite'}
                          </button>
                        </div>
                      </div>

                      {invitesError ? <div className="mt-3 text-sm text-red-600 dark:text-red-400">{invitesError}</div> : null}
                    </div>

                    <div className="p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-bold text-[#221c10] dark:text-white">Recent Invites</div>
                        <div className="text-xs text-[#897c61] dark:text-gray-400 font-mono">{invitesLoading ? 'Loading ¦' : `${invites.length} total`}</div>
                      </div>

                      <div className="overflow-x-auto rounded-xl border border-[#e6e2db] dark:border-[#3d3429]">
                        <table className="min-w-full text-left">
                          <thead className="bg-[#f4f3f0] dark:bg-[#221c10]">
                            <tr className="text-xs font-black uppercase tracking-wider text-[#897c61] dark:text-gray-400">
                              <th className="px-5 py-3">Code</th>
                              <th className="px-5 py-3">Role</th>
                              <th className="px-5 py-3">Branch</th>
                              <th className="px-5 py-3">Created</th>
                              <th className="px-5 py-3">Expires</th>
                              <th className="px-5 py-3">Used</th>
                              <th className="px-5 py-3"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e6e2db] dark:divide-[#3d3429] bg-white dark:bg-[#2c241b]">
                            {!invitesLoading && invites.length === 0 ? (
                              <tr>
                                <td className="px-5 py-4 text-sm text-[#897c61] dark:text-gray-400" colSpan={7}>
                                  No invites yet.
                                </td>
                              </tr>
                            ) : null}
                            {invites.map((i) => (
                              <tr key={i.id} className="hover:bg-[#f8f7f6] dark:hover:bg-[#221c10] transition-colors">
                                <td className="px-5 py-3 text-sm font-mono font-black text-[#221c10] dark:text-white">{i.code}</td>
                                <td className="px-5 py-3 text-sm text-[#221c10] dark:text-white">{i.roleName}</td>
                                <td className="px-5 py-3 text-sm text-[#5c554a] dark:text-gray-300">{i.branchId || 'Any'}</td>
                                <td className="px-5 py-3 text-sm text-[#5c554a] dark:text-gray-300">{i.createdAt ? fmtDateTime(i.createdAt) : ' ”'}</td>
                                <td className="px-5 py-3 text-sm text-[#5c554a] dark:text-gray-300">{i.expiresAt ? fmtDateTime(i.expiresAt) : ' ”'}</td>
                                <td className="px-5 py-3 text-sm text-[#5c554a] dark:text-gray-300">{i.usedAt ? `${fmtDateTime(i.usedAt)}${i.usedByEmail ? ` (${i.usedByEmail})` : ''}` : 'Not used'}</td>
                                <td className="px-5 py-3 text-sm">
                                  <button
                                    onClick={async () => {
                                      const ok = await copyText(i.code);
                                      setBanner({ kind: ok ? 'success' : 'error', message: ok ? 'Invite code copied.' : 'Failed to copy.' });
                                    }}
                                    className="h-9 px-3 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] text-xs font-black hover:bg-[#f4f3f0] dark:hover:bg-[#221c10] transition-colors"
                                  >
                                    Copy
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-5 flex items-center justify-between gap-4 border-b border-[#f4f3f0] dark:border-[#3d3429]">
                      <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                        <div className="relative w-full max-w-md">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#897c61]">search</span>
                          <input
                            value={activityQ}
                            onChange={(e) => setActivityQ(e.target.value)}
                            className="w-full h-10 pl-10 pr-4 rounded-lg bg-[#f8f7f6] dark:bg-[#221c10] border border-transparent focus:bg-white dark:focus:bg-[#2c241b] focus:border-primary focus:ring-0 text-sm transition-all"
                            placeholder="Search activity payload..."
                            type="text"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <select
                          value={activityType}
                          onChange={(e) => setActivityType(e.target.value)}
                          className="h-10 bg-[#f8f7f6] dark:bg-[#221c10] rounded-lg border border-transparent hover:border-[#e6e2db] dark:hover:border-[#4a4238] cursor-pointer transition-all text-sm font-semibold text-[#221c10] dark:text-white px-3"
                        >
                          <option value="">Type: All</option>
                          {activityTypes.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={fetchActivity}
                          className="flex items-center gap-2 px-3 h-10 bg-[#f8f7f6] dark:bg-[#221c10] rounded-lg border border-transparent hover:border-[#e6e2db] dark:hover:border-[#4a4238] transition-all text-sm font-semibold text-[#221c10] dark:text-white"
                        >
                          <span className="material-symbols-outlined text-[#897c61] text-[20px]">refresh</span>
                          Refresh
                        </button>
                      </div>
                    </div>

                    {activityError ? (
                      <div className="p-6 text-sm text-red-500 flex items-center justify-between">
                        <div>Failed to load activity: {activityError}</div>
                        <button onClick={fetchActivity} className="h-10 px-4 rounded-lg bg-primary hover:bg-[#d49a26] text-white font-bold">
                          Retry
                        </button>
                      </div>
                    ) : null}

                    <div className="overflow-x-auto flex-1">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-[#fcfbf9] dark:bg-[#251f15] border-b border-[#e6e2db] dark:border-[#3d3429]">
                          <tr>
                            <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">When</th>
                            <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Type</th>
                            <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Branch</th>
                            <th className="py-4 px-6 text-xs font-bold text-[#897c61] uppercase tracking-wider">Details</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f4f3f0] dark:divide-[#3d3429]">
                          {activityLoading ? (
                            <tr>
                              <td colSpan={4} className="py-10 px-6 text-sm text-[#5c554a] dark:text-gray-400">
                                Loading ¦
                              </td>
                            </tr>
                          ) : activity?.events?.length ? (
                            activity.events.map((e) => (
                              <tr key={e.id} className="group hover:bg-[#fcfbf9] dark:hover:bg-[#332b22] transition-colors">
                                <td className="py-4 px-6 text-sm text-[#5c554a] dark:text-gray-300">{e.at ? fmtDateTime(e.at) : ' ”'}</td>
                                <td className="py-4 px-6">
                                  <span className="text-sm font-bold text-[#221c10] dark:text-white">{e.type}</span>
                                </td>
                                <td className="py-4 px-6 text-sm text-[#5c554a] dark:text-gray-300">{e.branchId || ' ”'}</td>
                                <td className="py-4 px-6 text-sm text-[#5c554a] dark:text-gray-300">
                                  {Object.keys(e.payload || {}).length ? JSON.stringify(e.payload) : ' ”'}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="py-12 px-6 text-sm text-[#5c554a] dark:text-gray-400">
                                No activity found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="px-6 py-4 border-t border-[#e6e2db] dark:border-[#3d3429] flex items-center justify-between">
                      <p className="text-sm text-[#5c554a] dark:text-gray-400">
                        Showing{' '}
                        <span className="font-bold text-[#221c10] dark:text-white">
                          {activity?.total ? (activityPage - 1) * 10 + 1 : 0}-{activity?.total ? Math.min(activity.total, activityPage * 10) : 0}
                        </span>{' '}
                        of <span className="font-bold text-[#221c10] dark:text-white">{activity?.total ?? 0}</span> events
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                          disabled={activityPage <= 1 || activityLoading}
                          className="flex items-center justify-center size-9 rounded-lg border border-[#e6e2db] dark:border-[#4a4238] text-[#5c554a] hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429] hover:text-primary transition-colors disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                        </button>
                        <button className="flex items-center justify-center size-9 rounded-lg bg-primary text-white font-bold shadow-sm">{activityPage}</button>
                        <button
                          onClick={() => {
                            const max = Math.max(1, Math.ceil((activity?.total ?? 0) / 10));
                            setActivityPage((p) => Math.min(max, p + 1));
                          }}
                          disabled={activityLoading || activityPage >= Math.max(1, Math.ceil((activity?.total ?? 0) / 10))}
                          className="flex items-center justify-center size-9 rounded-lg border border-[#e6e2db] dark:border-[#4a4238] text-[#5c554a] hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429] hover:text-primary transition-colors disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </main>

        {addOpen ? (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeAdd();
            }}
          >
            <div className="w-full max-w-[560px] rounded-2xl border border-[#e6e2db] dark:border-[#3d3429] bg-white dark:bg-[#221c10] shadow-2xl relative overflow-visible isolate">
              <div className="flex items-start justify-between gap-4 border-b border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <div>
                  <div className="text-[#221c10] dark:text-white text-lg font-black">Add Staff</div>
                  <div className="text-[#897c61] dark:text-gray-400 text-sm mt-1">Create a staff account (name + role + contact).</div>
                </div>
                <button onClick={closeAdd} className="p-1.5 rounded-md hover:bg-[#f8f7f6] dark:hover:bg-[#2c241b] text-[#897c61] hover:text-[#221c10] dark:hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>

              <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4 relative overflow-visible">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Full Name</label>
                  <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" placeholder="Sarah Jenkins" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Employee Code</label>
                  <input value={draftCode} onChange={(e) => setDraftCode(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" placeholder="EMP-001" />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Email (required for login)</label>
                  <input value={draftEmail} onChange={(e) => setDraftEmail(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" placeholder="name@mirach.com" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Phone</label>
                  <input value={draftPhone} onChange={(e) => setDraftPhone(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" placeholder="+251 9xx xxx xxx" />
                </div>

                <div className="flex flex-col gap-2 md:col-span-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Password (optional)</label>
                  <input value={draftPassword} onChange={(e) => setDraftPassword(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" placeholder="Leave empty to auto-generate" />
                  <div className="text-[11px] text-[#897c61] dark:text-gray-400">If left empty, the system generates a temporary password and shows it after creation.</div>
                </div>

                {(roles.find((r) => r.id === draftRoleId)?.name || '').toLowerCase() === 'waiter' ? (
                  <div className="flex flex-col gap-2 md:col-span-2">
                    <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">PIN (optional)</label>
                    <input value={draftPin} onChange={(e) => setDraftPin(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" placeholder="Leave empty to auto-generate" />
                    <div className="text-[11px] text-[#897c61] dark:text-gray-400">If left empty, the system generates a PIN and shows it after creation.</div>
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 md:col-span-2 relative z-[10]">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Role</label>
                  <ModalSelect value={draftRoleId} onChange={setDraftRoleId} options={effectiveRoles.map((r) => ({ value: r.id, label: r.name }))} placeholder="Select role" />
                </div>
                <div className="flex flex-col gap-2 md:col-span-2 relative z-[10]">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Branch</label>
                  <ModalSelect value={draftBranchId} onChange={setDraftBranchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="Select branch" />
                </div>

                <div className="flex flex-col gap-2 md:col-span-2 mt-6 relative z-[0]">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Status</label>
                  <ModalSelect
                    value={draftStatus}
                    onChange={(v) => setDraftStatus(v as any)}
                    options={[
                      { value: 'Active', label: 'Active' },
                      { value: 'On Leave', label: 'On Leave' },
                      { value: 'Suspended', label: 'Suspended' },
                    ]}
                    placeholder="Select status"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <button onClick={closeAdd} className="h-10 px-4 rounded-lg bg-white dark:bg-[#2c241b] border border-[#e6e2db] dark:border-[#3d3429] text-[#221c10] dark:text-white hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429]" disabled={addLoading}>
                  Cancel
                </button>
                <button onClick={submitAdd} className="h-10 px-4 rounded-lg bg-primary hover:bg-[#d49a26] text-white font-bold disabled:opacity-60" disabled={addLoading}>
                  {addLoading ? 'Creating ¦' : 'Add Staff'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {staffEditOpen && staffEditTarget ? (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeEditStaff();
            }}
          >
            <div className="w-full max-w-[680px] rounded-2xl border border-[#e6e2db] dark:border-[#3d3429] bg-white dark:bg-[#221c10] shadow-2xl relative overflow-visible isolate">
              <div className="flex items-start justify-between gap-4 border-b border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <div>
                  <div className="text-[#221c10] dark:text-white text-lg font-black">Manage Staff</div>
                  <div className="text-[#897c61] dark:text-gray-400 text-sm mt-1">Update details, role, branch, or status.</div>
                </div>
                <button onClick={closeEditStaff} className="p-1.5 rounded-md hover:bg-[#f8f7f6] dark:hover:bg-[#2c241b] text-[#897c61] hover:text-[#221c10] dark:hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>

              <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Full Name</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Employee Code</label>
                  <input value={editCode} onChange={(e) => setEditCode(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Email</label>
                  <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Phone</label>
                  <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" />
                </div>

                <div className="flex flex-col gap-2 md:col-span-2 relative z-[10]">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Role</label>
                  <ModalSelect value={editRoleId} onChange={setEditRoleId} options={effectiveRoles.map((r) => ({ value: r.id, label: r.name }))} placeholder="Select role" />
                </div>
                <div className="flex flex-col gap-2 md:col-span-2 relative z-[10]">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Branch</label>
                  <ModalSelect value={editBranchId} onChange={setEditBranchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="Select branch" />
                </div>

                <div className="flex flex-col gap-2 md:col-span-2 mt-6 relative z-[0]">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Status</label>
                  <ModalSelect
                    value={editStatus}
                    onChange={(v) => setEditStatus(v as any)}
                    options={[
                      { value: 'Active', label: 'Active' },
                      { value: 'On Leave', label: 'On Leave' },
                      { value: 'Suspended', label: 'Suspended' },
                    ]}
                    placeholder="Select status"
                  />
                </div>

                {(roles.find((r) => r.id === editRoleId)?.name || '').toLowerCase() === 'waiter' ? (
                  <div className="flex flex-col gap-2 md:col-span-2">
                    <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Set New PIN (optional)</label>
                    <input value={editPin} onChange={(e) => setEditPin(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" placeholder="Enter to change PIN" />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={resetWaiterPin}
                        className="h-10 px-4 rounded-lg bg-white dark:bg-[#2c241b] border border-[#e6e2db] dark:border-[#3d3429] text-[#221c10] dark:text-white hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429] font-bold"
                        disabled={staffEditLoading}
                      >
                        Reset PIN
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <button
                  onClick={closeEditStaff}
                  className="h-10 px-4 rounded-lg bg-white dark:bg-[#2c241b] border border-[#e6e2db] dark:border-[#3d3429] text-[#221c10] dark:text-white hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429]"
                  disabled={staffEditLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={submitEditStaff}
                  className="h-10 px-4 rounded-lg bg-primary hover:bg-[#d49a26] text-white font-bold disabled:opacity-60"
                  disabled={staffEditLoading}
                >
                  {staffEditLoading ? 'Saving ¦' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {roleCreateOpen ? (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeRoleCreate();
            }}
          >
            <div className="w-full max-w-[640px] rounded-2xl border border-[#e6e2db] dark:border-[#3d3429] bg-white dark:bg-[#221c10] shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <div>
                  <div className="text-[#221c10] dark:text-white text-lg font-black">Create Role</div>
                  <div className="text-[#897c61] dark:text-gray-400 text-sm mt-1">Define a role and its permissions.</div>
                </div>
                <button onClick={closeRoleCreate} className="p-1.5 rounded-md hover:bg-[#f8f7f6] dark:hover:bg-[#2c241b] text-[#897c61] hover:text-[#221c10] dark:hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>

              <div className="px-5 py-4 grid grid-cols-1 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Role Name</label>
                  <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" placeholder="Supervisor" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Scope</label>
                  <select value={newRoleScope} onChange={(e) => setNewRoleScope(e.target.value as any)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none">
                    <option value="branch">branch</option>
                    <option value="global">global</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Permissions (one per line)</label>
                  <textarea
                    value={newRolePerms}
                    onChange={(e) => setNewRolePerms(e.target.value)}
                    className="min-h-32 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 py-2 text-sm focus:border-primary focus:outline-none"
                    placeholder="orders.read\norders.write\nstaff.read\nstaff.write"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <button
                  onClick={closeRoleCreate}
                  className="h-10 px-4 rounded-lg bg-white dark:bg-[#2c241b] border border-[#e6e2db] dark:border-[#3d3429] text-[#221c10] dark:text-white hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429]"
                  disabled={roleCreateLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={submitRoleCreate}
                  className="h-10 px-4 rounded-lg bg-primary hover:bg-[#d49a26] text-white font-bold disabled:opacity-60"
                  disabled={roleCreateLoading}
                >
                  {roleCreateLoading ? 'Creating ¦' : 'Create Role'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {roleEditOpen ? (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeRoleEdit();
            }}
          >
            <div className="w-full max-w-[640px] rounded-2xl border border-[#e6e2db] dark:border-[#3d3429] bg-white dark:bg-[#221c10] shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <div>
                  <div className="text-[#221c10] dark:text-white text-lg font-black">Edit Role</div>
                  <div className="text-[#897c61] dark:text-gray-400 text-sm mt-1">Update role name, scope and permissions.</div>
                </div>
                <button onClick={closeRoleEdit} className="p-1.5 rounded-md hover:bg-[#f8f7f6] dark:hover:bg-[#2c241b] text-[#897c61] hover:text-[#221c10] dark:hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>

              <div className="px-5 py-4 grid grid-cols-1 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Role Name</label>
                  <input value={editRoleName} onChange={(e) => setEditRoleName(e.target.value)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Scope</label>
                  <select value={editRoleScope} onChange={(e) => setEditRoleScope(e.target.value as any)} className="h-10 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 text-sm focus:border-primary focus:outline-none">
                    <option value="branch">branch</option>
                    <option value="global">global</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#897c61] dark:text-gray-400 uppercase tracking-wider">Permissions (one per line)</label>
                  <textarea
                    value={editRolePerms}
                    onChange={(e) => setEditRolePerms(e.target.value)}
                    className="min-h-32 rounded-lg border border-[#e6e2db] dark:border-[#3d3429] bg-[#f8f7f6] dark:bg-[#2c241b] px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <button
                  onClick={closeRoleEdit}
                  className="h-10 px-4 rounded-lg bg-white dark:bg-[#2c241b] border border-[#e6e2db] dark:border-[#3d3429] text-[#221c10] dark:text-white hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429]"
                  disabled={roleEditLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={submitRoleEdit}
                  className="h-10 px-4 rounded-lg bg-primary hover:bg-[#d49a26] text-white font-bold disabled:opacity-60"
                  disabled={roleEditLoading}
                >
                  {roleEditLoading ? 'Saving ¦' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {roleDeleteOpen ? (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeRoleDelete();
            }}
          >
            <div className="w-full max-w-[520px] rounded-2xl border border-[#e6e2db] dark:border-[#3d3429] bg-white dark:bg-[#221c10] shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <div>
                  <div className="text-[#221c10] dark:text-white text-lg font-black">Delete Role</div>
                  <div className="text-[#897c61] dark:text-gray-400 text-sm mt-1">This cannot be undone.</div>
                </div>
                <button onClick={closeRoleDelete} className="p-1.5 rounded-md hover:bg-[#f8f7f6] dark:hover:bg-[#2c241b] text-[#897c61] hover:text-[#221c10] dark:hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>

              <div className="px-5 py-4">
                <div className="text-sm text-[#221c10] dark:text-white">
                  Role: <span className="font-black">{roleDeleteTarget?.name || ' ”'}</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#e6e2db] dark:border-[#3d3429] px-5 py-4">
                <button
                  onClick={closeRoleDelete}
                  className="h-10 px-4 rounded-lg bg-white dark:bg-[#2c241b] border border-[#e6e2db] dark:border-[#3d3429] text-[#221c10] dark:text-white hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429]"
                  disabled={roleDeleteLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRoleDelete}
                  className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold disabled:opacity-60"
                  disabled={roleDeleteLoading}
                >
                  {roleDeleteLoading ? 'Deleting ¦' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
