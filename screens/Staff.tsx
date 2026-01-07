import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { Modal } from '../components/Modal';
import { apiFetch } from '../api';
import { readSession } from '../session';

type StaffMember = {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  status: 'Active' | 'On Leave';
  shift: string;
  avatar: string;
};

type ShiftLog = {
  id: string;
  staffId: string;
  clockInAt: string;
  clockOutAt?: string;
};

type RuntimeStatusByStaffId = Record<
  string,
  {
    breakUntil?: string;
    lateMinutes?: number;
  }
>;

type ScheduleRow = {
  staffId: string;
  mon: string;
  tue: string;
  wed: string;
  thu: string;
  fri: string;
  sat: string;
  sun: string;
};

type LeaveRequest = {
  id: string;
  staffId: string;
  from: string;
  fromTime: string;
  to: string;
  toTime: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
};

type Time12 = {
  hour: number;
  minute: number;
  meridiem: 'AM' | 'PM';
};

const STAFF_SHIFT_BY_ID_KEY = 'mirachpos.staff.shiftsById.v1';
const RUNTIME_STATUS_KEY = 'mirachpos.staff.runtime.v1';
const LEAVE_REQUESTS_KEY = 'mirachpos.staff.leave.v1';

const readLocal = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeLocal = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
};

const resolveBranchIdOverride = (): string => {
  const s = readSession<any>();
  const role = typeof s?.role === 'string' ? s.role : '';
  const branchId = typeof s?.branchId === 'string' ? s.branchId : '';
  if (branchId && branchId !== 'global') return '';
  if (role === 'Cafe Owner') {
    try {
      return localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '';
    } catch {
      return '';
    }
  }
  return '';
};

