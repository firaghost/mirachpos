import React, { useEffect, useMemo, useState } from 'react';
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
      return String(localStorage.getItem('mirachpos.lastWorkspace.v1') || '').trim();
    } catch {
      return '';
    }
  });
  const [email, setEmail] = useState(() => {
    try {
      return String(localStorage.getItem('mirachpos.lastEmail.v1') || '').trim();
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      const v = localStorage.getItem('mirachpos.rememberMe.v1');
      if (v === '0') return false;
      if (v === '1') return true;
      // Backward compatibility
      if (localStorage.getItem('mirachpos.rememberPassword.v1') === '1') return true;
      if ((localStorage.getItem('mirachpos.rememberEmail.v1') || '1') !== '0') return true;
      return true;
    } catch {
      return true;
    }
  });
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'email' | 'pin'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [fpStep, setFpStep] = useState<'request' | 'confirm'>('request');
  const [fpEmail, setFpEmail] = useState('');
  const [fpOtp, setFpOtp] = useState('');
  const [fpPw1, setFpPw1] = useState('');
  const [fpPw2, setFpPw2] = useState('');
  const [fpBusy, setFpBusy] = useState(false);
  const [fpMsg, setFpMsg] = useState('');
  const [fpErr, setFpErr] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const db = (window as any)?.mirachpos?.db;
        if (!db?.get) return;

        const [ws, em, pw, re] = await Promise.all([
          db.get('mirachpos.lastWorkspace.v1'),
          db.get('mirachpos.lastEmail.v1'),
          db.get('mirachpos.lastPassword.v1'),
          db.get('mirachpos.rememberMe.v1'),
        ]);

        if (cancelled) return;

        if (typeof ws === 'string' && ws.trim() && !workspace.trim()) setWorkspace(ws.trim());
        if (typeof em === 'string' && em.trim() && !email.trim()) setEmail(em.trim());

        const nextRememberMe = String(re ?? '') !== '0';
        setRememberMe(nextRememberMe);

        if (nextRememberMe && typeof pw === 'string' && pw && !password) setPassword(pw);
      } catch {
        // ignore
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openForgot = () => {
    setFpErr('');
    setFpMsg('');
    setFpStep('request');
    setFpEmail(email.trim().toLowerCase());
    setFpOtp('');
    setFpPw1('');
    setFpPw2('');
    setShowForgot(true);
  };

  const forgotRequest = async () => {
    if (fpBusy) return;
    setFpErr('');
    setFpMsg('');
    const ws = workspace.trim().toLowerCase();
    const em = fpEmail.trim().toLowerCase();
    if (!ws) {
      setFpErr('Workspace (tenant) is required.');
      return;
    }
    if (!em) {
      setFpErr('Email is required.');
      return;
    }
    setFpBusy(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password/request', {
        auth: false,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant': ws },
        body: JSON.stringify({ email: em }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error || `HTTP ${res.status}`));
      setFpStep('confirm');
      const dbg = json?.debug?.mail;
      const env = dbg?.env;
      const envLine =
        env && typeof env === 'object'
          ? ` env(host=${String(env.host || '')} port=${String(env.port || '')} user=${String(env.user || '')} hasPass=${String(Boolean(env.hasPass))} from=${String(env.from || '')})`
          : '';
      const dbgLine =
        dbg && typeof dbg === 'object'
          ? ` SMTP: configured=${String(dbg.configured)} attempted=${String(dbg.attempted)} sent=${String(dbg.sent)}${dbg.error ? ` error=${String(dbg.error)}` : ''}${envLine}`
          : '';
      setFpMsg(`If the email exists, we sent an OTP code. Check your inbox.${dbgLine}`);
    } catch (e) {
      setFpErr(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setFpBusy(false);
    }
  };

  const forgotConfirm = async () => {
    if (fpBusy) return;
    setFpErr('');
    setFpMsg('');
    const ws = workspace.trim().toLowerCase();
    const em = fpEmail.trim().toLowerCase();
    const otp = fpOtp.trim();
    if (!ws) {
      setFpErr('Workspace (tenant) is required.');
      return;
    }
    if (!em) {
      setFpErr('Email is required.');
      return;
    }
    if (!otp) {
      setFpErr('OTP is required.');
      return;
    }
    if (!fpPw1 || fpPw1.length < 6) {
      setFpErr('Password must be at least 6 characters.');
      return;
    }
    if (fpPw1 !== fpPw2) {
      setFpErr('Passwords do not match.');
      return;
    }
    setFpBusy(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password/confirm', {
        auth: false,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant': ws },
        body: JSON.stringify({ email: em, otp, password: fpPw1, passwordConfirm: fpPw2 }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error || `HTTP ${res.status}`));
      setFpMsg('Password updated. You can now sign in.');
      setShowForgot(false);
      setEmail(em);
      setPassword('');
    } catch (e) {
      setFpErr(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setFpBusy(false);
    }
  };

  const canSubmit = useMemo(() => {
    if (!workspace.trim()) return false;
    if (mode === 'pin') return Boolean(code.trim() && pin.trim());
    return Boolean(email.trim() && password);
  }, [email, password, workspace, mode, code, pin]);

  const submit = async () => {
    if (loading) return;
    setError('');

    const ws = workspace.trim().toLowerCase();
    const em = email.trim().toLowerCase();
    const pw = String(password || '');
    const cd = code.trim();
    const pn = String(pin || '').trim();

    if (!ws) {
      setError('Workspace (tenant) is required.');
      return;
    }
    if (mode === 'pin') {
      if (!cd || !pn) {
        setError('Workspace, code and PIN are required.');
        return;
      }
    } else {
      if (!em || !pw) {
        setError('Workspace, email and password are required.');
        return;
      }
    }

    setLoading(true);
    try {
      try {
        localStorage.setItem('mirachpos.lastWorkspace.v1', ws);
        localStorage.setItem('mirachpos.rememberMe.v1', rememberMe ? '1' : '0');
        if (rememberMe) {
          if (em) localStorage.setItem('mirachpos.lastEmail.v1', em);
          localStorage.setItem('mirachpos.lastPassword.v1', pw);
        } else {
          localStorage.removeItem('mirachpos.lastEmail.v1');
          localStorage.removeItem('mirachpos.lastPassword.v1');
        }
      } catch {
        // ignore
      }

      try {
        const db = (window as any)?.mirachpos?.db;
        if (db?.set) {
          await db.set('mirachpos.lastWorkspace.v1', ws);
          await db.set('mirachpos.rememberMe.v1', rememberMe ? '1' : '0');
          await db.set('mirachpos.lastEmail.v1', rememberMe ? em : '');
          await db.set('mirachpos.lastPassword.v1', rememberMe ? pw : '');
        }
      } catch {
        // ignore
      }

      const res = await apiFetch(mode === 'pin' ? '/api/auth/login-pin' : '/api/auth/login', {
        auth: false,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'pin' ? { code: cd, pin: pn } : { email: em, password: pw }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error || res.status));

      const token = typeof json?.token === 'string' ? json.token : '';
      const role = typeof json?.role === 'string' ? json.role : '';
      const tenantId = typeof json?.tenantId === 'string' ? json.tenantId : '';
      const staffId = typeof json?.staffId === 'string' ? json.staffId : '';
      const staffName = typeof json?.staffName === 'string' ? json.staffName : '';
      const branchId = typeof json?.branchId === 'string' ? json.branchId : 'global';
      const permissions = Array.isArray(json?.permissions) ? (json.permissions as any[]).map(String).filter(Boolean) : [];

      if (!token || !role || !tenantId) throw new Error('login_failed');

      const mappedRole =
        role === UserRole.WAITER
          ? UserRole.WAITER
          : role === UserRole.WAITER_MANAGER
            ? UserRole.WAITER_MANAGER
          : role === UserRole.BRANCH_MANAGER
            ? UserRole.BRANCH_MANAGER
            : role === UserRole.CAFE_OWNER
              ? UserRole.CAFE_OWNER
              : (role as any);

      const initialScreen = (() => {
        if (mappedRole === UserRole.WAITER) return Screen.WAITER_DASHBOARD;
        if (mappedRole === UserRole.WAITER_MANAGER) return Screen.WAITER_DASHBOARD;
        if (mappedRole === UserRole.BRANCH_MANAGER) return Screen.MANAGER_DASHBOARD;
        if (mappedRole === UserRole.SUPER_ADMIN) return Screen.SA_OVERVIEW;
        if (mappedRole === UserRole.CAFE_OWNER) return Screen.OWNER_DASHBOARD;
        return Screen.DASHBOARD;
      })();

      const subscription = json?.subscription ?? null;
      const billing = json?.billing ?? null;

      writeSession({
        token,
        role: mappedRole,
        tenantId,
        tenantSlug: ws,
        tenant: { id: tenantId, slug: ws, name: '' },
        staffId,
        staffName,
        branchId,
        permissions,
        subscription,
        billing,
        screen: initialScreen,
      });

      try {
        if (mappedRole === UserRole.BRANCH_MANAGER) {
          localStorage.setItem('mirachpos.manager.selectedBranchId.v1', branchId);
        }
        if (mappedRole === UserRole.WAITER) {
          localStorage.setItem('mirachpos.waiter.selectedBranchId.v1', branchId);
        }
        if (mappedRole === UserRole.WAITER_MANAGER) {
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
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="text-2xl font-black tracking-tight">MirachPOS</div>
          <div className="text-sm text-muted-foreground mt-1">Sign in to your workspace</div>
        </div>

        <div className="p-6 flex flex-col gap-4">
          {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setMode('email');
                setError('');
              }}
              className={cx(
                'h-10 rounded-lg border text-sm font-black',
                mode === 'email' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:border-primary',
              )}
            >
              Email Login
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('pin');
                setError('');
              }}
              className={cx(
                'h-10 rounded-lg border text-sm font-black',
                mode === 'pin' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:border-primary',
              )}
            >
              PIN Login
            </button>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Workspace (Tenant)</span>
            <input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary"
              placeholder="cafe1"
              autoComplete="organization"
            />
          </label>

          {mode === 'pin' ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Staff Code</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary"
                  placeholder="ABC-W-001"
                  autoComplete="username"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">PIN</span>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary"
                  type="password"
                  autoComplete="current-password"
                />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Email</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary"
                  placeholder="name@company.com"
                  autoComplete="email"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Password</span>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary"
                  type="password"
                  autoComplete="current-password"
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground font-black select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={openForgot}
                  className="text-xs font-black text-muted-foreground hover:text-foreground underline decoration-border hover:decoration-primary underline-offset-4"
                >
                  Forgot password?
                </button>
              </div>
            </>
          )}

          <button
            type="button"
            disabled={!canSubmit || loading}
            onClick={submit}
            className={cx(
              'h-11 rounded-lg font-black text-sm transition-colors',
              !canSubmit || loading ? 'bg-secondary text-muted-foreground cursor-not-allowed' : 'bg-primary hover:bg-primary/90 text-primary-foreground',
            )}
          >
            {loading ? 'Signing in ¦' : 'Sign In'}
          </button>

          {showForgot ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
              <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <div className="font-black">Reset Password</div>
                  <button
                    type="button"
                    onClick={() => setShowForgot(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-4 flex flex-col gap-3">
                  {fpErr ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{fpErr}</div> : null}
                  {fpMsg ? <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-foreground">{fpMsg}</div> : null}

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Email</span>
                    <input
                      value={fpEmail}
                      onChange={(e) => setFpEmail(e.target.value)}
                      className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary"
                      placeholder="name@company.com"
                      autoComplete="email"
                    />
                  </label>

                  {fpStep === 'confirm' ? (
                    <>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">OTP Code</span>
                        <input
                          value={fpOtp}
                          onChange={(e) => setFpOtp(e.target.value)}
                          className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary"
                          placeholder="123456"
                          autoComplete="one-time-code"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">New Password</span>
                        <input
                          value={fpPw1}
                          onChange={(e) => setFpPw1(e.target.value)}
                          className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary"
                          type="password"
                          autoComplete="new-password"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Confirm Password</span>
                        <input
                          value={fpPw2}
                          onChange={(e) => setFpPw2(e.target.value)}
                          className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary"
                          type="password"
                          autoComplete="new-password"
                        />
                      </label>
                    </>
                  ) : null}

                  <div className="flex gap-2">
                    {fpStep === 'request' ? (
                      <button
                        type="button"
                        onClick={forgotRequest}
                        disabled={fpBusy}
                        className={cx(
                          'h-11 flex-1 rounded-lg font-black text-sm transition-colors',
                          fpBusy ? 'bg-secondary text-muted-foreground cursor-not-allowed' : 'bg-primary hover:bg-primary/90 text-primary-foreground',
                        )}
                      >
                        {fpBusy ? 'Sending ¦' : 'Send OTP'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={forgotConfirm}
                        disabled={fpBusy}
                        className={cx(
                          'h-11 flex-1 rounded-lg font-black text-sm transition-colors',
                          fpBusy ? 'bg-secondary text-muted-foreground cursor-not-allowed' : 'bg-primary hover:bg-primary/90 text-primary-foreground',
                        )}
                      >
                        {fpBusy ? 'Saving ¦' : 'Set New Password'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowForgot(false)}
                      className="h-11 px-4 rounded-lg border border-border bg-background text-foreground font-black text-sm hover:border-primary"
                    >
                      Cancel
                    </button>
                  </div>

                  {fpStep === 'confirm' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFpStep('request');
                        setFpErr('');
                        setFpMsg('');
                        setFpOtp('');
                        setFpPw1('');
                        setFpPw2('');
                      }}
                      className="text-xs font-black text-muted-foreground hover:text-foreground self-start"
                    >
                      Resend OTP
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
