import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Modal } from './Modal';

interface FiscalSettingsModalProps {
    branchId: string | null;
    branchName: string;
    isOpen: boolean;
    onClose: () => void;
}

type BranchSettingsState = {
    fiscal: {
        enabled: boolean;
        provider: 'Generic' | 'EthioFiscal' | 'Simulator';
        ip: string;
        port: string;
        connectionType: 'Network' | 'LocalProxy';
        machineRegistrationNo: string;
        driverParams?: any;
    };
    [key: string]: any;
};

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
    <input
        {...props}
        className={`w-full h-10 bg-[#181611] border border-[#393328] text-white text-sm rounded-lg focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b] px-3 placeholder-[#544b3b] ${props.className}`}
    />
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
    <select
        {...props}
        className={`w-full h-10 bg-[#181611] border border-[#393328] text-white text-sm rounded-lg focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b] px-3 ${props.className}`}
    />
);

const Toggle: React.FC<{ checked: boolean; onChange: (next: boolean) => void; label?: string }> = ({ checked, onChange, label }) => (
    <label className="relative inline-flex items-center cursor-pointer" aria-label={label ?? 'toggle'}>
        <input checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" type="checkbox" />
        <div className="w-11 h-6 bg-[#393328] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#eead2b]"></div>
    </label>
);

export const FiscalSettingsModal: React.FC<FiscalSettingsModalProps> = ({ branchId, branchName, isOpen, onClose }) => {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState<BranchSettingsState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        if (!isOpen || !branchId) {
            setSettings(null);
            setError(null);
            setTestResult(null);
            return;
        }

        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await apiFetch(`/api/manager/settings?branchId=${encodeURIComponent(branchId)}`);
                const json = await res.json();
                if (!res.ok) throw new Error(json?.error || 'Failed to load settings');

                const s = json?.settings || {};
                // Ensure structure
                if (!s.fiscal) {
                    s.fiscal = {
                        enabled: false,
                        provider: 'Generic',
                        ip: '',
                        port: '',
                        connectionType: 'Network',
                        machineRegistrationNo: '',
                    };
                }
                setSettings(s);
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Load failed');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [isOpen, branchId]);

    const handleSave = async () => {
        if (!settings || !branchId) return;
        setSaving(true);
        setError(null);
        try {
            const res = await apiFetch(`/api/manager/settings?branchId=${encodeURIComponent(branchId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error || 'Failed to save');
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        if (!settings?.fiscal || !branchId) return;
        setTestResult(null);
        try {
            if (settings.fiscal.provider === 'Simulator') {
                setTestResult({ success: true, message: 'Simulator: Connection Successful! (Mock)' });
                return;
            }

            const res = await apiFetch(`/api/manager/settings/test-fiscal?branchId=${encodeURIComponent(branchId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ip: settings.fiscal.ip,
                    port: settings.fiscal.port,
                    provider: settings.fiscal.provider,
                }),
            });
            const json = await res.json();
            if (res.ok) {
                setTestResult({ success: true, message: json.message || 'Device is reachable.' });
            } else {
                setTestResult({ success: false, message: json.error || 'Connection failed.' });
            }
        } catch (e) {
            setTestResult({ success: false, message: e instanceof Error ? e.message : 'Network error' });
        }
    };

    if (!isOpen) return null;

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title={`Fiscal Configuration: ${branchName}`}
            footer={
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="h-10 px-4 rounded-lg bg-[#393328] hover:bg-[#4a4234] border border-[#544b3b] text-white font-bold transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || loading || !settings}
                        className="h-10 px-4 rounded-lg bg-[#eead2b] hover:bg-[#d49a26] text-[#181611] font-bold transition-colors disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            }
        >
            <div className="space-y-6">
                {loading && <div className="text-center text-[#b9b09d] py-8">Loading settings...</div>}
                {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-200 text-sm rounded-lg">{error}</div>}

                {!loading && settings && settings.fiscal && (
                    <>
                        <div className="flex items-center justify-between p-4 bg-[#221c10] border border-[#393328] rounded-xl">
                            <div>
                                <p className="text-white font-bold">Enable Fiscal Integration</p>
                                <p className="text-xs text-[#b9b09d]">Enable communication with the tax authority device.</p>
                            </div>
                            <Toggle
                                checked={settings.fiscal.enabled}
                                onChange={(enabled) => setSettings({ ...settings, fiscal: { ...settings.fiscal, enabled } })}
                            />
                        </div>

                        {settings.fiscal.enabled && (
                            <div className="space-y-4 p-4 border border-[#393328] rounded-xl bg-[#221c10]/50">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-[#b9b09d] uppercase mb-1 block">Driver / Provider</label>
                                        <Select
                                            value={settings.fiscal.provider}
                                            onChange={(e) => setSettings({ ...settings, fiscal: { ...settings.fiscal, provider: e.target.value as any } })}
                                        >
                                            <option value="Generic">Generic (TCP/IP)</option>
                                            <option value="EthioFiscal">EthioFiscal (Standard)</option>
                                            <option value="Simulator">Simulator (Test)</option>
                                        </Select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-[#b9b09d] uppercase mb-1 block">Connection Type</label>
                                        <Select
                                            value={settings.fiscal.connectionType}
                                            onChange={(e) => setSettings({ ...settings, fiscal: { ...settings.fiscal, connectionType: e.target.value as any } })}
                                        >
                                            <option value="Network">Network (IP)</option>
                                            <option value="LocalProxy">Local Proxy</option>
                                        </Select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="md:col-span-2">
                                        <label className="text-xs font-bold text-[#b9b09d] uppercase mb-1 block">Device IP / Proxy URL</label>
                                        <Input
                                            value={settings.fiscal.ip}
                                            onChange={(e) => setSettings({ ...settings, fiscal: { ...settings.fiscal, ip: e.target.value } })}
                                            placeholder="192.168.1.50"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-[#b9b09d] uppercase mb-1 block">Port</label>
                                        <Input
                                            value={settings.fiscal.port}
                                            onChange={(e) => setSettings({ ...settings, fiscal: { ...settings.fiscal, port: e.target.value } })}
                                            placeholder="9100"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-[#b9b09d] uppercase mb-1 block">Machine Registration No.</label>
                                    <Input
                                        value={settings.fiscal.machineRegistrationNo}
                                        onChange={(e) => setSettings({ ...settings, fiscal: { ...settings.fiscal, machineRegistrationNo: e.target.value } })}
                                        placeholder="MRC-XXXXXXXX"
                                    />
                                </div>

                                <div className="pt-2 flex items-center justify-between border-t border-[#393328] mt-2">
                                    <div className="text-xs text-[#b9b09d]">
                                        {testResult && (
                                            <span className={testResult.success ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                                                {testResult.message}
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleTest}
                                        className="text-xs font-bold text-[#eead2b] hover:text-white underline"
                                    >
                                        Test Connection
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
};
