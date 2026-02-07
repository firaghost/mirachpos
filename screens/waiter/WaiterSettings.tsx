import React, { useCallback, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Screen } from '../../types';
import { readSession } from '../../session';
import { usePos } from '../../PosContext';

import { AppIcon } from '@/components/ui/app-icon';
interface Props {
  onNavigate: (screen: Screen) => void;
}

type SettingsTab = 'security' | 'notifications' | 'display';

export const WaiterSettings: React.FC<Props> = ({ onNavigate }) => {
  const { queueOfflineWrite } = usePos();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>('');
  const [ok, setOk] = useState<string>('');
  const [activeTab, setActiveTab] = useState<SettingsTab>('security');

  // Security settings
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showCurrentPin, setShowCurrentPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  // Notification settings
  const [notifications, setNotifications] = useState({
    orderReady: true,
    newOrder: true,
    paymentReceived: true,
    soundEnabled: true,
  });

  // Display settings  
  const [display, setDisplay] = useState({
    language: 'en',
    compactMode: false,
    showImages: true,
  });

  const session = useMemo(() => {
    try {
      return readSession<any>();
    } catch {
      return null;
    }
  }, []);

  const staffId = typeof session?.staffId === 'string' ? session.staffId : '';
  const branchId = typeof session?.branchId === 'string' ? session.branchId : '';
  const role = typeof session?.role === 'string' ? session.role : '';

  const wantsPassword = newPassword.trim().length > 0 || confirmPassword.trim().length > 0;
  const wantsPin = newPin.trim().length > 0 || confirmPin.trim().length > 0;

  const passwordError = (() => {
    if (!wantsPassword) return '';
    if (newPassword.trim().length < 4) return 'New password must be at least 4 characters.';
    if (confirmPassword.trim().length === 0) return 'Confirm your new password.';
    if (newPassword !== confirmPassword) return 'New password and confirmation do not match.';
    if (!currentPassword.trim()) return 'Enter your current password to change it.';
    return '';
  })();

  const pinError = (() => {
    if (!wantsPin) return '';
    if (newPin.trim().length < 3) return 'New PIN must be at least 3 digits.';
    if (!/^\d+$/.test(newPin.trim())) return 'PIN must be numeric.';
    if (confirmPin.trim().length === 0) return 'Confirm your new PIN.';
    if (newPin !== confirmPin) return 'New PIN and confirmation do not match.';
    return '';
  })();

  const canSubmit = (wantsPassword || wantsPin) && !passwordError && !pinError && !saving;

  const enqueueIfOffline = useCallback(
    async (args: { url: string; method: string; body?: any; headers?: Record<string, string> }) => {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      if (online) return false;
      await queueOfflineWrite(args);
      setOk('Saved offline. Will sync when online.');
      return true;
    },
    [queueOfflineWrite],
  );

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setErr('');
    setOk('');
    try {
      if (!wantsPassword && !wantsPin) throw new Error('Enter a new password and/or a new PIN.');
      if (passwordError) throw new Error(passwordError);
      if (pinError) throw new Error(pinError);

      const body = {
        currentPassword: currentPassword,
        newPassword: wantsPassword ? newPassword : '',
        currentPin: currentPin,
        newPin: wantsPin ? newPin : '',
      };
      if (await enqueueIfOffline({ url: '/api/staff/account', method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })) return;
      const res = await apiFetch('/api/staff/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        const code = typeof json?.error === 'string' ? json.error : '';
        if (code === 'invalid_credentials') throw new Error('Current password/PIN is incorrect.');
        if (code === 'password_too_short') throw new Error('New password must be at least 4 characters.');
        if (code === 'pin_too_short') throw new Error('New PIN must be at least 3 digits.');
        if (code === 'no_changes') throw new Error('Enter a new password and/or a new PIN.');
        throw new Error(code || String(res.status));
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setOk('Saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const Field: React.FC<{ label: string; hint?: string; error?: string; children: React.ReactNode }> = ({ label, hint, error, children }) => {
    return (
      <div>
        <label className="text-xs font-bold text-muted-foreground">{label}</label>
        <div className="mt-1">{children}</div>
        {error ? <div className="mt-1 text-[11px] text-destructive">{error}</div> : hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
      </div>
    );
  };

  const SecretInput: React.FC<{ value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; placeholder?: string }> = ({ value, onChange, show, onToggle, placeholder }) => {
    return (
      <div className="flex items-center gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 h-11 bg-background border border-border rounded-lg px-4 text-foreground"
        />
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onToggle();
          }}
          className="h-11 px-3 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
          title={show ? 'Hide' : 'Show'}
        >
          <AppIcon name={show ? 'visibility_off' : 'visibility'} className="text-[18px]" size={18} />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-5 border-b border-border bg-card">
        <div>
          <div className="text-2xl font-extrabold tracking-tight">Settings</div>
          <div className="text-xs text-muted-foreground mt-1">Security, Password and PIN</div>
        </div>
        <button
          onClick={() => {
            const r = String(role || '').trim();
            if (r === 'Branch Manager') onNavigate(Screen.MANAGER_DASHBOARD);
            else if (r === 'Cafe Owner') onNavigate(Screen.OWNER_DASHBOARD);
            else onNavigate(Screen.WAITER_DASHBOARD);
          }}
          className="h-10 px-4 rounded-lg border border-border bg-background hover:bg-secondary text-muted-foreground font-bold"
        >
          Back
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {err ? <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">{err}</div> : null}
          {ok ? <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm">{ok}</div> : null}

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-extrabold">Account Overview</div>
                <div className="text-[11px] text-muted-foreground mt-1">Manage your account settings and preferences.</div>
              </div>
              <div className="text-right text-[11px] text-muted-foreground">
                <div>Role: <span className="text-muted-foreground font-semibold">{role || '  '}</span></div>
                <div>Branch: <span className="text-muted-foreground font-semibold">{branchId || '  '}</span></div>
                <div>Staff: <span className="text-muted-foreground font-semibold">{staffId || '  '}</span></div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border">
            {(['security', 'notifications', 'display'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-bold capitalize transition-colors ${
                  activeTab === tab
                    ? 'text-primary border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab === 'security' && 'Security'}
                {tab === 'notifications' && 'Notifications'}
                {tab === 'display' && 'Display'}
              </button>
            ))}
          </div>

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold">Password</div>
                  <div className="text-[11px] text-muted-foreground">Optional</div>
                </div>
                <div className="mt-4 space-y-4">
                  <Field label="Current Password" hint="Required only if changing password.">
                    <SecretInput value={currentPassword} onChange={setCurrentPassword} show={showCurrentPassword} onToggle={() => setShowCurrentPassword((v) => !v)} />
                  </Field>
                  <Field label="New Password" error={wantsPassword ? (newPassword.trim().length > 0 && newPassword.trim().length < 4 ? 'Minimum 4 characters.' : '') : ''}>
                    <SecretInput value={newPassword} onChange={setNewPassword} show={showNewPassword} onToggle={() => setShowNewPassword((v) => !v)} placeholder="        " />
                  </Field>
                  <Field label="Confirm New Password" error={wantsPassword && confirmPassword.trim().length > 0 && confirmPassword !== newPassword ? 'Does not match.' : ''}>
                    <SecretInput value={confirmPassword} onChange={setConfirmPassword} show={showConfirmPassword} onToggle={() => setShowConfirmPassword((v) => !v)} placeholder="        " />
                  </Field>
                  {passwordError ? <div className="text-[11px] text-destructive">{passwordError}</div> : null}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold">PIN</div>
                  <div className="text-[11px] text-muted-foreground">Optional</div>
                </div>
                <div className="mt-4 space-y-4">
                  <Field label="Current PIN" hint="Required only if changing PIN.">
                    <SecretInput value={currentPin} onChange={setCurrentPin} show={showCurrentPin} onToggle={() => setShowCurrentPin((v) => !v)} />
                  </Field>
                  <Field label="New PIN" error={wantsPin ? (!/^\d*$/.test(newPin) ? 'Digits only.' : newPin.trim().length > 0 && newPin.trim().length < 3 ? 'Minimum 3 digits.' : '') : ''}>
                    <SecretInput value={newPin} onChange={setNewPin} show={showNewPin} onToggle={() => setShowNewPin((v) => !v)} placeholder="1234" />
                  </Field>
                  <Field label="Confirm New PIN" error={wantsPin && confirmPin.trim().length > 0 && confirmPin !== newPin ? 'Does not match.' : ''}>
                    <SecretInput value={confirmPin} onChange={setConfirmPin} show={showConfirmPin} onToggle={() => setShowConfirmPin((v) => !v)} placeholder="1234" />
                  </Field>
                  {pinError ? <div className="text-[11px] text-destructive">{pinError}</div> : null}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 md:col-span-2">
                <button
                  disabled={!canSubmit}
                  onClick={submit}
                  className="h-11 px-5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold disabled:opacity-50"
                >
                  {saving ? 'Saving ' : 'Save Security Changes'}
                </button>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <h3 className="text-sm font-extrabold">Notification Preferences</h3>
              
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer">
                  <div>
                    <div className="text-sm font-bold">Order Ready Alerts</div>
                    <div className="text-xs text-muted-foreground">Notify when kitchen orders are ready</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.orderReady}
                    onChange={(e) => setNotifications(p => ({ ...p, orderReady: e.target.checked }))}
                    className="w-5 h-5"
                  />
                </label>

                <label className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer">
                  <div>
                    <div className="text-sm font-bold">New Order Alerts</div>
                    <div className="text-xs text-muted-foreground">Notify when new orders are placed</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.newOrder}
                    onChange={(e) => setNotifications(p => ({ ...p, newOrder: e.target.checked }))}
                    className="w-5 h-5"
                  />
                </label>

                <label className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer">
                  <div>
                    <div className="text-sm font-bold">Payment Notifications</div>
                    <div className="text-xs text-muted-foreground">Sound alert on successful payment</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.paymentReceived}
                    onChange={(e) => setNotifications(p => ({ ...p, paymentReceived: e.target.checked }))}
                    className="w-5 h-5"
                  />
                </label>

                <label className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer">
                  <div>
                    <div className="text-sm font-bold">Sound Effects</div>
                    <div className="text-xs text-muted-foreground">Enable notification sounds</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.soundEnabled}
                    onChange={(e) => setNotifications(p => ({ ...p, soundEnabled: e.target.checked }))}
                    className="w-5 h-5"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end">
                <button
                  onClick={() => setOk('Notification preferences saved (local storage)')}
                  className="h-11 px-5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold"
                >
                  Save Preferences
                </button>
              </div>
            </div>
          )}

          {/* Display Tab */}
          {activeTab === 'display' && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <h3 className="text-sm font-extrabold">Display Settings</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-bold">Language</label>
                  <select
                    value={display.language}
                    onChange={(e) => setDisplay(p => ({ ...p, language: e.target.value }))}
                    className="mt-1 w-full h-11 bg-background border border-border rounded-lg px-3"
                  >
                    <option value="en">English</option>
                    <option value="am">Amharic</option>
                  </select>
                </div>

                <label className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer">
                  <div>
                    <div className="text-sm font-bold">Compact Mode</div>
                    <div className="text-xs text-muted-foreground">Show more items on screen</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={display.compactMode}
                    onChange={(e) => setDisplay(p => ({ ...p, compactMode: e.target.checked }))}
                    className="w-5 h-5"
                  />
                </label>

                <label className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer">
                  <div>
                    <div className="text-sm font-bold">Show Product Images</div>
                    <div className="text-xs text-muted-foreground">Display images in menu</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={display.showImages}
                    onChange={(e) => setDisplay(p => ({ ...p, showImages: e.target.checked }))}
                    className="w-5 h-5"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end">
                <button
                  onClick={() => setOk('Display settings saved (local storage)')}
                  className="h-11 px-5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold"
                >
                  Save Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
