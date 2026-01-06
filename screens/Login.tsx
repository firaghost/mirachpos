import React, { useMemo, useState } from 'react';
import { apiFetch } from '../api';
import { Screen, UserRole } from '../types';
import { writeSession } from '../session';

interface LoginProps {
  onLogin: (role: UserRole) => void;
}

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [workspace, setWorkspace] = useState(() => {
    try {
      return String(localStorage.getItem('mirachpos.lastWorkspace.v1') || '').trim() || 'cafe1';
    } catch {
      return 'cafe1';
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = useMemo(() => {
    return Boolean(workspace.trim() && email.trim() && password);
  }, [email, password, workspace]);

  const submit = async () => {
    if (loading) return;
    setError('');

    const ws = workspace.trim().toLowerCase();
    const em = email.trim().toLowerCase();
    const pw = String(password || '');

    if (!ws || !em || !pw) {
      setError('Workspace, email and password are required.');
      return;
    }

    setLoading(true);
    try {
      try {
        localStorage.setItem('mirachpos.lastWorkspace.v1', ws);
      } catch {
        // ignore
      }

      const res = await apiFetch('/api/auth/login', {
        auth: false,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: pw }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error || res.status));

      const token = typeof json?.token === 'string' ? json.token : '';
      const role = typeof json?.role === 'string' ? json.role : '';
      const tenantId = typeof json?.tenantId === 'string' ? json.tenantId : '';
      const staffId = typeof json?.staffId === 'string' ? json.staffId : '';
      const staffName = typeof json?.staffName === 'string' ? json.staffName : '';
      const branchId = typeof json?.branchId === 'string' ? json.branchId : 'global';

      if (!token || !role || !tenantId) throw new Error('login_failed');

      const mappedRole =
        role === UserRole.WAITER
          ? UserRole.WAITER
          : role === UserRole.BRANCH_MANAGER
            ? UserRole.BRANCH_MANAGER
            : role === UserRole.CAFE_OWNER
              ? UserRole.CAFE_OWNER
              : (role as any);

      const subscription = json?.subscription ?? null;
      const billing = json?.billing ?? null;

      writeSession({
        token,
        role: mappedRole,
        tenantId,
        staffId,
        staffName,
        branchId,
        subscription,
        billing,
        screen: Screen.LOGIN,
      });

      try {
        if (mappedRole === UserRole.BRANCH_MANAGER) {
          localStorage.setItem('mirachpos.manager.selectedBranchId.v1', branchId);
        }
        if (mappedRole === UserRole.WAITER) {
          localStorage.setItem('mirachpos.waiter.selectedBranchId.v1', branchId);
        }
        if (mappedRole === UserRole.CAFE_OWNER && branchId && branchId !== 'global') {
          localStorage.setItem('mirachpos.owner.selectedBranchId.v1', branchId);
        }
      } catch {
        // ignore
      }

      onLogin(mappedRole);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#181611] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-[#3d3226] bg-[#221c10] shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-[#3d3226]">
          <div className="text-2xl font-black tracking-tight">MirachPOS</div>
          <div className="text-sm text-[#c9b792] mt-1">Sign in to your workspace</div>
        </div>

        <div className="p-6 flex flex-col gap-4">
          {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Workspace (Tenant)</span>
            <input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              className="h-11 rounded-lg border border-[#3d3226] bg-[#181611] px-3 text-sm text-white focus:outline-none focus:border-[#eead2b]"
              placeholder="cafe1"
              autoComplete="organization"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-lg border border-[#3d3226] bg-[#181611] px-3 text-sm text-white focus:outline-none focus:border-[#eead2b]"
              placeholder="name@company.com"
              autoComplete="email"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-lg border border-[#3d3226] bg-[#181611] px-3 text-sm text-white focus:outline-none focus:border-[#eead2b]"
              type="password"
              autoComplete="current-password"
            />
          </label>

          <button
            type="button"
            disabled={!canSubmit || loading}
            onClick={submit}
            className={cx(
              'h-11 rounded-lg font-black text-sm transition-colors',
              !canSubmit || loading ? 'bg-[#3d3226] text-[#b9b09d] cursor-not-allowed' : 'bg-[#eead2b] hover:bg-[#d49a26] text-[#181611]',
            )}
          >
            {loading ? 'Signing in ¦' : 'Sign In'}
          </button>

          <div className="text-xs text-[#897c61]">
            Tip: In dev, workspace should match your tenant slug (for example: <span className="font-bold text-[#c9b792]">cafe1</span>).
          </div>
        </div>
      </div>
    </div>
  );
};