export const Staff: React.FC<{ initialView?: 'list' | 'schedule' }> = ({ initialView }) => {
  const [view, setView] = useState<'list' | 'schedule'>(() => (initialView === 'schedule' ? 'schedule' : 'list'));
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [leaveStaffId, setLeaveStaffId] = useState<string>('');
  const [leaveFromDate, setLeaveFromDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [leaveToDate, setLeaveToDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [leaveReason, setLeaveReason] = useState<string>('');
  const [leaveFromTime, setLeaveFromTime] = useState<Time12>({ hour: 9, minute: 0, meridiem: 'AM' });
  const [leaveToTime, setLeaveToTime] = useState<Time12>({ hour: 6, minute: 0, meridiem: 'PM' });
  const [shiftLogs, setShiftLogs] = useState<ShiftLog[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [paySlipId, setPaySlipId] = useState<string | null>(null);
  const [shiftHistoryId, setShiftHistoryId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [chipFilter, setChipFilter] = useState<'All' | 'OnShift' | 'Kitchen' | 'Service'>('All');
  const [actionsId, setActionsId] = useState<string | null>(null);

  const [runtimeStatusByStaffId, setRuntimeStatusByStaffId] = useState<RuntimeStatusByStaffId>(() => {
    const parsed = readLocal<RuntimeStatusByStaffId | null>(RUNTIME_STATUS_KEY, null);
    return parsed && typeof parsed === 'object' ? parsed : {};
  });

  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 5;

  const hoursOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const minuteOptions = [0, 15, 30, 45];

  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

  const weekStartOf = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const day = x.getDay();
    const diffToMon = (day + 6) % 7;
    x.setDate(x.getDate() - diffToMon);
    return x;
  };

  const addDays = (isoDate: string, days: number) => {
    const d = new Date(`${isoDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    return toIsoDate(d);
  };

  const [weekStart, setWeekStart] = useState<string>(() => toIsoDate(weekStartOf(new Date())));

  const [schedulesByWeek, setSchedulesByWeek] = useState<Record<string, ScheduleRow[]>>({});

  const [scheduleEditMode, setScheduleEditMode] = useState(false);
  const [editingCell, setEditingCell] = useState<{ staffId: string; day: keyof Omit<ScheduleRow, 'staffId'> } | null>(null);

  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);

  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(() => {
    const parsed = readLocal<any[] | null>(LEAVE_REQUESTS_KEY, null);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r) => {
        const id = typeof r?.id === 'string' ? r.id : `LVR-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const staffId = typeof r?.staffId === 'string' ? r.staffId : '';
        const from = typeof r?.from === 'string' ? r.from : new Date().toISOString().slice(0, 10);
        const to = typeof r?.to === 'string' ? r.to : from;
        const reason = typeof r?.reason === 'string' ? r.reason : 'Leave request';
        const status: LeaveRequest['status'] = r?.status === 'Approved' || r?.status === 'Rejected' ? r.status : 'Pending';
        const createdAt = typeof r?.createdAt === 'string' ? r.createdAt : new Date().toISOString();
        const fromTime = typeof r?.fromTime === 'string' ? r.fromTime : '9:00 AM';
        const toTime = typeof r?.toTime === 'string' ? r.toTime : '6:00 PM';
        return { id, staffId, from, fromTime, to, toTime, reason, status, createdAt };
      })
      .filter((r) => r.staffId);
  });

  const [draftName, setDraftName] = useState('');
  const [draftRole, setDraftRole] = useState('Waiter');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftShift, setDraftShift] = useState('08:00 - 16:00');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPassword, setDraftPassword] = useState('');

  const profile = useMemo(() => staff.find((s) => s.id === profileId) ?? null, [staff, profileId]);
  const paySlip = useMemo(() => staff.find((s) => s.id === paySlipId) ?? null, [staff, paySlipId]);
  const editing = useMemo(() => staff.find((s) => s.id === editId) ?? null, [staff, editId]);
  const shiftHistoryStaff = useMemo(() => staff.find((s) => s.id === shiftHistoryId) ?? null, [staff, shiftHistoryId]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(t);
  }, [flash]);

  const loadRemoteStaff = async () => {
    setLoadingRemote(true);
    try {
      try {
        const s = readSession<any>();
        const role = typeof s?.role === 'string' ? s.role : '';
        if (role !== 'Branch Manager' && role !== 'Cafe Owner') {
          setStaff([]);
          return;
        }
      } catch {
        setStaff([]);
        return;
      }

      const branchId = resolveBranchIdOverride();
      const qs = new URLSearchParams({ pageSize: '200' });
      if (branchId) qs.set('branchId', branchId);
      const res = await apiFetch(`/api/manager/staff?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      const shiftById = readLocal<Record<string, string> | null>(STAFF_SHIFT_BY_ID_KEY, null) || {};
      const rows = Array.isArray(json?.staff) ? (json.staff as any[]) : [];
      const next: StaffMember[] = rows
        .map((x) => {
          const id = String(x.id || '');
          const name = String(x.name || '');
          if (!id || !name) return null;
          const role = String(x.roleName || x.role_name || 'Staff');
          const phone = String(x.phone || '');
          const email = String(x.email || '');
          const statusRaw = String(x.status || 'Active');
          const status: StaffMember['status'] = statusRaw === 'On Leave' ? 'On Leave' : 'Active';
          const shift = typeof shiftById[id] === 'string' && shiftById[id] ? shiftById[id] : '08:00 - 16:00';
          const avatar = 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=100';
          return { id, name, role, phone: phone || ' ”', email, status, shift, avatar };
        })
        .filter(Boolean) as StaffMember[];
      setStaff(next);
    } catch (e) {
      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load staff.' });
      setStaff([]);
    } finally {
      setLoadingRemote(false);
    }
  };

  useEffect(() => {
    void loadRemoteStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeLocal(RUNTIME_STATUS_KEY, runtimeStatusByStaffId);
  }, [runtimeStatusByStaffId]);

  useEffect(() => {
    writeLocal(LEAVE_REQUESTS_KEY, leaveRequests);
  }, [leaveRequests]);

  const formatTime12 = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const loadShiftLogsRemote = async () => {
    try {
      const branchId = resolveBranchIdOverride();
      const qs = new URLSearchParams({ limit: '200' });
      if (branchId) qs.set('branchId', branchId);
      const res = await apiFetch(`/api/staff/shifts?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) return;
      const rows = Array.isArray(json?.shifts) ? (json.shifts as any[]) : [];
      const next: ShiftLog[] = rows
        .map((x) => {
          const id = String(x.id || '');
          const staffId = String(x.staffId || '');
          const clockInAt = typeof x.clockInAt === 'string' ? x.clockInAt : '';
          const clockOutAt = typeof x.clockOutAt === 'string' ? x.clockOutAt : undefined;
          if (!id || !staffId || !clockInAt) return null;
          return { id, staffId, clockInAt, clockOutAt };
        })
        .filter(Boolean) as ShiftLog[];
      setShiftLogs(next);
    } catch {
      // ignore
    }
  };

  const loadScheduleForWeek = async (ws: string) => {
    try {
      const branchId = resolveBranchIdOverride();
      const qs = new URLSearchParams({ weekStart: ws });
      if (branchId) qs.set('branchId', branchId);
      const res = await apiFetch(`/api/schedule?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) return;
      const rows = Array.isArray(json?.rows) ? (json.rows as any[]) : [];
      const next: ScheduleRow[] = rows
        .map((r) => ({
          staffId: String(r.staffId || ''),
          mon: String(r.mon || 'Off'),
          tue: String(r.tue || 'Off'),
          wed: String(r.wed || 'Off'),
          thu: String(r.thu || 'Off'),
          fri: String(r.fri || 'Off'),
          sat: String(r.sat || 'Off'),
          sun: String(r.sun || 'Off'),
        }))
        .filter((r) => r.staffId);
      setScheduleRows(next);
      setSchedulesByWeek((prev) => ({ ...prev, [ws]: next }));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadShiftLogsRemote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (schedulesByWeek[weekStart]) return;
    void loadScheduleForWeek(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  const formatDateTime12 = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const toMinutes12 = (t: Time12) => {
    const h = t.hour === 12 ? 0 : t.hour;
    const base = t.meridiem === 'PM' ? h + 12 : h;
    return base * 60 + t.minute;
  };

  const formatShift12 = (start: Time12, end: Time12) => {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return `${start.hour}:${pad2(start.minute)} ${start.meridiem} - ${end.hour}:${pad2(end.minute)} ${end.meridiem}`;
  };

  const timeToLabel = (t: Time12) => {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return `${t.hour}:${pad2(t.minute)} ${t.meridiem}`;
  };

  const parseShiftToParts = (raw: string): { off: boolean; start: Time12; end: Time12 } => {
    const s = String(raw ?? '').trim();
    if (!s || s.toLowerCase() === 'off') return { off: true, start: { hour: 9, minute: 0, meridiem: 'AM' }, end: { hour: 5, minute: 0, meridiem: 'PM' } };

    const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s);
    if (m12) {
      const start: Time12 = { hour: Number(m12[1]), minute: Number(m12[2]), meridiem: String(m12[3]).toUpperCase() as 'AM' | 'PM' };
      const end: Time12 = { hour: Number(m12[4]), minute: Number(m12[5]), meridiem: String(m12[6]).toUpperCase() as 'AM' | 'PM' };
      return { off: false, start, end };
    }

    const m24 = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(s);
    if (m24) {
      const to12 = (hh: number, mm: number): Time12 => {
        const meridiem: Time12['meridiem'] = hh >= 12 ? 'PM' : 'AM';
        const h12 = hh % 12 === 0 ? 12 : hh % 12;
        return { hour: h12, minute: mm, meridiem };
      };
      return {
        off: false,
        start: to12(Number(m24[1]), Number(m24[2])),
        end: to12(Number(m24[3]), Number(m24[4])),
      };
    }

    return { off: false, start: { hour: 9, minute: 0, meridiem: 'AM' }, end: { hour: 5, minute: 0, meridiem: 'PM' } };
  };

  const parseShiftToHours = (raw: string) => {
    const s = String(raw ?? '').trim();
    if (!s || s.toLowerCase() === 'off') return 0;

    const m24 = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(s);
    if (m24) {
      const sh = Number(m24[1]);
      const sm = Number(m24[2]);
      const eh = Number(m24[3]);
      const em = Number(m24[4]);
      if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return 0;
      let start = sh * 60 + sm;
      let end = eh * 60 + em;
      if (end < start) end += 24 * 60;
      return Math.max(0, (end - start) / 60);
    }

    const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s);
    if (m12) {
      const sh = Number(m12[1]);
      const sm = Number(m12[2]);
      const sam = String(m12[3]).toUpperCase() as 'AM' | 'PM';
      const eh = Number(m12[4]);
      const em = Number(m12[5]);
      const eam = String(m12[6]).toUpperCase() as 'AM' | 'PM';
      if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return 0;
      if (sh < 1 || sh > 12 || eh < 1 || eh > 12) return 0;
      const start = toMinutes12({ hour: sh, minute: sm, meridiem: sam });
      let end = toMinutes12({ hour: eh, minute: em, meridiem: eam });
      if (end < start) end += 24 * 60;
      return Math.max(0, (end - start) / 60);
    }

    return 0;
  };

  const roleGroup = (role: string): 'Kitchen' | 'Service' | 'Other' => {
    const r = role.toLowerCase();
    if (r.includes('chef') || r.includes('kitchen')) return 'Kitchen';
    if (r.includes('wait') || r.includes('server') || r.includes('cash') || r.includes('barista')) return 'Service';
    return 'Other';
  };

  const submitCustomLeave = () => {
    const staffId = leaveStaffId.trim();
    if (!staffId) return;
    if (!leaveFromDate || !leaveToDate) return;
    if (leaveToDate < leaveFromDate) return;

    const reason = leaveReason.trim() || 'Leave request';
    const fromTime = timeToLabel(leaveFromTime);
    const toTime = timeToLabel(leaveToTime);

    const req: LeaveRequest = {
      id: `LVR-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      staffId,
      from: leaveFromDate,
      fromTime,
      to: leaveToDate,
      toTime,
      reason,
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };
    setLeaveRequests((prev) => [req, ...prev]);
    setLeaveReason('');
  };

  const activeStaffCount = useMemo(() => staff.filter((s) => s.status === 'Active').length, [staff]);

  const hoursLast7DaysByStaffId = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const map = new Map<string, number>();
    for (const log of shiftLogs) {
      const end = log.clockOutAt ? new Date(log.clockOutAt).getTime() : null;
      const start = new Date(log.clockInAt).getTime();
      if (!end) continue;
      if (end < weekAgo) continue;
      const hours = Math.max(0, (end - start) / (1000 * 60 * 60));
      map.set(log.staffId, (map.get(log.staffId) ?? 0) + hours);
    }
    return map;
  }, [shiftLogs]);

  const shiftCountLast7DaysByStaffId = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const map = new Map<string, number>();
    for (const log of shiftLogs) {
      const end = log.clockOutAt ? new Date(log.clockOutAt).getTime() : null;
      const start = new Date(log.clockInAt).getTime();
      if (!end) continue;
      if (end < weekAgo) continue;
      if (start < weekAgo && end >= weekAgo) {
        map.set(log.staffId, (map.get(log.staffId) ?? 0) + 1);
        continue;
      }
      map.set(log.staffId, (map.get(log.staffId) ?? 0) + 1);
    }
    return map;
  }, [shiftLogs]);

  const activeShiftByStaffId = useMemo(() => {
    const map = new Map<string, ShiftLog>();
    for (const log of shiftLogs) {
      if (!log.clockOutAt) map.set(log.staffId, log);
    }
    return map;
  }, [shiftLogs]);

  const syncShift = async (action: 'clock_in' | 'clock_out', staffId: string) => {
    try {
      const branchId = resolveBranchIdOverride();
      const res = await apiFetch('/api/staff/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, staffId, branchId: branchId || undefined }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) return;
      const log = json?.log;
      if (!log || typeof log !== 'object') return;
      const id = typeof log.id === 'string' ? log.id : '';
      const clockInAt = typeof log.clockInAt === 'string' ? log.clockInAt : '';
      const clockOutAt = typeof log.clockOutAt === 'string' ? log.clockOutAt : undefined;
      const sid = typeof log.staffId === 'string' ? log.staffId : '';
      if (!id || !sid || !clockInAt) return;

      setShiftLogs((prev) => {
        if (action === 'clock_in') {
          const withoutOpen = prev.filter((x) => !(x.staffId === sid && !x.clockOutAt));
          return [{ id, staffId: sid, clockInAt }, ...withoutOpen];
        }
        return prev.map((x) => (x.staffId === sid && !x.clockOutAt ? { ...x, clockOutAt: clockOutAt || new Date().toISOString() } : x));
      });

      // Keep history consistent with server ordering.
      void loadShiftLogsRemote();
    } catch {
      // ignore
    }
  };

  const roles = useMemo(() => {
    const set = new Set<string>();
    for (const s of staff) set.add(s.role);
    return ['All', ...Array.from(set.values()).sort((a, b) => a.localeCompare(b))];
  }, [staff]);

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      const matchesQuery = !q ? true : s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.phone.toLowerCase().includes(q);
      const matchesRole = roleFilter === 'All' ? true : s.role === roleFilter;
      const matchesChip =
        chipFilter === 'All'
          ? true
          : chipFilter === 'OnShift'
            ? activeShiftByStaffId.has(s.id)
            : chipFilter === 'Kitchen'
              ? roleGroup(s.role) === 'Kitchen'
              : roleGroup(s.role) === 'Service';
      return matchesQuery && matchesRole && matchesChip;
    });
  }, [activeShiftByStaffId, chipFilter, query, roleFilter, staff]);

  useEffect(() => {
    setPageIndex(0);
  }, [query, roleFilter, chipFilter]);

  const pagedStaff = useMemo(() => {
    const start = pageIndex * pageSize;
    return filteredStaff.slice(start, start + pageSize);
  }, [filteredStaff, pageIndex]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(filteredStaff.length / pageSize)), [filteredStaff.length]);

  const showingRange = useMemo(() => {
    const total = filteredStaff.length;
    if (total === 0) return { start: 0, end: 0, total: 0 };
    const start = pageIndex * pageSize + 1;
    const end = Math.min(total, pageIndex * pageSize + pageSize);
    return { start, end, total };
  }, [filteredStaff.length, pageIndex]);

  const parseHours = (raw: string) => parseShiftToHours(raw);

  const currentWeekRows = useMemo(() => {
    const rows = schedulesByWeek[weekStart];
    return Array.isArray(rows) ? rows : scheduleRows;
  }, [scheduleRows, schedulesByWeek, weekStart]);

  const staffById = useMemo(() => {
    const m = new Map<string, StaffMember>();
    for (const s of staff) m.set(s.id, s);
    return m;
  }, [staff]);

  useEffect(() => {
    setSchedulesByWeek((prev) => {
      const cur = prev[weekStart] ?? currentWeekRows;
      const have = new Set((cur ?? []).map((r) => r.staffId));
      const missing = staff.filter((s) => !have.has(s.id));
      if (missing.length === 0) return prev;
      const merged = [...(cur ?? []), ...missing.map((s) => ({ staffId: s.id, mon: 'Off', tue: 'Off', wed: 'Off', thu: 'Off', fri: 'Off', sat: 'Off', sun: 'Off' }))];
      return { ...prev, [weekStart]: merged };
    });
  }, [currentWeekRows, staff, weekStart]);

  const plannedHoursThisWeekByStaffId = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of staff) {
      const sched = (currentWeekRows as any[]).find((r) => r && String(r.staffId || '') === s.id);
      if (!sched) {
        map.set(s.id, 0);
        continue;
      }
      const total = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].reduce((sum, k) => sum + parseHours(String(sched[k] ?? 'Off')), 0);
      map.set(s.id, total);
    }
    return map;
  }, [currentWeekRows, staff]);

  const pendingLeaveCount = useMemo(() => leaveRequests.filter((r) => r.status === 'Pending').length, [leaveRequests]);

  useEffect(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const approvedByStaff = new Map<string, LeaveRequest[]>();
    for (const r of leaveRequests) {
      if (r.status !== 'Approved') continue;
      const list = approvedByStaff.get(r.staffId) ?? [];
      list.push(r);
      approvedByStaff.set(r.staffId, list);
    }

    setStaff((prev) =>
      prev.map((s) => {
        const approved = approvedByStaff.get(s.id) ?? [];
        const onLeave = approved.some((r) => r.from <= today && today <= r.to);
        if (onLeave) {
          return s.status === 'On Leave' ? s : { ...s, status: 'On Leave' };
        }
        if (s.status === 'On Leave') {
          return { ...s, status: 'Active' };
        }
        return s;
      }),
    );
  }, [leaveRequests]);

  const createLeaveRequest = (staffId: string, days: number) => {
    const from = new Date();
    const to = new Date(Date.now() + (days - 1) * 24 * 60 * 60 * 1000);
    const req: LeaveRequest = {
      id: `LVR-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      staffId,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      fromTime: '9:00 AM',
      toTime: '6:00 PM',
      reason: 'Leave request',
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };
    setLeaveRequests((prev) => [req, ...prev]);
  };

  const setLeaveStatus = (requestId: string, status: LeaveRequest['status']) => {
    setLeaveRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status } : r)));
  };

  const persistScheduleWeek = async (ws: string, rows: ScheduleRow[]) => {
    try {
      const branchId = resolveBranchIdOverride();
      const payloadRows = rows.map((r) => ({
        staffId: r.staffId,
        mon: r.mon,
        tue: r.tue,
        wed: r.wed,
        thu: r.thu,
        fri: r.fri,
        sat: r.sat,
        sun: r.sun,
      }));

      await apiFetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart: ws, branchId: branchId || undefined, rows: payloadRows }),
      });
    } catch {
      // ignore
    }
  };

  const updateScheduleCell = (staffId: string, day: keyof Omit<ScheduleRow, 'staffId'>, value: string) => {
    setSchedulesByWeek((prev) => {
      const base = prev[weekStart] ?? currentWeekRows;
      const rows = Array.isArray(base) ? base : [];
      const idx = rows.findIndex((r) => r.staffId === staffId);
      if (idx < 0) {
        const nextRows = [{ staffId, mon: 'Off', tue: 'Off', wed: 'Off', thu: 'Off', fri: 'Off', sat: 'Off', sun: 'Off', [day]: value } as ScheduleRow, ...rows];
        void persistScheduleWeek(weekStart, nextRows);
        return { ...prev, [weekStart]: nextRows };
      }
      const nextRows = [...rows];
      nextRows[idx] = { ...nextRows[idx], [day]: value } as ScheduleRow;
      void persistScheduleWeek(weekStart, nextRows);
      return { ...prev, [weekStart]: nextRows };
    });
  };

  const cloneWeekToNext = () => {
    const nextWeek = addDays(weekStart, 7);
    setSchedulesByWeek((prev) => {
      const src = prev[weekStart] ?? currentWeekRows;
      const rows = Array.isArray(src) ? src : [];
      const cloned = rows.map((r) => ({ ...r }));
      void persistScheduleWeek(nextWeek, cloned);
      return { ...prev, [nextWeek]: cloned };
    });
    setWeekStart(nextWeek);
    setScheduleEditMode(false);
    setEditingCell(null);
  };

  const setBreak = (staffId: string, minutes: number) => {
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    setRuntimeStatusByStaffId((prev) => ({ ...prev, [staffId]: { ...(prev[staffId] ?? {}), breakUntil: until } }));
  };

  const clearBreak = (staffId: string) => {
    setRuntimeStatusByStaffId((prev) => ({ ...prev, [staffId]: { ...(prev[staffId] ?? {}), breakUntil: undefined } }));
  };

  const addLate = (staffId: string, minutes: number) => {
    setRuntimeStatusByStaffId((prev) => {
      const cur = prev[staffId] ?? {};
      return { ...prev, [staffId]: { ...cur, lateMinutes: Math.max(0, (cur.lateMinutes ?? 0) + minutes) } };
    });
  };

  const clearLate = (staffId: string) => {
    setRuntimeStatusByStaffId((prev) => ({ ...prev, [staffId]: { ...(prev[staffId] ?? {}), lateMinutes: 0 } }));
  };

  const exportCsv = () => {
    const rows = filteredStaff.map((s) => {
      const onShift = activeShiftByStaffId.has(s.id);
      const h7 = hoursLast7DaysByStaffId.get(s.id) ?? 0;
      return {
        id: s.id,
        name: s.name,
        role: s.role,
        phone: s.phone,
        status: onShift ? 'On Shift' : s.status,
        shift: s.shift,
        hours_last_7_days: h7.toFixed(2),
      };
    });

    const header = ['id', 'name', 'role', 'phone', 'status', 'shift', 'hours_last_7_days'];
    const esc = (v: string) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(','), ...rows.map((r) => header.map((k) => esc((r as any)[k])).join(','))].join('\n');

    const blob = new Blob([lines], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onShiftCount = useMemo(() => {
    let n = 0;
    for (const s of staff) {
      if (activeShiftByStaffId.has(s.id)) n += 1;
    }
    return n;
  }, [activeShiftByStaffId, staff]);

  const closeAdd = () => {
    setAddOpen(false);
    setEditId(null);
    setDraftName('');
    setDraftRole('Waiter');
    setDraftPhone('');
    setDraftShift('08:00 - 16:00');
    setDraftEmail('');
    setDraftPassword('');
  };

  const saveAdd = () => {
    const name = draftName.trim();
    const role = draftRole.trim();
    const phone = draftPhone.trim() || ' ”';
    const shift = draftShift.trim();
    const email = draftEmail.trim().toLowerCase();
    const password = draftPassword;
    if (!name || !role || !shift) return;

    try {
      const s = readSession<any>();
      const sessRole = typeof s?.role === 'string' ? s.role : '';
      if (sessRole !== 'Branch Manager' && sessRole !== 'Cafe Owner') {
        setFlash({ kind: 'error', message: 'forbidden' });
        return;
      }
    } catch {
      setFlash({ kind: 'error', message: 'forbidden' });
      return;
    }

    setBusy(true);
    void (async () => {
      try {
        const branchId = resolveBranchIdOverride();
        if (editId) {
          const res = await apiFetch(`/api/manager/staff/${encodeURIComponent(editId)}${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, roleName: role, phone: phone === ' ”' ? '' : phone, email, status: 'Active' }),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

          try {
            const prev = readLocal<Record<string, string> | null>(STAFF_SHIFT_BY_ID_KEY, null) || {};
            writeLocal(STAFF_SHIFT_BY_ID_KEY, { ...prev, [editId]: shift });
          } catch {
            // ignore
          }
        } else {
          if (!email) throw new Error('email_required');
          if (!password || password.length < 4) throw new Error('password_too_short');
          const res = await apiFetch(`/api/manager/staff${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, roleName: role, phone: phone === ' ”' ? '' : phone, email, password, status: 'Active' }),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

          const createdId = String(json?.staffId || '').trim();
          if (createdId) {
            try {
              const prev = readLocal<Record<string, string> | null>(STAFF_SHIFT_BY_ID_KEY, null) || {};
              writeLocal(STAFF_SHIFT_BY_ID_KEY, { ...prev, [createdId]: shift });
            } catch {
              // ignore
            }
          }
        }

        closeAdd();
        setFlash({ kind: 'success', message: editId ? 'Staff updated.' : 'Staff created.' });
        await loadRemoteStaff();
      } catch (e) {
        setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to save staff.' });
      } finally {
        setBusy(false);
      }
    })();
  };

  const openEdit = (id: string) => {
    const s = staff.find((x) => x.id === id);
    if (!s) return;
    setEditId(id);
    setDraftName(s.name);
    setDraftRole(s.role);
    setDraftPhone(s.phone === ' ”' ? '' : s.phone);
    setDraftShift(s.shift);
    setDraftEmail(s.email || '');
    setDraftPassword('');
    setAddOpen(true);
  };

  const clockIn = (staffId: string) => {
    if (activeShiftByStaffId.has(staffId)) return;
    const id = `SHF-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setShiftLogs((prev) => [{ id, staffId, clockInAt: new Date().toISOString() }, ...prev]);
    void syncShift('clock_in', staffId);
  };

  const clockOut = (staffId: string) => {
    const active = activeShiftByStaffId.get(staffId);
    if (!active) return;
    const now = new Date().toISOString();
    setShiftLogs((prev) => prev.map((l) => (l.id === active.id ? { ...l, clockOutAt: now } : l)));
    void syncShift('clock_out', staffId);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Staff & Shift Management" subtitle="Manage employees, roles and weekly schedules" />
      
      <div className="flex-1 overflow-y-auto p-6">

        {flash ? (
          <div
            className={`max-w-[1200px] mx-auto rounded-xl border px-4 py-3 text-sm font-bold mb-5 ${
              flash.kind === 'success'
                ? 'bg-emerald-900/10 border-emerald-800 text-emerald-200'
                : 'bg-red-900/10 border-red-800 text-red-200'
            }`}
          >
            {flash.message}
          </div>
        ) : null}

        {loadingRemote ? (
          <div className="max-w-[1200px] mx-auto rounded-xl border border-border bg-surface px-4 py-3 text-xs text-text-muted font-bold mb-5">
            Loading staff data ¦
          </div>
        ) : null}
        
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex gap-3">
              <button
                onClick={exportCsv}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-transparent hover:bg-surface-light text-white text-sm font-semibold transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">file_download</span>
                Export Report
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-background text-sm font-bold shadow-lg shadow-primary/20 transition-all"
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
                Add New Staff
              </button>
            </div>
          </div>

          {view === 'list' && pendingLeaveCount > 0 ? (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex flex-col">
                  <div className="text-white font-bold">Pending Leave Approvals</div>
                  <div className="text-text-muted text-xs">Approve or reject leave requests.</div>
                </div>
                <div className="text-xs text-text-muted">{pendingLeaveCount} pending</div>
              </div>
              <div className="divide-y divide-border">
                {leaveRequests
                  .filter((r) => r.status === 'Pending')
                  .slice(0, 5)
                  .map((r) => {
                    const s = staff.find((x) => x.id === r.staffId);
                    return (
                      <div key={r.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {s ? <img src={s.avatar} alt={s.name} className="w-10 h-10 rounded-full border border-border object-cover" /> : null}
                          <div className="flex flex-col">
                            <div className="text-white font-semibold">{s?.name ?? r.staffId}</div>
                            <div className="text-text-muted text-xs">
                              {r.from} {r.fromTime || '9:00 AM'} â†’ {r.to} {r.toTime || '6:00 PM'}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setLeaveStatus(r.id, 'Rejected')}
                            className="px-3 py-2 text-xs font-bold text-text-muted hover:text-white border border-border rounded hover:bg-surface-light transition-colors"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => setLeaveStatus(r.id, 'Approved')}
                            className="px-3 py-2 text-xs font-extrabold text-background bg-primary rounded hover:bg-primary-hover transition-colors"
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : null}

          {view === 'list' ? (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex flex-col">
                  <div className="text-white font-bold">New Leave Request</div>
                  <div className="text-text-muted text-xs">Create a leave request (date + time, 12-hour format).</div>
                </div>
              </div>
              <div className="p-4 grid grid-cols-1 lg:grid-cols-6 gap-3">
                <select
                  value={leaveStaffId}
                  onChange={(e) => setLeaveStaffId(e.target.value)}
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Select Staff</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.id})
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={leaveFromDate}
                  onChange={(e) => setLeaveFromDate(e.target.value)}
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                />

                <div className="flex gap-2">
                  <select
                    value={leaveFromTime.hour}
                    onChange={(e) => setLeaveFromTime((t) => ({ ...t, hour: Number(e.target.value) }))}
                    className="bg-background border border-border rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {hoursOptions.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <select
                    value={leaveFromTime.minute}
                    onChange={(e) => setLeaveFromTime((t) => ({ ...t, minute: Number(e.target.value) }))}
                    className="bg-background border border-border rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {minuteOptions.map((m) => (
                      <option key={m} value={m}>
                        {String(m).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={leaveFromTime.meridiem}
                    onChange={(e) => setLeaveFromTime((t) => ({ ...t, meridiem: e.target.value as 'AM' | 'PM' }))}
                    className="bg-background border border-border rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>

                <input
                  type="date"
                  value={leaveToDate}
                  onChange={(e) => setLeaveToDate(e.target.value)}
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                />

                <div className="flex gap-2">
                  <select
                    value={leaveToTime.hour}
                    onChange={(e) => setLeaveToTime((t) => ({ ...t, hour: Number(e.target.value) }))}
                    className="bg-background border border-border rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {hoursOptions.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <select
                    value={leaveToTime.minute}
                    onChange={(e) => setLeaveToTime((t) => ({ ...t, minute: Number(e.target.value) }))}
                    className="bg-background border border-border rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {minuteOptions.map((m) => (
                      <option key={m} value={m}>
                        {String(m).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={leaveToTime.meridiem}
                    onChange={(e) => setLeaveToTime((t) => ({ ...t, meridiem: e.target.value as 'AM' | 'PM' }))}
                    className="bg-background border border-border rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>

                <input
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  className="lg:col-span-5 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Reason (optional)"
                />
                <button
                  onClick={submitCustomLeave}
                  className="lg:col-span-1 px-3 py-2 text-xs font-extrabold text-background bg-primary rounded hover:bg-primary-hover transition-colors"
                >
                  Submit
                </button>
              </div>
              <div className="px-4 pb-4 text-xs text-text-muted">
                From: {leaveFromDate} {leaveFromTime.hour}:{String(leaveFromTime.minute).padStart(2, '0')} {leaveFromTime.meridiem}    To: {leaveToDate}{' '}
                {leaveToTime.hour}:{String(leaveToTime.minute).padStart(2, '0')} {leaveToTime.meridiem}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-6xl text-primary">badge</span>
              </div>
              <p className="text-text-muted text-sm font-medium uppercase tracking-wider">Active Staff</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-white">{activeStaffCount}</span>
                <span className="text-text-muted text-lg">/ {staff.length}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="flex items-center text-green-500 font-medium bg-green-500/10 px-1.5 py-0.5 rounded">
                  <span className="material-symbols-outlined text-[16px] mr-1">trending_flat</span>
                  Stable
                </span>
                <span className="text-text-muted">vs last week</span>
              </div>
            </div>

            <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-6xl text-white">calendar_clock</span>
              </div>
              <p className="text-text-muted text-sm font-medium uppercase tracking-wider">Pending Approvals</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-white">{pendingLeaveCount}</span>
                <span className="text-text-muted text-lg">requests</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="flex items-center text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">+1 new</span>
                <span className="text-text-muted">since login</span>
              </div>
            </div>

            <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-6xl text-red-400">trending_up</span>
              </div>
              <p className="text-text-muted text-sm font-medium uppercase tracking-wider">Labor Cost %</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-white">{Math.round((onShiftCount / Math.max(1, staff.length)) * 100)}%</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="flex items-center text-green-500 font-medium bg-green-500/10 px-1.5 py-0.5 rounded">
                  <span className="material-symbols-outlined text-[16px] mr-1">arrow_downward</span>
                  2%
                </span>
                <span className="text-text-muted">under budget target</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 mb-6">
            <div className="flex flex-col sm:flex-row justify-between gap-4 p-4 border border-border rounded-xl bg-surface">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[20px]">search</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                    placeholder="Search staff by name or ID..."
                    type="text"
                  />
                </div>
                <button
                  onClick={() => setRoleFilter(roleFilter === 'All' ? (roles[1] ?? 'All') : 'All')}
                  className="flex items-center justify-center p-2.5 rounded-lg border border-border bg-background text-text-muted hover:text-white hover:border-text-muted transition-colors"
                  title="Quick toggle role filter"
                >
                  <span className="material-symbols-outlined text-[20px]">filter_list</span>
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0">
                <button
                  onClick={() => setChipFilter('All')}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border whitespace-nowrap transition-colors ${
                    chipFilter === 'All' ? 'bg-primary/20 text-primary border-primary/30' : 'hover:bg-surface-light text-text-muted hover:text-white border-transparent'
                  }`}
                >
                  All Staff
                </button>
                <button
                  onClick={() => setChipFilter('OnShift')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    chipFilter === 'OnShift' ? 'bg-primary/20 text-primary border border-primary/30' : 'hover:bg-surface-light text-text-muted hover:text-white'
                  }`}
                >
                  On Shift
                </button>
                <button
                  onClick={() => setChipFilter('Kitchen')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    chipFilter === 'Kitchen' ? 'bg-primary/20 text-primary border border-primary/30' : 'hover:bg-surface-light text-text-muted hover:text-white'
                  }`}
                >
                  Kitchen
                </button>
                <button
                  onClick={() => setChipFilter('Service')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    chipFilter === 'Service' ? 'bg-primary/20 text-primary border border-primary/30' : 'hover:bg-surface-light text-text-muted hover:text-white'
                  }`}
                >
                  Service
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex bg-surface border border-border rounded-lg p-1">
                <button
                  onClick={() => setView('list')}
                  className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${view === 'list' ? 'bg-primary text-background shadow-lg' : 'text-text-muted hover:text-white'}`}
                >
                  Employee List
                </button>
                <button
                  onClick={() => setView('schedule')}
                  className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${view === 'schedule' ? 'bg-primary text-background shadow-lg' : 'text-text-muted hover:text-white'}`}
                >
                  Shift Schedule
                </button>
              </div>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {view === 'list' && (
            <div className="flex flex-col bg-surface border border-border rounded-xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-surface-light/30 text-xs uppercase text-text-muted font-semibold tracking-wider">
                    <tr>
                      <th className="px-6 py-4">Employee</th>
                      <th className="px-6 py-4">Role</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Schedule (This Week)</th>
                      <th className="px-6 py-4 text-right">Performance</th>
                      <th className="px-6 py-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedStaff.length === 0 ? (
                      <tr>
                        <td className="px-6 py-8 text-text-muted" colSpan={6}>
                          No staff found.
                        </td>
                      </tr>
                    ) : (
                      pagedStaff.map((s) => {
                        const active = activeShiftByStaffId.get(s.id);
                        const onShift = Boolean(active);
                        const runtime = runtimeStatusByStaffId[s.id] ?? {};
                        const isOnBreak = onShift && Boolean(runtime.breakUntil) && new Date(runtime.breakUntil!).getTime() > Date.now();
                        const lateMinutes = onShift ? Math.max(0, runtime.lateMinutes ?? 0) : 0;

                        const plannedHours = plannedHoursThisWeekByStaffId.get(s.id) ?? 0;
                        const pct = Math.max(0, Math.min(100, (plannedHours / 40) * 100));
                        const scheduleBar = isOnBreak ? 'bg-orange-400' : onShift ? 'bg-primary' : 'bg-text-muted/40';

                        const shiftCount = shiftCountLast7DaysByStaffId.get(s.id) ?? 0;
                        const rolePill = roleGroup(s.role) === 'Kitchen' ? 'bg-primary/20 text-primary border border-primary/20' : 'bg-surface-light text-white border border-white/10';

                        const statusLabel = isOnBreak ? 'On Break' : lateMinutes > 0 ? 'Late' : onShift ? 'On Shift' : s.status === 'Active' ? 'Off Duty' : s.status;
                        const statusDot = isOnBreak ? 'bg-orange-400' : lateMinutes > 0 ? 'bg-red-500 animate-pulse' : onShift ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-surface-light border border-text-muted';

                        const breakLeftMins = isOnBreak ? Math.max(0, Math.ceil((new Date(runtime.breakUntil!).getTime() - Date.now()) / (1000 * 60))) : 0;
                        return (
                          <tr key={s.id} className="group hover:bg-surface-light/20 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="size-10 rounded-full bg-cover bg-center border border-border" style={{ backgroundImage: `url('${s.avatar}')` }} />
                                <div>
                                  <p className="font-bold text-white text-sm">{s.name}</p>
                                  <p className="text-xs text-text-muted">ID: {s.id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${rolePill}`}>{s.role}</span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div
                                  className={`size-2.5 rounded-full ${statusDot}`}
                                />
                                <span className={`text-sm font-medium ${onShift ? 'text-white' : 'text-text-muted'}`}>{statusLabel}</span>
                                {onShift && active ? <span className="text-xs text-text-muted ml-1">(Since {formatTime12(active.clockInAt)})</span> : null}
                                {isOnBreak ? <span className="text-xs text-text-muted ml-1">({breakLeftMins}m left)</span> : null}
                                {lateMinutes > 0 ? <span className="text-xs text-red-300 ml-1">(+{lateMinutes}m)</span> : null}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs text-text-muted mb-0.5">
                                  <span>{plannedHours.toFixed(0)}h / 40h</span>
                                </div>
                                <div className="w-24 h-1.5 bg-background rounded-full overflow-hidden">
                                  <div className={`h-full ${scheduleBar} rounded-full`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex flex-col items-end">
                                <span className="text-sm font-bold text-white">{(hoursLast7DaysByStaffId.get(s.id) ?? 0).toFixed(1)}h</span>
                                <span className="text-xs text-text-muted">Last 7 days</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="relative inline-block text-left">
                                <button
                                  onClick={() => setActionsId((prev) => (prev === s.id ? null : s.id))}
                                  className="p-1.5 rounded-lg text-text-muted hover:text-white hover:bg-surface-light transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[20px]">more_vert</span>
                                </button>
                                {actionsId === s.id ? (
                                  <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-surface shadow-xl z-20 overflow-hidden">
                                    <button
                                      onClick={() => {
                                        setProfileId(s.id);
                                        setActionsId(null);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                    >
                                      View Profile
                                    </button>
                                    <button
                                      onClick={() => {
                                        openEdit(s.id);
                                        setActionsId(null);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                    >
                                      Edit Staff
                                    </button>

                                    <button
                                      onClick={() => {
                                        setDeleteId(s.id);
                                        setActionsId(null);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-red-200 hover:bg-red-500/10"
                                    >
                                      Delete Staff
                                    </button>
                                    <button
                                      onClick={() => {
                                        setShiftHistoryId(s.id);
                                        setActionsId(null);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                    >
                                      Shift History
                                    </button>
                                    <button
                                      onClick={() => {
                                        setPaySlipId(s.id);
                                        setActionsId(null);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                    >
                                      Pay Slip
                                    </button>

                                    <div className="h-px bg-border" />

                                    {onShift ? (
                                      <button
                                        onClick={() => {
                                          clockOut(s.id);
                                          setActionsId(null);
                                        }}
                                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                      >
                                        Clock Out
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          clockIn(s.id);
                                          setActionsId(null);
                                        }}
                                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                      >
                                        Clock In
                                      </button>
                                    )}

                                    {onShift ? (
                                      <>
                                        {isOnBreak ? (
                                          <button
                                            onClick={() => {
                                              clearBreak(s.id);
                                              setActionsId(null);
                                            }}
                                            className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                          >
                                            End Break
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              setBreak(s.id, 15);
                                              setActionsId(null);
                                            }}
                                            className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                          >
                                            Start Break (15m)
                                          </button>
                                        )}

                                        <button
                                          onClick={() => {
                                            addLate(s.id, 5);
                                            setActionsId(null);
                                          }}
                                          className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                        >
                                          Mark Late (+5m)
                                        </button>
                                        <button
                                          onClick={() => {
                                            addLate(s.id, 15);
                                            setActionsId(null);
                                          }}
                                          className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                        >
                                          Mark Late (+15m)
                                        </button>
                                        <button
                                          onClick={() => {
                                            clearLate(s.id);
                                            setActionsId(null);
                                          }}
                                          className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                        >
                                          Clear Late
                                        </button>
                                      </>
                                    ) : null}

                                    <div className="h-px bg-border" />

                                    <button
                                      onClick={() => {
                                        createLeaveRequest(s.id, 3);
                                        setActionsId(null);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                    >
                                      Request Leave (3 days)
                                    </button>
                                    <button
                                      onClick={() => {
                                        createLeaveRequest(s.id, 7);
                                        setActionsId(null);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-light"
                                    >
                                      Request Leave (7 days)
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-surface">
                <p className="text-sm text-text-muted">
                  Showing <span className="text-white font-medium">{showingRange.start}-{showingRange.end}</span> of{' '}
                  <span className="text-white font-medium">{showingRange.total}</span> staff
                </p>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1 rounded border border-border text-text-muted hover:bg-surface-light hover:text-white transition-colors disabled:opacity-50 text-sm"
                    disabled={pageIndex <= 0}
                    onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </button>
                  <button
                    className="px-3 py-1 rounded border border-border text-text-muted hover:bg-surface-light hover:text-white transition-colors text-sm"
                    disabled={pageIndex >= pageCount - 1}
                    onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

          {view === 'schedule' && (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="p-4 bg-surface-light border-b border-border flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-col">
                        <h3 className="text-white font-bold">
                          Week of {weekStart} - {addDays(weekStart, 6)}
                        </h3>
                        <div className="text-xs text-text-muted">Plan next week or any week in a month using the navigator.</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setScheduleEditMode((v) => !v)}
                          className={`px-3 py-1.5 rounded border text-xs font-bold transition-colors ${
                            scheduleEditMode ? 'bg-primary/20 text-primary border-primary/30' : 'border-border text-text-muted hover:bg-border hover:text-white'
                          }`}
                        >
                          {scheduleEditMode ? 'Done Editing' : 'Edit Week'}
                        </button>
                        <button
                          onClick={cloneWeekToNext}
                          className="px-3 py-1.5 rounded border border-primary/30 bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
                        >
                          Clone to Next Week
                        </button>
                        <button
                          onClick={() => {
                            setWeekStart(addDays(weekStart, -7));
                            setScheduleEditMode(false);
                            setEditingCell(null);
                          }}
                          className="p-1.5 rounded hover:bg-border text-white"
                          title="Previous week"
                        >
                          <span className="material-symbols-outlined">chevron_left</span>
                        </button>
                        <button
                          onClick={() => {
                            setWeekStart(addDays(weekStart, 7));
                            setScheduleEditMode(false);
                            setEditingCell(null);
                          }}
                          className="p-1.5 rounded hover:bg-border text-white"
                          title="Next week"
                        >
                          <span className="material-symbols-outlined">chevron_right</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs text-text-muted">Month</label>
                      <input
                        type="month"
                        value={weekStart.slice(0, 7)}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          const d = new Date(`${v}-01T00:00:00`);
                          setWeekStart(toIsoDate(weekStartOf(d)));
                          setScheduleEditMode(false);
                          setEditingCell(null);
                        }}
                        className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-white"
                      />
                      <div className="flex gap-2 overflow-x-auto">
                        {(() => {
                          const base = new Date(`${weekStart.slice(0, 7)}-01T00:00:00`);
                          const first = weekStartOf(base);
                          const weeks: string[] = [];
                          for (let i = 0; i < 6; i++) {
                            const w = new Date(first);
                            w.setDate(w.getDate() + i * 7);
                            if (w.getMonth() !== base.getMonth() && i > 0) break;
                            weeks.push(toIsoDate(w));
                          }
                          return weeks;
                        })().map((w) => (
                          <button
                            key={w}
                            onClick={() => {
                              setWeekStart(w);
                              setScheduleEditMode(false);
                              setEditingCell(null);
                            }}
                            className={`px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap transition-colors ${
                              w === weekStart ? 'bg-primary/20 text-primary border-primary/30' : 'border-border text-text-muted hover:bg-border hover:text-white'
                            }`}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3">
                  <div className="xl:col-span-2 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                <th className="p-4 border-b border-r border-border bg-surface-light/50 text-xs font-bold text-text-muted uppercase w-48 sticky left-0 z-10 backdrop-blur">Staff Member</th>
                                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                                    <th key={day} className="p-4 border-b border-border text-xs font-bold text-text-muted uppercase text-center min-w-[120px]">{day}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {currentWeekRows.map((row, i) => (
                                <tr key={i}>
                                    <td className="p-4 border-r border-border bg-surface font-bold text-sm text-white sticky left-0 z-10">
                                      {staffById.get(row.staffId)?.name || row.staffId}
                                    </td>
                                    {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => {
                                        // @ts-ignore
                                        const shift = row[day];
                                        const isOff = shift === 'Off';
                                        const isSelected = scheduleEditMode && editingCell?.staffId === row.staffId && editingCell?.day === (day as any);
                                        return (
                                            <td key={day} className="p-2 border-r border-border last:border-r-0">
                                              <button
                                                onClick={() => {
                                                  if (!scheduleEditMode) return;
                                                  setEditingCell({ staffId: row.staffId, day: day as any });
                                                }}
                                                className={`w-full rounded p-2 text-xs font-bold text-center border transition-colors ${
                                                  isSelected
                                                    ? 'bg-primary/20 border-primary/40 text-white'
                                                    : isOff
                                                      ? 'bg-surface-light border-border text-text-muted/50'
                                                      : 'bg-primary/10 border-primary/20 text-primary hover:bg-primary/15'
                                                }`}
                                                disabled={!scheduleEditMode}
                                              >
                                                {shift}
                                              </button>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                  </div>

                  <div className="hidden xl:block border-l border-border bg-surface p-4">
                    {!scheduleEditMode || !editingCell ? (
                      <div className="text-text-muted text-sm">Click any day cell to edit shift time.</div>
                    ) : (
                      (() => {
                        const row = currentWeekRows.find((r) => r.staffId === editingCell.staffId);
                        const raw = row ? (row as any)[editingCell.day] : 'Off';
                        const parts = parseShiftToParts(String(raw));
                        const staffName = staffById.get(editingCell.staffId)?.name || editingCell.staffId;
                        return (
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                              <div className="text-white font-bold">Edit Shift</div>
                              <button
                                onClick={() => setEditingCell(null)}
                                className="text-text-muted hover:text-white"
                              >
                                <span className="material-symbols-outlined">close</span>
                              </button>
                            </div>

                            <div className="text-sm text-white">
                              {staffName}
                              <span className="text-text-muted">    {String(editingCell.day).toUpperCase()}</span>
                            </div>

                            <label className="flex items-center gap-2 text-sm text-text-muted">
                              <input
                                type="checkbox"
                                checked={parts.off}
                                onChange={(e) => updateScheduleCell(editingCell.staffId, editingCell.day, e.target.checked ? 'Off' : formatShift12(parts.start, parts.end))}
                                className="rounded border-border bg-background"
                              />
                              Off
                            </label>

                            {!parts.off ? (
                              <div className="grid grid-cols-1 gap-3">
                                <div className="text-xs text-text-muted font-bold uppercase tracking-wider">Start</div>
                                <div className="flex gap-2">
                                  <select
                                    value={parts.start.hour}
                                    onChange={(e) => {
                                      const next = { ...parts, start: { ...parts.start, hour: Number(e.target.value) } };
                                      updateScheduleCell(editingCell.staffId, editingCell.day, formatShift12(next.start, next.end));
                                    }}
                                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white"
                                  >
                                    {hoursOptions.map((h) => (
                                      <option key={h} value={h}>
                                        {h}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={parts.start.minute}
                                    onChange={(e) => {
                                      const next = { ...parts, start: { ...parts.start, minute: Number(e.target.value) } };
                                      updateScheduleCell(editingCell.staffId, editingCell.day, formatShift12(next.start, next.end));
                                    }}
                                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white"
                                  >
                                    {minuteOptions.map((m) => (
                                      <option key={m} value={m}>
                                        {String(m).padStart(2, '0')}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={parts.start.meridiem}
                                    onChange={(e) => {
                                      const next = { ...parts, start: { ...parts.start, meridiem: e.target.value as 'AM' | 'PM' } };
                                      updateScheduleCell(editingCell.staffId, editingCell.day, formatShift12(next.start, next.end));
                                    }}
                                    className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-white"
                                  >
                                    <option value="AM">AM</option>
                                    <option value="PM">PM</option>
                                  </select>
                                </div>

                                <div className="text-xs text-text-muted font-bold uppercase tracking-wider mt-2">End</div>
                                <div className="flex gap-2">
                                  <select
                                    value={parts.end.hour}
                                    onChange={(e) => {
                                      const next = { ...parts, end: { ...parts.end, hour: Number(e.target.value) } };
                                      updateScheduleCell(editingCell.staffId, editingCell.day, formatShift12(next.start, next.end));
                                    }}
                                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white"
                                  >
                                    {hoursOptions.map((h) => (
                                      <option key={h} value={h}>
                                        {h}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={parts.end.minute}
                                    onChange={(e) => {
                                      const next = { ...parts, end: { ...parts.end, minute: Number(e.target.value) } };
                                      updateScheduleCell(editingCell.staffId, editingCell.day, formatShift12(next.start, next.end));
                                    }}
                                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white"
                                  >
                                    {minuteOptions.map((m) => (
                                      <option key={m} value={m}>
                                        {String(m).padStart(2, '0')}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={parts.end.meridiem}
                                    onChange={(e) => {
                                      const next = { ...parts, end: { ...parts.end, meridiem: e.target.value as 'AM' | 'PM' } };
                                      updateScheduleCell(editingCell.staffId, editingCell.day, formatShift12(next.start, next.end));
                                    }}
                                    className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-white"
                                  >
                                    <option value="AM">AM</option>
                                    <option value="PM">PM</option>
                                  </select>
                                </div>

                                <div className="text-xs text-text-muted">Saved automatically for {weekStart}.</div>
                              </div>
                            ) : (
                              <div className="text-text-muted text-sm">Marked as Off.</div>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={addOpen}
        title={editId ? 'Edit Employee' : view === 'list' ? 'Add Employee' : 'Edit Schedule'}
        onClose={closeAdd}
        footer={
          <div className="flex gap-3">
            <button onClick={closeAdd} className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors" disabled={busy}>Cancel</button>
            <button onClick={saveAdd} className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary-hover text-background font-extrabold transition-colors disabled:opacity-60" disabled={busy}>{busy ? 'Saving ¦' : 'Save'}</button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-bold text-text-muted">Name</label>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" placeholder="Full name" />
          <label className="text-sm font-bold text-text-muted">Role</label>
          <input value={draftRole} onChange={(e) => setDraftRole(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" placeholder="Waiter" />
          <label className="text-sm font-bold text-text-muted">Phone</label>
          <input value={draftPhone} onChange={(e) => setDraftPhone(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" placeholder="+251 ..." />
          <label className="text-sm font-bold text-text-muted">Email</label>
          <input
            value={draftEmail}
            onChange={(e) => setDraftEmail(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white"
            placeholder="name@example.com"
          />
          {!editId ? (
            <>
              <label className="text-sm font-bold text-text-muted">Password</label>
              <input
                value={draftPassword}
                onChange={(e) => setDraftPassword(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white"
                placeholder="Temporary password"
                type="password"
              />
            </>
          ) : null}
          <label className="text-sm font-bold text-text-muted">Shift</label>
          <input value={draftShift} onChange={(e) => setDraftShift(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" placeholder="08:00 - 16:00" />
        </div>
      </Modal>

      <Modal
        open={deleteId != null}
        title="Delete Staff"
        onClose={() => setDeleteId(null)}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setDeleteId(null)}
              className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!deleteId) return;
                const id = deleteId;
                try {
                  const s = readSession<any>();
                  const sessRole = typeof s?.role === 'string' ? s.role : '';
                  if (sessRole !== 'Branch Manager' && sessRole !== 'Cafe Owner') {
                    setFlash({ kind: 'error', message: 'forbidden' });
                    return;
                  }
                } catch {
                  setFlash({ kind: 'error', message: 'forbidden' });
                  return;
                }
                setBusy(true);
                void (async () => {
                  try {
                    const branchId = resolveBranchIdOverride();
                    const res = await apiFetch(`/api/manager/staff/${encodeURIComponent(id)}${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`, {
                      method: 'DELETE',
                    });
                    const json = (await res.json().catch(() => null)) as any;
                    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
                    setDeleteId(null);
                    setFlash({ kind: 'success', message: 'Staff deleted.' });
                    await loadRemoteStaff();
                  } catch (e) {
                    setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to delete staff.' });
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              className="flex-1 h-11 rounded-lg bg-red-600 hover:bg-red-500 text-white font-extrabold transition-colors disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Deleting ¦' : 'Delete'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-text-muted">This will permanently remove the staff member from this branch.</div>
      </Modal>

      <Modal
        open={shiftHistoryId != null}
        title={shiftHistoryStaff ? `Shift History: ${shiftHistoryStaff.name}` : 'Shift History'}
        onClose={() => setShiftHistoryId(null)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setShiftHistoryId(null)} className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors">Close</button>
          </div>
        }
      >
        {(() => {
          const sid = shiftHistoryId;
          const rows = sid ? shiftLogs.filter((l) => l.staffId === sid) : [];
          return (
            <div className="space-y-3">
              <div className="text-sm text-text-muted">
                Showing the most recent shifts for this staff member.
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="max-w-full overflow-x-auto">
                  <table className="min-w-[520px] w-full text-left text-sm">
                    <thead className="bg-surface-light/50">
                      <tr className="text-xs font-bold text-text-muted uppercase">
                        <th className="p-3 border-b border-border">Clock In</th>
                        <th className="p-3 border-b border-border">Clock Out</th>
                        <th className="p-3 border-b border-border">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.length === 0 ? (
                        <tr>
                          <td className="p-4 text-text-muted" colSpan={3}>
                            No shifts recorded yet.
                          </td>
                        </tr>
                      ) : (
                        rows.slice(0, 25).map((r) => (
                          <tr key={r.id}>
                            <td className="p-3 text-white font-mono">{formatDateTime12(r.clockInAt)}</td>
                            <td className="p-3 text-white font-mono">{r.clockOutAt ? formatDateTime12(r.clockOutAt) : ' ”'}</td>
                            <td className="p-3">
                              {r.clockOutAt ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-surface-light text-text-muted border border-border">Closed</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-primary/10 text-primary border border-primary/20">Open</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={profileId != null}
        title={profile ? profile.name : 'Profile'}
        onClose={() => setProfileId(null)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setProfileId(null)} className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors">Close</button>
          </div>
        }
      >
        <div className="flex items-center gap-4">
          {profile ? (
            <img src={profile.avatar} alt={profile.name} className="w-14 h-14 rounded-full border border-border object-cover" />
          ) : null}
          <div className="flex flex-col gap-1">
            <div className="text-white font-bold">{profile?.name}</div>
            <div className="text-text-muted text-sm">{profile?.role}</div>
            <div className="text-text-muted text-sm">{profile?.phone}</div>
            <div className="text-text-muted text-sm">Shift: {profile?.shift}</div>
          </div>
        </div>
      </Modal>

      <Modal
        open={paySlipId != null}
        title={paySlip ? `Pay Slip: ${paySlip.name}` : 'Pay Slip'}
        onClose={() => setPaySlipId(null)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setPaySlipId(null)} className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors">Close</button>
            <button onClick={() => window.print()} className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary-hover text-background font-extrabold transition-colors">Print</button>
          </div>
        }
      >
        <div className="text-sm text-text-muted">
          This is a placeholder pay slip preview. Hook your payroll backend to show real earnings and deductions.
        </div>
      </Modal>
    </div>
  );
};
