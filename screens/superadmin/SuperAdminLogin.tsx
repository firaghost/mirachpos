import React, { useMemo, useState } from 'react';
import { Screen, UserRole } from '../../types';
import { apiFetch } from '../../api';
import { writeSession } from '../../session';

interface SuperAdminLoginProps {
  onLogin: (role: UserRole) => void;
}

export const SuperAdminLogin: React.FC<SuperAdminLoginProps> = ({ onLogin }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const emailLoginAllowed = useMemo(() => {
    const e = email.trim();
    const p = password;
    if (!e || !p) return false;
    return true;
  }, [email, password]);

  const submit = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const e = email.trim().toLowerCase();
      const p = password;
      if (!e || !p) throw new Error('Email and password are required.');

      const res = await apiFetch('/api/superadmin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, password: p }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      const token = typeof json?.token === 'string' ? json.token : '';
      if (!token) throw new Error('login_missing_token');

      writeSession({
        role: UserRole.SUPER_ADMIN,
        screen: Screen.SA_OVERVIEW,
        token,
        superadminToken: token,
        branchId: 'global',
        tenantId: 'tenant_global',
        staffId: '',
        subscription: null,
        offline: false,
      });

      try {
        window.dispatchEvent(new Event('mirachpos-session-changed'));
      } catch {
      }

      onLogin(UserRole.SUPER_ADMIN);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-display bg-background-light dark:bg-background-dark text-slate-900 dark:text-white antialiased h-screen overflow-y-auto overflow-x-hidden">
      <div className="relative flex min-h-full w-full flex-col justify-center items-center p-4">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-[#211911]/90 z-10"></div>
          <div
            className="w-full h-full bg-cover bg-center opacity-40 blur-sm"
            style={{
              backgroundImage: `url("https://lh3.googleusercontent.com/aida-public/AB6AXuB3VGuf-lyXUkRZwJ2uKRscSLDkMZGrLWboCMkddVnRV8f9FoGoUvAfWCpPmvkrxSsr3MINfE5HbpQDTvlqSlyaas2oYB4JFj83lc2ZfQULe44yGsi1k7Cgg1MxeNr8LLTfNJUkIgGefqscdbBbV6_TgX4m9zorVUBA6-lGs3cZBUuChl2r_S3kCwY70FIiVQk0DuUT22Em3tqRZc2aHsrWL_uVvVsD5OjLaQGdLm6nVx5nMvshCPT36covwm7npWJE7NXzG28VVnE")`,
            }}
          ></div>
        </div>

        <div className="relative z-20 w-full max-w-[460px] flex flex-col bg-white dark:bg-[#2c2219] rounded-xl shadow-2xl border border-stone-200 dark:border-[#654d34] overflow-hidden">
          <div className="flex flex-col items-center pt-10 pb-6 px-8">
            <div className="mb-4 p-3 bg-[#cf7317]/10 rounded-full">
              <span className="material-symbols-outlined text-[#cf7317] text-[32px]">admin_panel_settings</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-center mb-1 dark:text-white">MirachPos</h1>
            <p className="text-sm text-stone-500 dark:text-[#c8ad93] text-center font-normal">Super Admin</p>
          </div>

          <div className="w-full px-8 pb-8">
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {error ? <div className="text-xs text-red-400 text-center">{error}</div> : null}

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">Email</span>
                <div className="relative flex items-center">
                  <span className="absolute left-4 text-[#c8ad93] material-symbols-outlined text-[20px]">mail</span>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="form-input flex w-full rounded-lg border border-stone-300 dark:border-[#654d34] bg-stone-50 dark:bg-[#32261a] h-12 pl-11 pr-4 text-base placeholder:text-stone-400 dark:placeholder:text-[#c8ad93]/50 focus:border-[#cf7317] focus:ring-1 focus:ring-[#cf7317] focus:outline-none transition-all dark:text-white"
                    placeholder="admin@mirachpos.com"
                    type="email"
                    autoComplete="email"
                  />
                </div>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">Password</span>
                <div className="relative flex items-center group">
                  <span className="absolute left-4 text-[#c8ad93] material-symbols-outlined text-[20px]">lock</span>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input flex w-full rounded-lg border border-stone-300 dark:border-[#654d34] bg-stone-50 dark:bg-[#32261a] h-12 pl-11 pr-12 text-base placeholder:text-stone-400 dark:placeholder:text-[#c8ad93]/50 focus:border-[#cf7317] focus:ring-1 focus:ring-[#cf7317] focus:outline-none transition-all dark:text-white"
                    placeholder="                "
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                  />
                  <button
                    className="absolute right-0 top-0 h-full px-3 text-[#c8ad93] hover:text-[#cf7317] transition-colors flex items-center justify-center"
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                  >
                    <span className="material-symbols-outlined text-[20px]">{showPw ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
              </label>

              <button
                disabled={loading || !emailLoginAllowed}
                className="mt-2 w-full h-12 bg-[#cf7317] hover:bg-[#b06213] text-white font-bold rounded-lg shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                type="submit"
              >
                <span>{loading ? 'Logging in...' : 'Log In'}</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>

              <button
                type="button"
                className="w-full text-xs font-semibold text-stone-500 dark:text-[#c8ad93] hover:text-[#cf7317] transition-colors"
                onClick={() => {
                  try {
                    window.location.pathname = '/';
                  } catch {
                  }
                }}
              >
                Back to customer login
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
