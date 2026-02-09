import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, resolveAssetUrl } from '../../api';
import { Screen } from '../../types';
import { Modal } from '../../components/Modal';
import { formatDeviceTime } from '../../datetime';
import { readSession } from '../../session';

import { AppIcon } from '@/components/ui/app-icon';
type SettingsTab = 'hardware' | 'general' | 'branch' | 'hours' | 'taxes' | 'integrations' | 'addons';

type InstalledIntegration = {
  id: string;
  integrationId: string;
  code: string;
  name: string;
  category: string;
  integrationType: string;
  isAvailable: boolean;
  status: string;
  installedAt: string;
  updatedAt: string;
};

type AddonSubscription = {
  id: string;
  addonId: string;
  code: string;
  name: string;
  category: string;
  status: string;
  billingFrequency: string;
  pricePaidEtb: number;
  activationDate: string;
  nextRenewalDate: string;
  cancellationDate: string;
};

type DeviceStatus = 'Online' | 'Offline';

type ConnectedDevice = {
  id: string;
  name: string;
  model: string;
  ip: string;
  port: string;
  connection: 'LAN' | 'USB' | 'whitetooth' | 'Cloud';
  setupMode: 'Auto' | 'Manual';
  whitetoothName?: string;
  cloudId?: string;
  printerName?: string;
  profile: 'Receipt' | 'Kitchen' | 'Bar';
  usage: string;
  kind: 'Printer' | 'KDS' | 'CashDrawer';
  status: DeviceStatus;
};

type BranchSettingsState = {
  branchName: string;
  managerName: string;
  managerRole: string;

  devices: ConnectedDevice[];

  defaultReceiptPrinterId: string | null;
  defaultKitchenPrinterId: string | null;
  fallbackKitchenPrinterId: string | null;
  defaultBarPrinterId: string | null;

  printerPrefs: {
    autoPrintReceipts: boolean;
    autoPrintKitchenTickets: boolean;
    kitchenTicketBeep: boolean;
    separateDrinkTickets: boolean;
  };

  receipt: {
    header: string;
    footer1: string;
    footer2: string;
  };

  general: {
    currency: string;
    language: string;
    enableSounds: boolean;
    enableOfflineMode: boolean;
  };

  loyalty: {
    earnRate: number;
    expiryDays: number | null;
  };

  branchInfo: {
    businessName: string;
    address: string;
    phone: string;
    tin: string;
  };

  operatingHours: {
    mon: string;
    tue: string;
    wed: string;
    thu: string;
    fri: string;
    sat: string;
    sun: string;
  };

  taxes: {
    vatEnabled: boolean;
    vatRate: number;
    serviceChargeEnabled: boolean;
    serviceChargeRate: number;
  };

  payments: {
    qrCodes: {
      telebirr: string;
      bank_transfer: string;
      card: string;
    };
    qrDetails: {
      telebirr: {
        image: string;
        accountName: string;
        phone: string;
        merchantId: string;
        note: string;
      };
      bank_transfer: {
        image: string;
        bankName: string;
        accountName: string;
        accountNumber: string;
        phone: string;
        note: string;
      };
      card: {
        image: string;
        merchantId: string;
        note: string;
      };
    };
    requireReferenceForMethods: string[];
  };

  fiscal: {
    enabled: boolean;
    provider: 'Generic' | 'EthioFiscal' | 'Simulator';
    connectionType: 'Network' | 'LocalProxy';
    ip: string;
    port: string;
    machineNumber: string;
  };
};

const uid = (prefix: string) => `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;

const deepEqual = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const openPrintWindow = (html: string) => {
  try {
    const w = window.open('', '_blank', 'width=420,height=700');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        // ignore
      }
    }, 250);
  } catch {
    // ignore
  }
};

const receiptHtml = (params: {
  businessName: string;
  address: string;
  phone: string;
  tin: string;
  showTin: boolean;
  footer1: string;
  footer2: string;
  currency: string;
  vatEnabled: boolean;
  vatRate: number;
  serviceEnabled: boolean;
  serviceRate: number;
  orderNumber: string;
  tableName: string;
  paymentMethod: string;
  paymentReference?: string;
  cashier?: string;
  waiter?: string;
  items: Array<{ name: string; qty: number; unitPrice: number }>;
}) => {
  const norm = (v: string) => String(v || '').trim().replace(/\s+/g, ' ');
  const normKey = (v: string) => norm(v).toLowerCase();
  const cur = escapeHtml(String(params.currency || 'ETB').toUpperCase());
  const payMethod = escapeHtml(String(params.paymentMethod || 'CASH').toUpperCase());
  const headerLines = (() => {
    const lines = [
      norm(params.businessName || '-'),
      norm(params.address || '-'),
      norm(params.phone || ''),
      params.showTin !== false ? norm(params.tin ? `TIN: ${params.tin}` : 'TIN: -') : '',
    ]
      .map((x) => norm(String(x || '')))
      .filter(Boolean);

    const out: string[] = [];
    const seen = new Set<string>();
    for (const l of lines) {
      const k = normKey(l);
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(l);
    }
    return out;
  })();

  const dt = new Date();
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = String(dt.getFullYear());
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  const dateStr = `${dd}/${mm}/${yyyy}`;
  const timeStr = `${hh}:${mi}`;

  const items = (params.items || [])
    .map((i) => {
      const name = escapeHtml(i.name);
      const qty = Number(i.qty) || 0;
      const unit = Number(i.unitPrice) || 0;
      const amount = unit * qty;
      return `
        <div class="item">
          <div class="d">${name}</div>
          <div class="q">${String(qty)}</div>
          <div class="p">${unit.toFixed(2)}</div>
          <div class="a">${amount.toFixed(2)}</div>
        </div>
      `;
    })
    .join('');

  const subtotal = (params.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const vat = params.vatEnabled ? (subtotal * (Number(params.vatRate) || 0)) / 100 : 0;
  const service = params.serviceEnabled ? (subtotal * (Number(params.serviceRate) || 0)) / 100 : 0;
  const total = subtotal + vat + service;

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Receipt</title>
      <style>
        @page{margin:10mm;}
        *{box-sizing:border-box;}
        html,body{height:100%;}
        body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin:0; padding:18px 12px; color:#111; background:#f3f4f6; display:flex; justify-content:center;}
        .paper{width:80mm; max-width:80mm; background:#fff; padding:12px; box-shadow:0 10px 30px rgba(0,0,0,.18); border:1px solid rgba(0,0,0,.08);}
        .c{text-align:center;}
        .b{font-weight:900;}
        .muted{color:#222;}
        .hr{border-top:2px dashed #444; margin:10px 0;}
        .hr2{border-top:2px solid #444; margin:10px 0;}
        .meta{display:flex; justify-content:space-between; gap:12px; font-size:12px;}
        .meta span:last-child{text-align:right;}
        .title{font-size:13px; font-weight:900; letter-spacing:.08em;}
        .itemsHead{display:grid; grid-template-columns: 1fr 48px 72px 86px; gap:8px; font-size:12px; font-weight:900;}
        .item{display:grid; grid-template-columns: 1fr 48px 72px 86px; gap:8px; font-size:12px; margin:4px 0;}
        .d{white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
        .q,.p,.a{text-align:right;}
        .tot{font-size:13px; font-weight:900;}
        @media print{
          body{padding:0; background:#fff; box-shadow:none;}
          .paper{box-shadow:none; border:none; padding:0; width:80mm; max-width:80mm;}
        }
      </style>
    </head>
    <body>
      <div class="paper">
      ${headerLines
      .map((l, idx) => {
        const k = normKey(l);
        const isTin = k.startsWith('tin');
        const cls = isTin ? 'c b' : idx === 0 ? 'c b' : 'c b';
        const fs = isTin ? '12px' : '12px';
        const mt = idx === 0 ? '0' : isTin ? '4px' : '2px';
        return `<div class="${cls}" style="font-size:${fs}; margin-top:${mt}">${escapeHtml(l)}</div>`;
      })
      .join('')}
      <div class="hr"></div>
      <div class="meta"><span class="b">FS NO.</span><span class="b">${escapeHtml(String(params.orderNumber || ''))}</span></div>
      <div class="meta" style="margin-top:6px"><span class="b">${escapeHtml(dateStr)}</span><span class="b">${escapeHtml(timeStr)}</span></div>
      <div class="hr2"></div>
      <div class="c title">=====${payMethod} INVOICE=====</div>
      <div class="meta" style="margin-top:8px"><span class="b">CUSTOMER NAME</span><span>WALKING</span></div>
      <div class="meta" style="margin-top:6px"><span class="b">CASHIER</span><span>${escapeHtml(String(params.cashier || '-'))}</span></div>
      <div class="meta" style="margin-top:6px"><span class="b">WAITER</span><span>${escapeHtml(String(params.waiter || params.cashier || '-'))}</span></div>
      <div class="meta" style="margin-top:6px"><span class="b">TABLE NO.</span><span>${escapeHtml(String(params.tableName || '-'))}</span></div>
      <div class="meta" style="margin-top:6px"><span class="b">BUYER'S TIN</span><span>-</span></div>
      ${params.paymentReference ? `<div class="meta" style="margin-top:6px"><span class="b">REFERENCE</span><span>${escapeHtml(String(params.paymentReference))}</span></div>` : ''}
      <div class="hr"></div>
      <div class="itemsHead"><div>DESCRIPTION</div><div class="q">QTY</div><div class="p">PRICE</div><div class="a">AMOUNT</div></div>
      ${items}
      <div class="hr"></div>
      <div class="meta"><span class="b">SUBTOTAL</span><span class="b">${cur} ${subtotal.toFixed(2)}</span></div>
      <div class="meta" style="margin-top:6px"><span class="b">TAX</span><span class="b">${cur} ${vat.toFixed(2)}</span></div>
      <div class="meta" style="margin-top:6px"><span class="b">SERVICE</span><span class="b">${cur} ${service.toFixed(2)}</span></div>
      <div class="hr2"></div>
      <div class="meta tot"><span class="b">TOTAL</span><span class="b">${cur} ${total.toFixed(2)}</span></div>
      <div class="hr"></div>
      ${params.footer1 ? `<div class="c muted" style="font-size:12px">${escapeHtml(params.footer1)}</div>` : ''}
      ${params.footer2 ? `<div class="c muted" style="font-size:12px; margin-top:4px">${escapeHtml(params.footer2)}</div>` : ''}
      <div class="c muted" style="font-size:11px; margin-top:6px">Powered by Mirach POS</div>
      </div>
    </body>
  </html>
  `;
};

const kitchenSampleHtml = (params: {
  title: string;
  tableName: string;
  orderNumber: string;
  placedBy: string;
  timeLabel?: string;
  notes?: string;
  lines: Array<{ name: string; qty: number; note?: string }>;
}) => {
  const header = escapeHtml(params.title || 'Kitchen Ticket');
  const table = escapeHtml(params.tableName || '');
  const number = escapeHtml(params.orderNumber || '');
  const time = escapeHtml(params.timeLabel || formatDeviceTime(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const placedBy = escapeHtml(params.placedBy || '-');
  const notes = params.notes ? `<div class="notes">${escapeHtml(params.notes)}</div>` : '';
  const items = (params.lines || [])
    .map((l) => {
      const note = l.note?.trim() ? `<div class="note">${escapeHtml(l.note)}</div>` : '';
      return `
        <div class="row">
          <div class="qty">${Number(l.qty) || 0}x</div>
          <div class="name">${escapeHtml(l.name)}${note}</div>
        </div>
      `;
    })
    .join('');

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${header}</title>
      <style>
        @page{margin:10mm;}
        *{box-sizing:border-box;}
        html,body{height:100%;}
        body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin:0; padding:18px 12px; color:#111; background:#f3f4f6; display:flex; justify-content:center;}
        .paper{width:80mm; max-width:80mm; background:#fff; padding:14px; box-shadow:0 10px 30px rgba(0,0,0,.18); border:1px solid rgba(0,0,0,.08);}
        .top{display:flex; justify-content:space-between; align-items:flex-start; gap:12px;}
        .brand{font-size:14px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;}
        .meta{font-size:12px; text-align:right;}
        .by{margin-top:6px; font-size:12px; font-weight:800;}
        .kds{margin-top:8px; font-size:22px; font-weight:900;}
        .hr{border-top:2px dashed #444; margin:12px 0;}
        .row{display:flex; gap:10px; padding:8px 0; border-bottom:1px dashed #bbb;}
        .qty{width:48px; font-size:18px; font-weight:900;}
        .name{flex:1; font-size:16px; font-weight:800;}
        .note{margin-top:4px; font-size:12px; font-weight:600; color:#333;}
        .notes{margin-top:8px; padding:8px; border:1px dashed #777; font-size:12px; font-weight:700;}
        @media print{
          body{padding:0; background:#fff;}
          .paper{box-shadow:none; border:none; padding:0; width:80mm; max-width:80mm;}
          .no-print{display:none}
        }
      </style>
    </head>
    <body>
      <div class="paper">
      <div class="top">
        <div>
          <div class="brand">${header}</div>
          <div class="kds">${table}    ${number}</div>
          <div class="by">Placed by: ${placedBy}</div>
        </div>
        <div class="meta"><div>${time}</div></div>
      </div>
      ${notes}
      <div class="hr"></div>
      ${items}
      <div class="hr"></div>
      <div class="no-print" style="font-size:12px;color:#666">Close this window after printing.</div>
      </div>
    </body>
  </html>
  `;
};

const Toggle: React.FC<{ checked: boolean; onChange: (next: boolean) => void; label?: string }> = ({ checked, onChange, label }) => (
  <label className="relative inline-flex items-center cursor-pointer" aria-label={label ?? 'toggle'}>
    <input checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" type="checkbox" />
    <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-background after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-background after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
  </label>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className={`w-full h-11 bg-background border border-border text-foreground text-sm rounded-lg focus:ring-1 focus:ring-primary focus:border-primary px-4 placeholder:text-muted-foreground ${props.className ?? ''}`}
  />
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select
    {...props}
    className={`w-full h-11 bg-background border border-border text-foreground text-sm rounded-lg focus:ring-1 focus:ring-primary focus:border-primary px-4 ${props.className ?? ''}`}
  />
);

const CheckboxRow: React.FC<{ checked: boolean; onChange: (next: boolean) => void; title: string; subtitle: string }> = ({ checked, onChange, title, subtitle }) => (
  <div className="p-4 flex items-center justify-between gap-4">
    <div>
      <p className="text-foreground font-bold text-sm">{title}</p>
      <p className="text-muted-foreground text-xs mt-1">{subtitle}</p>
    </div>
    <input checked={checked} onChange={(e) => onChange(e.target.checked)} type="checkbox" className="h-5 w-5 accent-primary" />
  </div>
);

export const BranchSettings: React.FC = () => {
  const defaultState = useMemo<BranchSettingsState>(() => {
    return {
      branchName: '',
      managerName: '',
      managerRole: '',
      devices: [],

      defaultReceiptPrinterId: null,
      defaultKitchenPrinterId: null,
      fallbackKitchenPrinterId: null,
      defaultBarPrinterId: null,
      printerPrefs: {
        autoPrintReceipts: false,
        autoPrintKitchenTickets: false,
        kitchenTicketBeep: false,
        separateDrinkTickets: false,
      },
      receipt: {
        header: '',
        footer1: '',
        footer2: '',
      },
      general: {
        currency: 'ETB',
        language: 'en',
        enableSounds: true,
        enableOfflineMode: false,
      },
      loyalty: {
        earnRate: 0,
        expiryDays: null,
      },
      branchInfo: {
        businessName: '',
        address: '',
        phone: '',
        tin: '',
      },
      operatingHours: {
        mon: '',
        tue: '',
        wed: '',
        thu: '',
        fri: '',
        sat: '',
        sun: '',
      },
      taxes: {
        vatEnabled: false,
        vatRate: 15,
        serviceChargeEnabled: false,
        serviceChargeRate: 10,
      },

      payments: {
        qrCodes: {
          telebirr: '',
          bank_transfer: '',
          card: '',
        },
        qrDetails: {
          telebirr: {
            image: '',
            accountName: '',
            phone: '',
            merchantId: '',
            note: '',
          },
          bank_transfer: {
            image: '',
            bankName: '',
            accountName: '',
            accountNumber: '',
            phone: '',
            note: '',
          },
          card: {
            image: '',
            merchantId: '',
            note: '',
          },
        },
        requireReferenceForMethods: ['mobile_money', 'bank_transfer', 'card'],
      },
      fiscal: {
        enabled: false,
        provider: 'Generic',
        connectionType: 'Network',
        ip: '',
        port: '',
        machineNumber: '',
      },
    };
  }, []);

  const [activeTab, setActiveTab] = useState<SettingsTab>('hardware');
  const [saved, setSaved] = useState<BranchSettingsState>(() => defaultState);
  const [draft, setDraft] = useState<BranchSettingsState>(() => defaultState);

  useEffect(() => {
    if (activeTab === 'integrations') void loadInstalledIntegrations();
    if (activeTab === 'addons') void loadAddonSubscriptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const resolveBranchId = () => {
    try {
      const s = readSession<any>();
      const bid = String(s?.branchId || '').trim();
      if (bid && bid !== 'global') return bid;
    } catch {
      // ignore
    }
    try {
      const raw = String(
        localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
          localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
          '',
      ).trim();
      if (raw && raw !== 'global') return raw;
    } catch {
      // ignore
    }
    return '';
  };

  const withBranchQuery = (url: string) => {
    const branchId = resolveBranchId();
    if (!branchId) return url;
    return url.includes('?') ? `${url}&branchId=${encodeURIComponent(branchId)}` : `${url}?branchId=${encodeURIComponent(branchId)}`;
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('read_failed'));
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
      r.readAsDataURL(file);
    });

  const uploadImage = async (file: File): Promise<string> => {
    const dataUrl = await readFileAsDataUrl(file);
    const res = await apiFetch(withBranchQuery('/api/manager/uploads/image'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, filename: file.name }),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const msg = typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const url = typeof json?.url === 'string' ? json.url.trim() : '';
    if (!url) throw new Error('upload_failed');
    return url;
  };

  const dirty = useMemo(() => !deepEqual(draft, saved), [draft, saved]);

  const [loadingRemote, setLoadingRemote] = useState(true);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteTenantId, setRemoteTenantId] = useState<string>('');
  const [remoteBranchId, setRemoteBranchId] = useState<string>('');

  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationsError, setIntegrationsError] = useState<string | null>(null);
  const [installedIntegrations, setInstalledIntegrations] = useState<InstalledIntegration[]>([]);

  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonsError, setAddonsError] = useState<string | null>(null);
  const [addonSubscriptions, setAddonSubscriptions] = useState<AddonSubscription[]>([]);

  const loadInstalledIntegrations = async () => {
    setIntegrationsLoading(true);
    setIntegrationsError(null);
    try {
      const res = await apiFetch(withBranchQuery('/api/manager/integrations'));
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.installed) ? json.installed : [];
      setInstalledIntegrations(
        rows.map((r: any) => ({
          id: String(r?.id || ''),
          integrationId: String(r?.integrationId || ''),
          code: String(r?.code || ''),
          name: String(r?.name || ''),
          category: String(r?.category || ''),
          integrationType: String(r?.integrationType || ''),
          isAvailable: Boolean(r?.isAvailable),
          status: String(r?.status || ''),
          installedAt: String(r?.installedAt || ''),
          updatedAt: String(r?.updatedAt || ''),
        })),
      );
    } catch (e) {
      setInstalledIntegrations([]);
      setIntegrationsError(e instanceof Error ? e.message : 'Failed to load integrations');
    } finally {
      setIntegrationsLoading(false);
    }
  };

  const loadAddonSubscriptions = async () => {
    setAddonsLoading(true);
    setAddonsError(null);
    try {
      const res = await apiFetch(withBranchQuery('/api/manager/addons'));
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.subscriptions) ? json.subscriptions : [];
      setAddonSubscriptions(
        rows.map((r: any) => ({
          id: String(r?.id || ''),
          addonId: String(r?.addonId || ''),
          code: String(r?.code || ''),
          name: String(r?.name || ''),
          category: String(r?.category || ''),
          status: String(r?.status || ''),
          billingFrequency: String(r?.billingFrequency || ''),
          pricePaidEtb: Number(r?.pricePaidEtb || 0) || 0,
          activationDate: String(r?.activationDate || ''),
          nextRenewalDate: String(r?.nextRenewalDate || ''),
          cancellationDate: String(r?.cancellationDate || ''),
        })),
      );
    } catch (e) {
      setAddonSubscriptions([]);
      setAddonsError(e instanceof Error ? e.message : 'Failed to load add-ons');
    } finally {
      setAddonsLoading(false);
    }
  };

  const saveSettings = async (nextSettings: BranchSettingsState) => {
    setRemoteError(null);
    const toPct = (raw: unknown) => {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? n : NaN;
    };

    const vatRate = toPct(nextSettings.taxes.vatRate);
    if (nextSettings.taxes.vatEnabled) {
      if (!Number.isFinite(vatRate)) {
        throw new Error('VAT rate is required.');
      }
      if (vatRate < 0 || vatRate > 100) {
        throw new Error('VAT rate must be between 0 and 100.');
      }
    }

    const earnRate = Number(nextSettings.loyalty?.earnRate ?? 0);
    if (!Number.isFinite(earnRate) || earnRate < 0) {
      throw new Error('Loyalty earn rate must be a positive number.');
    }
    const expiryDaysRaw = nextSettings.loyalty?.expiryDays;
    if (expiryDaysRaw != null) {
      const expiryDays = Number(expiryDaysRaw);
      if (!Number.isFinite(expiryDays) || expiryDays < 0) {
        throw new Error('Loyalty expiry days must be a positive number.');
      }
    }

    const svcRate = toPct(nextSettings.taxes.serviceChargeRate);
    if (nextSettings.taxes.serviceChargeEnabled) {
      if (!Number.isFinite(svcRate)) {
        throw new Error('Service charge rate is required.');
      }
      if (svcRate < 0 || svcRate > 100) {
        throw new Error('Service charge rate must be between 0 and 100.');
      }
    }

    const deviceIds = new Set((nextSettings.devices || []).map((d) => String(d?.id || '')).filter(Boolean));
    const normalized: BranchSettingsState = {
      ...nextSettings,
      taxes: {
        ...nextSettings.taxes,
        vatRate: Number.isFinite(vatRate) ? vatRate : nextSettings.taxes.vatRate,
        serviceChargeRate: Number.isFinite(svcRate) ? svcRate : nextSettings.taxes.serviceChargeRate,
      },
      defaultReceiptPrinterId:
        nextSettings.defaultReceiptPrinterId && !deviceIds.has(String(nextSettings.defaultReceiptPrinterId)) ? null : nextSettings.defaultReceiptPrinterId,
      defaultKitchenPrinterId:
        nextSettings.defaultKitchenPrinterId && !deviceIds.has(String(nextSettings.defaultKitchenPrinterId)) ? null : nextSettings.defaultKitchenPrinterId,
      fallbackKitchenPrinterId:
        nextSettings.fallbackKitchenPrinterId && !deviceIds.has(String(nextSettings.fallbackKitchenPrinterId)) ? null : nextSettings.fallbackKitchenPrinterId,
      defaultBarPrinterId:
        nextSettings.defaultBarPrinterId && !deviceIds.has(String(nextSettings.defaultBarPrinterId)) ? null : nextSettings.defaultBarPrinterId,
    };

    setDraft(normalized);

    const res = await apiFetch(withBranchQuery('/api/manager/settings'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: normalized }),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const msg = typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const nextFromServer = json?.settings && typeof json.settings === 'object' ? json.settings : normalized;
    setRemoteTenantId(String(json?.tenantId || remoteTenantId || ''));
    setRemoteBranchId(String(json?.branchId || remoteBranchId || ''));
    const merged = mergeIncoming(defaultState, nextFromServer);
    setSaved(merged);
    setDraft(merged);

    try {
      const rr = await apiFetch(withBranchQuery('/api/manager/settings'));
      const jj = (await rr.json().catch(() => null)) as any;
      if (rr.ok) {
        setRemoteTenantId(String(jj?.tenantId || remoteTenantId || ''));
        setRemoteBranchId(String(jj?.branchId || remoteBranchId || ''));
        const incoming = jj?.settings && typeof jj.settings === 'object' ? jj.settings : {};
        const merged2 = mergeIncoming(defaultState, incoming);
        setSaved(merged2);
        setDraft(merged2);
      }
    } catch {
      // ignore
    }

    try {
      localStorage.setItem('mirachpos.branchSettings.v1', JSON.stringify(merged));
      localStorage.removeItem('mirachpos.branchSettings.draft.v1');
    } catch {
      // ignore
    }
  };

  const mergeIncoming = (base: BranchSettingsState, incoming: any): BranchSettingsState => {
    const next = incoming && typeof incoming === 'object' ? incoming : {};
    const incomingPayments = next?.payments && typeof next.payments === 'object' ? next.payments : {};
    const incomingQrCodes = incomingPayments?.qrCodes && typeof incomingPayments.qrCodes === 'object' ? incomingPayments.qrCodes : {};
    const incomingQrDetails = incomingPayments?.qrDetails && typeof incomingPayments.qrDetails === 'object' ? incomingPayments.qrDetails : {};
    return {
      ...base,
      ...next,
      printerPrefs: { ...base.printerPrefs, ...(next.printerPrefs ?? {}) },
      receipt: { ...base.receipt, ...(next.receipt ?? {}) },
      general: { ...base.general, ...(next.general ?? {}) },
      loyalty: { ...base.loyalty, ...(next.loyalty ?? {}) },
      branchInfo: { ...base.branchInfo, ...(next.branchInfo ?? {}) },
      operatingHours: { ...base.operatingHours, ...(next.operatingHours ?? {}) },
      taxes: { ...base.taxes, ...(next.taxes ?? {}) },
      payments: {
        ...base.payments,
        ...incomingPayments,
        qrCodes: {
          ...base.payments.qrCodes,
          ...incomingQrCodes,
        },
        qrDetails: {
          ...base.payments.qrDetails,
          ...incomingQrDetails,
          telebirr: {
            ...base.payments.qrDetails.telebirr,
            ...((incomingQrDetails as any)?.telebirr ?? {}),
          },
          bank_transfer: {
            ...base.payments.qrDetails.bank_transfer,
            ...((incomingQrDetails as any)?.bank_transfer ?? {}),
          },
          card: {
            ...base.payments.qrDetails.card,
            ...((incomingQrDetails as any)?.card ?? {}),
          },
        },
        requireReferenceForMethods: Array.isArray((incomingPayments as any)?.requireReferenceForMethods)
          ? ((incomingPayments as any).requireReferenceForMethods as any)
          : base.payments.requireReferenceForMethods,
      },
      fiscal: { ...base.fiscal, ...(next.fiscal ?? {}) },
      devices: Array.isArray(next.devices) ? (next.devices as ConnectedDevice[]) : base.devices,
    };
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setLoadingRemote(true);
      setRemoteError(null);
      try {
        const res = await apiFetch(withBranchQuery('/api/manager/settings'));
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          const msg = typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        const s = json?.settings;
        const incoming = s && typeof s === 'object' ? s : {};
        if (!mounted) return;
        setRemoteTenantId(String(json?.tenantId || ''));
        setRemoteBranchId(String(json?.branchId || ''));
        const merged = mergeIncoming(defaultState, incoming);
        setSaved(merged);
        setDraft(merged);
        try {
          localStorage.setItem('mirachpos.branchSettings.v1', JSON.stringify(merged));
        } catch {
          // ignore
        }
      } catch (e) {
        if (!mounted) return;
        setRemoteError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!mounted) return;
        setLoadingRemote(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch('/api/pos/settings');
        const json = (await res.json().catch(() => null)) as any;
        if (!mounted) return;
        if (!res.ok) return;
        const name = typeof json?.business?.businessName === 'string' ? json.business.businessName.trim() : '';
        setOwnerBusinessName(name);
      } catch {
        if (!mounted) return;
        setOwnerBusinessName('');
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const [addOpen, setAddOpen] = useState(false);
  const [editDeviceId, setEditDeviceId] = useState<string | null>(null);
  const [deviceFormState, setDeviceFormState] = useState<ConnectedDevice | null>(null);
  const [settingsDevice, setSettingsDevice] = useState<ConnectedDevice | null>(null);
  const [settingsDeviceDraft, setSettingsDeviceDraft] = useState<ConnectedDevice | null>(null);
  const [testPrintDevice, setTestPrintDevice] = useState<ConnectedDevice | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [ownerBusinessName, setOwnerBusinessName] = useState<string>('');
  const [testPrintStatus, setTestPrintStatus] = useState<string>('');

  const addDisabled = useMemo(() => {
    if (!deviceFormState) return true;
    if (!deviceFormState.name.trim()) return true;
    if (deviceFormState.connection === 'LAN') return !deviceFormState.ip.trim() || !deviceFormState.port.trim();
    if (deviceFormState.connection === 'whitetooth') return !deviceFormState.whitetoothName?.trim();
    if (deviceFormState.connection === 'Cloud') return !deviceFormState.cloudId?.trim();
    return true;
  }, [deviceFormState]);

  const canUsewhitetooth = useMemo(() => {
    try {
      return typeof (navigator as unknown as { whitetooth?: unknown }).whitetooth !== 'undefined';
    } catch {
      return false;
    }
  }, []);

  const currentTabMeta = useMemo(() => {
    const map: Record<SettingsTab, { title: string; crumb: string; subtitle: string }> = {
      hardware: {
        title: 'Printers & Hardware',
        crumb: 'Hardware',
        subtitle: `Manage connected POS printers, KDS screens, and cash drawer settings for the ${draft.branchName} branch.`,
      },
      general: {
        title: 'General Preferences',
        crumb: 'Preferences',
        subtitle: 'Configure operational defaults, system behavior, and POS experience settings.',
      },
      branch: {
        title: 'Branch Info',
        crumb: 'Branch',
        subtitle: 'Maintain the branch profile details used on receipts, reports, and compliance documents.',
      },
      hours: {
        title: 'Operating Hours',
        crumb: 'Hours',
        subtitle: 'Define opening hours used for reporting, scheduling expectations, and time-based automations.',
      },
      taxes: {
        title: 'Taxes & Service',
        crumb: 'Taxes',
        subtitle: 'Configure tax rates and service charges applied at checkout and displayed on receipts.',
      },
      integrations: {
        title: 'Integrations',
        crumb: 'Integrations',
        subtitle: 'View which tenant integrations are installed and currently active (managed by owner).',
      },
      addons: {
        title: 'Add-ons',
        crumb: 'Add-ons',
        subtitle: 'View which add-ons are active for this tenant (managed by owner subscription).',
      },
    };
    return map[activeTab];
  }, [activeTab, draft.branchName]);

  useEffect(() => {
    const normalize = (raw: string): SettingsTab | null => {
      const v = raw.replace('#', '').trim().toLowerCase();
      if (v === 'hardware' || v === 'general' || v === 'branch' || v === 'hours' || v === 'taxes' || v === 'integrations' || v === 'addons') return v;
      return null;
    };

    const applyFromHash = () => {
      const next = normalize(window.location.hash);
      if (next) setActiveTab(next);
    };

    applyFromHash();
    window.addEventListener('hashchange', applyFromHash);
    return () => window.removeEventListener('hashchange', applyFromHash);
  }, []);

  useEffect(() => {
    const current = window.location.hash.replace('#', '').trim().toLowerCase();
    if (current !== activeTab) {
      try {
        window.location.hash = activeTab;
      } catch {
        // ignore
      }
    }
  }, [activeTab]);

  const saveAll = async () => {
    try {
      await saveSettings(draft);
    } catch (e) {
      setRemoteError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const discard = () => {
    setDraft(saved);
  };

  const upsertDevice = (next: ConnectedDevice) => {
    setDraft((prev) => {
      const exists = prev.devices.some((d) => d.id === next.id);
      if (!exists) return { ...prev, devices: [next, ...prev.devices] };
      return { ...prev, devices: prev.devices.map((d) => (d.id === next.id ? next : d)) };
    });
  };

  useEffect(() => {
    if (!settingsDevice) {
      setSettingsDeviceDraft(null);
      return;
    }
    setSettingsDeviceDraft({
      connection: 'LAN',
      setupMode: 'Manual',
      whitetoothName: '',
      cloudId: '',
      profile:
        (settingsDevice as Partial<ConnectedDevice>).profile ??
        ((settingsDevice.usage || '').toLowerCase().includes('drink') ? 'Bar' : (settingsDevice.usage || '').toLowerCase().includes('food') ? 'Kitchen' : 'Receipt'),
      ...settingsDevice,
    });
  }, [settingsDevice]);

  const removeDevice = (id: string) => {
    setDraft((prev) => ({ ...prev, devices: prev.devices.filter((d) => d.id !== id) }));
  };

  const reconnectDevice = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      devices: prev.devices.map((d) => (d.id === id ? { ...d, status: 'Online' } : d)),
    }));
  };

  const openAddDevice = () => {
    setAddOpen(true);
    setEditDeviceId('NEW');
    setDeviceFormState({
      id: 'NEW',
      name: '',
      model: '',
      ip: '',
      port: '9100',
      connection: 'LAN',
      setupMode: 'Manual',
      whitetoothName: '',
      cloudId: '',
      printerName: '',
      profile: 'Receipt',
      usage: '',
      kind: 'Printer',
      status: 'Online',
    });
  };

  const openEditDevice = (device: ConnectedDevice) => {
    setAddOpen(true);
    setEditDeviceId(device.id);
    setDeviceFormState({
      connection: 'LAN',
      setupMode: 'Manual',
      whitetoothName: '',
      cloudId: '',
      profile:
        (device as Partial<ConnectedDevice>).profile ??
        ((device.usage || '').toLowerCase().includes('drink') ? 'Bar' : (device.usage || '').toLowerCase().includes('food') ? 'Kitchen' : 'Receipt'),
      ...device,
    });
  };

  return (
    <div className="flex flex-col h-full max-h-screen overflow-y-auto bg-background">
      <div className="flex flex-col min-h-0">
        {/* Page Header */}
        <div className="px-6 py-6 md:px-10 md:py-8 border-b border-border bg-background">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <span>Settings</span>
                  <AppIcon name="chevron_right" className="text-sm" size={14} />
                  <span className="text-primary">{currentTabMeta.crumb}</span>
                </div>
                <h1 className="text-foreground text-3xl md:text-4xl font-extrabold leading-tight tracking-[-0.033em]">{currentTabMeta.title}</h1>
                <p className="text-muted-foreground text-base font-normal leading-normal max-w-3xl">{currentTabMeta.subtitle}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  disabled={!dirty}
                  onClick={discard}
                  className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Discard
                </button>
                <button
                  disabled={!dirty}
                  onClick={saveAll}
                  className="h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-extrabold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Settings
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pt-2">
              <button
                onClick={() => setActiveTab('hardware')}
                className={`h-10 px-4 rounded-lg border flex items-center gap-2 text-sm font-bold transition-colors ${activeTab === 'hardware' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
              >
                <AppIcon name="print" className="text-lg" size={18} />
                Printers &amp; Hardware
              </button>
              <button
                onClick={() => setActiveTab('general')}
                className={`h-10 px-4 rounded-lg border flex items-center gap-2 text-sm font-bold transition-colors ${activeTab === 'general' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
              >
                <AppIcon name="tune" className="text-lg" size={18} />
                General Preferences
              </button>
              <button
                onClick={() => setActiveTab('branch')}
                className={`h-10 px-4 rounded-lg border flex items-center gap-2 text-sm font-bold transition-colors ${activeTab === 'branch' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
              >
                <AppIcon name="store" className="text-lg" size={18} />
                Branch Info
              </button>
              <button
                onClick={() => setActiveTab('hours')}
                className={`h-10 px-4 rounded-lg border flex items-center gap-2 text-sm font-bold transition-colors ${activeTab === 'hours' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
              >
                <AppIcon name="schedule" className="text-lg" size={18} />
                Operating Hours
              </button>
              <button
                onClick={() => setActiveTab('taxes')}
                className={`h-10 px-4 rounded-lg border flex items-center gap-2 text-sm font-bold transition-colors ${activeTab === 'taxes' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
              >
                <AppIcon name="percent" className="text-lg" size={18} />
                Taxes &amp; Service
              </button>

              <button
                onClick={() => setActiveTab('integrations')}
                className={`h-10 px-4 rounded-lg border flex items-center gap-2 text-sm font-bold transition-colors ${activeTab === 'integrations' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
              >
                <AppIcon name="extension" className="text-lg" size={18} />
                Integrations
              </button>

              <button
                onClick={() => setActiveTab('addons')}
                className={`h-10 px-4 rounded-lg border flex items-center gap-2 text-sm font-bold transition-colors ${activeTab === 'addons' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
              >
                <AppIcon name="widgets" className="text-lg" size={18} />
                Add-ons
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 md:p-10 space-y-10 bg-background">
          {activeTab === 'hardware' && (
            <>
              {/* Connected Printers Section */}
              <section>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <h2 className="text-foreground text-xl font-bold leading-tight">Connected Devices</h2>
                  <button
                    onClick={() => {
                      openAddDevice();
                    }}
                    className="flex cursor-pointer items-center justify-center overflow-hidden rounded-lg h-10 px-5 bg-primary hover:bg-primary/90 text-primary-foreground gap-2 text-sm font-bold leading-normal tracking-[0.015em] transition-colors shadow-lg shadow-primary/20"
                  >
                    <AppIcon name="add" className="text-xl" size={20} />
                    <span>Add New Device</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {draft.devices.map((d) => {
                    const online = d.status === 'Online';
                    return (
                      <div key={d.id} className="group relative flex flex-col bg-card rounded-xl border border-border hover:border-primary/50 transition-all duration-300 overflow-hidden">
                        <div className="p-5 flex flex-col h-full">
                          <div className="flex justify-between items-start mb-4">
                            <div className="size-12 rounded-lg bg-secondary flex items-center justify-center text-foreground">
                              <AppIcon name={d.kind === 'KDS' ? 'tv' : d.kind === 'CashDrawer' ? 'point_of_sale' : d.usage.toLowerCase().includes('kitchen') ? 'restaurant' : 'print'} className="text-2xl" size={24} />
                            </div>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${online
                                ? 'bg-green-500/10 text-green-500 ring-green-500/20'
                                : 'bg-red-500/10 text-red-400 ring-red-500/20'
                                }`}
                            >
                              <span className={`size-1.5 rounded-full ${online ? 'bg-green-500' : 'bg-red-400'}`}></span>
                              {d.status}
                            </span>
                          </div>
                          <div className="mb-4">
                            <h3 className="text-foreground font-bold text-lg">{d.name}</h3>
                            <p className="text-muted-foreground text-sm">{d.model || ' ”'}</p>
                          </div>
                          <div className="space-y-2 mb-6">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Connection</span>
                              <span className="text-foreground">{d.connection}</span>
                            </div>
                            {d.connection === 'LAN' && (
                              <>
                                <div className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">IP Address</span>
                                  <span className="text-foreground font-mono">{d.ip}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">Port</span>
                                  <span className="text-foreground font-mono">{d.port}</span>
                                </div>
                              </>
                            )}
                            {d.connection === 'whitetooth' && (
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">whitetooth</span>
                                <span className="text-foreground">{d.whitetoothName || ' ”'}</span>
                              </div>
                            )}
                            {d.connection === 'Cloud' && (
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Cloud ID</span>
                                <span className="text-foreground font-mono">{d.cloudId || ' ”'}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Usage</span>
                              <span className="text-foreground">{d.usage || ' ”'}</span>
                            </div>
                          </div>
                          <div className="mt-auto flex gap-3 border-t border-border pt-4">
                            <button
                              onClick={() => setTestPrintDevice(d)}
                              className="flex-1 h-9 rounded bg-secondary hover:bg-secondary/80 text-foreground text-xs font-bold transition-colors"
                            >
                              Test Print
                            </button>
                            {!online ? (
                              <button
                                onClick={() => reconnectDevice(d.id)}
                                className="size-9 rounded bg-secondary hover:bg-secondary/80 text-foreground flex items-center justify-center transition-colors"
                                title="Reconnect"
                              >
                                <AppIcon name="sync" className="text-sm" size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setSettingsDevice(d);
                                }}
                                className="size-9 rounded bg-secondary hover:bg-secondary/80 text-foreground flex items-center justify-center transition-colors"
                                title="Settings"
                              >
                                <AppIcon name="settings" className="text-sm" size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                openEditDevice(d);
                              }}
                              className="size-9 rounded bg-secondary hover:bg-secondary/80 text-foreground flex items-center justify-center transition-colors"
                              title="Edit"
                            >
                              <AppIcon name="edit" className="text-sm" size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="absolute top-0 left-0 w-1 h-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="max-w-4xl">
                <h2 className="text-foreground text-xl font-bold leading-tight mb-6">Printer Routing</h2>
                <div className="rounded-xl border border-border bg-card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-bold text-muted-foreground">Receipt Printer</label>
                    <Select
                      value={draft.defaultReceiptPrinterId ?? ''}
                      onChange={(e) => setDraft((p) => ({ ...p, defaultReceiptPrinterId: e.target.value || null }))}
                      className="mt-2"
                    >
                      <option value="">None</option>
                      {draft.devices
                        .filter((d) => d.kind === 'Printer')
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.connection})
                          </option>
                        ))}
                    </Select>
                    <p className="text-muted-foreground text-xs mt-2">For payment receipts.</p>
                  </div>

                  <div>
                    <label className="text-sm font-bold text-muted-foreground">Kitchen Printer</label>
                    <Select
                      value={draft.defaultKitchenPrinterId ?? ''}
                      onChange={(e) => setDraft((p) => ({ ...p, defaultKitchenPrinterId: e.target.value || null }))}
                      className="mt-2"
                    >
                      <option value="">None</option>
                      {draft.devices
                        .filter((d) => d.kind === 'Printer')
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.connection})
                          </option>
                        ))}
                    </Select>
                    <p className="text-muted-foreground text-xs mt-2">For kitchen order tickets.</p>
                  </div>

                  <div>
                    <label className="text-sm font-bold text-muted-foreground">Kitchen Fallback Printer</label>
                    <Select
                      value={draft.fallbackKitchenPrinterId ?? ''}
                      onChange={(e) => setDraft((p) => ({ ...p, fallbackKitchenPrinterId: e.target.value || null }))}
                      className="mt-2"
                    >
                      <option value="">None</option>
                      {draft.devices
                        .filter((d) => d.kind === 'Printer')
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.connection})
                          </option>
                        ))}
                    </Select>
                    <p className="text-muted-foreground text-xs mt-2">Used when the primary kitchen printer fails.</p>
                  </div>

                  <div>
                    <label className="text-sm font-bold text-muted-foreground">Bar/Drinks Printer</label>
                    <Select
                      value={draft.defaultBarPrinterId ?? ''}
                      onChange={(e) => setDraft((p) => ({ ...p, defaultBarPrinterId: e.target.value || null }))}
                      className="mt-2"
                    >
                      <option value="">None</option>
                      {draft.devices
                        .filter((d) => d.kind === 'Printer')
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.connection})
                          </option>
                        ))}
                    </Select>
                    <p className="text-muted-foreground text-xs mt-2">Used when drink tickets are separated.</p>
                  </div>
                </div>
              </section>

              {/* Fiscal Printer Configuration */}
              <section className="max-w-4xl">
                <h2 className="text-foreground text-xl font-bold leading-tight mb-6">Fiscal Printer Integration (ERCA)</h2>
                <div className="rounded-xl border border-border bg-card divide-y divide-border">
                  <div className="p-5 flex items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2 rounded-lg bg-secondary text-foreground hidden sm:block">
                        <AppIcon name="gavel" />
                      </div>
                      <div>
                        <p className="text-foreground font-bold text-base">Enable Fiscal Printer</p>
                        <p className="text-muted-foreground text-sm mt-0.5">Connect to an ERCA-compliant fiscal device for tax reporting.</p>
                      </div>
                    </div>
                    <Toggle
                      checked={draft.fiscal.enabled}
                      onChange={(next) => setDraft((p) => ({ ...p, fiscal: { ...p.fiscal, enabled: next } }))}
                      label="Enable Fiscal Printer"
                    />
                  </div>

                  {draft.fiscal.enabled && (
                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-bold text-muted-foreground">Fiscal Driver / Provider</label>
                        <Select
                          value={draft.fiscal.provider}
                          onChange={(e) => setDraft((p) => ({ ...p, fiscal: { ...p.fiscal, provider: e.target.value as any } }))}
                          className="mt-2"
                        >
                          <option value="Generic">Generic / Other</option>
                          <option value="EthioFiscal">EthioFiscal (Datecs/Daisy)</option>
                          <option value="Simulator">Simulator (Test Mode)</option>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-bold text-muted-foreground">Connection Type</label>
                        <Select
                          value={draft.fiscal.connectionType}
                          onChange={(e) => setDraft((p) => ({ ...p, fiscal: { ...p.fiscal, connectionType: e.target.value as any } }))}
                          className="mt-2"
                        >
                          <option value="Network">Network (TCP/IP)</option>
                          <option value="LocalProxy">Local Driver Proxy (URL)</option>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-bold text-muted-foreground">Device IP / Proxy URL</label>
                        <Input
                          value={draft.fiscal.ip}
                          onChange={(e) => setDraft((p) => ({ ...p, fiscal: { ...p.fiscal, ip: e.target.value } }))}
                          placeholder={draft.fiscal.connectionType === 'Network' ? '192.168.x.x' : 'http://localhost:8080'}
                          className="mt-2"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-bold text-muted-foreground">{draft.fiscal.connectionType === 'Network' ? 'Port' : 'Port (Optional)'}</label>
                        <Input
                          value={draft.fiscal.port}
                          onChange={(e) => setDraft((p) => ({ ...p, fiscal: { ...p.fiscal, port: e.target.value } }))}
                          placeholder={draft.fiscal.connectionType === 'Network' ? 'e.g. 8000' : ''}
                          className="mt-2"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-bold text-muted-foreground">Machine Registration No.</label>
                        <Input
                          value={draft.fiscal.machineNumber}
                          onChange={(e) => setDraft((p) => ({ ...p, fiscal: { ...p.fiscal, machineNumber: e.target.value } }))}
                          placeholder="FS No..."
                          className="mt-2"
                        />
                        <p className="text-muted-foreground text-xs mt-1">Printed on receipts as FS No.</p>
                      </div>
                      <div className="md:col-span-2 mt-2">
                        <div className="p-4 rounded-lg bg-card border border-border flex items-center justify-between">
                          <div>
                            <p className="text-foreground text-sm font-bold">Connection Status</p>
                            <p className="text-muted-foreground text-xs">Test connectivity to the fiscal device.</p>
                          </div>
                          <button
                            onClick={async () => {
                              try {
                                setRemoteError(null);
                                if (draft.fiscal.provider === 'Simulator') {
                                  alert('Simulator: Connection Successful! (Mock)');
                                  return;
                                }

                                const res = await apiFetch(withBranchQuery('/api/manager/settings/test-fiscal'), {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    ip: draft.fiscal.ip,
                                    port: draft.fiscal.port,
                                    provider: draft.fiscal.provider
                                  }),
                                });
                                const json = await res.json();
                                if (res.ok) {
                                  alert('SUCCESS: ' + (json.message || 'Device is reachable.'));
                                } else {
                                  alert('FAILED: ' + (json.error || 'Could not connect.'));
                                }
                              } catch (e) {
                                alert('ERROR: ' + (e instanceof Error ? e.message : 'Network error'));
                              }
                            }}
                            className="h-9 px-4 rounded bg-secondary hover:bg-secondary/80 border border-border text-foreground text-xs font-bold transition-colors"
                          >
                            Test Connection
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Configuration Options */}
              <section className="max-w-4xl">
                <h2 className="text-foreground text-xl font-bold leading-tight mb-6">Printer Preferences</h2>
                <div className="rounded-xl border border-border bg-card divide-y divide-border">
                  <div className="p-5 flex items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2 rounded-lg bg-secondary text-foreground hidden sm:block">
                        <AppIcon name="receipt" />
                      </div>
                      <div>
                        <p className="text-foreground font-bold text-base">Auto-print Receipts</p>
                        <p className="text-muted-foreground text-sm mt-0.5">Automatically print customer receipt after payment is successful.</p>
                      </div>
                    </div>
                    <Toggle
                      checked={draft.printerPrefs.autoPrintReceipts}
                      onChange={(next) => setDraft((p) => ({ ...p, printerPrefs: { ...p.printerPrefs, autoPrintReceipts: next } }))}
                      label="Auto-print Receipts"
                    />
                  </div>
                  <div className="p-5 flex items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2 rounded-lg bg-secondary text-foreground hidden sm:block">
                        <AppIcon name="print" />
                      </div>
                      <div>
                        <p className="text-foreground font-bold text-base">Auto-print Kitchen Tickets</p>
                        <p className="text-muted-foreground text-sm mt-0.5">Automatically open print dialog when an order is sent to kitchen.</p>
                      </div>
                    </div>
                    <Toggle
                      checked={draft.printerPrefs.autoPrintKitchenTickets}
                      onChange={(next) => setDraft((p) => ({ ...p, printerPrefs: { ...p.printerPrefs, autoPrintKitchenTickets: next } }))}
                      label="Auto-print Kitchen Tickets"
                    />
                  </div>
                  <div className="p-5 flex items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2 rounded-lg bg-secondary text-foreground hidden sm:block">
                        <AppIcon name="soup_kitchen" />
                      </div>
                      <div>
                        <p className="text-foreground font-bold text-base">Kitchen Ticket Beep</p>
                        <p className="text-muted-foreground text-sm mt-0.5">Sound an alarm on kitchen printers when a new order arrives.</p>
                      </div>
                    </div>
                    <Toggle
                      checked={draft.printerPrefs.kitchenTicketBeep}
                      onChange={(next) => setDraft((p) => ({ ...p, printerPrefs: { ...p.printerPrefs, kitchenTicketBeep: next } }))}
                      label="Kitchen Ticket Beep"
                    />
                  </div>
                  <div className="p-5 flex items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2 rounded-lg bg-secondary text-foreground hidden sm:block">
                        <AppIcon name="local_bar" />
                      </div>
                      <div>
                        <p className="text-foreground font-bold text-base">Separate Drink Tickets</p>
                        <p className="text-muted-foreground text-sm mt-0.5">Print drink tickets to the bar printer separately from kitchen tickets.</p>
                      </div>
                    </div>
                    <Toggle
                      checked={draft.printerPrefs.separateDrinkTickets}
                      onChange={(next) => setDraft((p) => ({ ...p, printerPrefs: { ...p.printerPrefs, separateDrinkTickets: next } }))}
                      label="Separate Drink Tickets"
                    />
                  </div>
                </div>
              </section>

              <section className="max-w-4xl">
                <div className="flex items-center justify-between gap-4 mb-6">
                  <h2 className="text-foreground text-xl font-bold leading-tight">Receipt Customization</h2>
                  <button
                    onClick={() => setPreviewOpen(true)}
                    className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-sm font-bold"
                  >
                    Preview Receipt
                  </button>
                </div>
                <div className="rounded-xl border border-border bg-card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="text-sm font-bold text-muted-foreground">Header</label>
                    <Input value={draft.receipt.header} onChange={(e) => setDraft((p) => ({ ...p, receipt: { ...p.receipt, header: e.target.value } }))} placeholder="Store name, address " className="mt-2" />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted-foreground">Footer Line 1</label>
                    <Input value={draft.receipt.footer1} onChange={(e) => setDraft((p) => ({ ...p, receipt: { ...p.receipt, footer1: e.target.value } }))} placeholder="Thank you message " className="mt-2" />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted-foreground">Footer Line 2</label>
                    <Input value={draft.receipt.footer2} onChange={(e) => setDraft((p) => ({ ...p, receipt: { ...p.receipt, footer2: e.target.value } }))} placeholder="Wifi, social, etc " className="mt-2" />
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === 'general' && (
            <section className="max-w-4xl">
              <div className="rounded-xl border border-border bg-card p-5 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-bold text-muted-foreground">Currency</label>
                    <div className="mt-2 flex items-center">
                      <span className="text-foreground font-bold bg-secondary px-3 py-2 rounded-lg text-sm border border-border">
                        ETB
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted-foreground">Language</label>
                    <Select value={draft.general.language} onChange={(e) => setDraft((p) => ({ ...p, general: { ...p.general, language: e.target.value } }))} className="mt-2">
                      <option value="en">English</option>
                      <option value="am">Amharic</option>
                    </Select>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="text-foreground font-extrabold text-base">Branch Payment QR Codes</div>
                  <div className="text-muted-foreground text-xs mt-1">Paste a QR data URL, QR image URL, or a short payment string for the branch (Telebirr, Bank Transfer, or Card).</div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <div>
                      <label className="text-sm font-bold text-muted-foreground">Telebirr QR</label>
                      <Input
                        value={draft.payments.qrCodes.telebirr}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            payments: { ...p.payments, qrCodes: { ...p.payments.qrCodes, telebirr: e.target.value } },
                          }))
                        }
                        placeholder="data:image/png;base64,... or URL"
                        className="mt-2"
                      />
                      <div className="mt-3 rounded-lg border border-border bg-background p-3">
                        <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Telebirr Details</div>
                        <div className="mt-3">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                const url = await uploadImage(f);
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      telebirr: { ...p.payments.qrDetails.telebirr, image: url },
                                    },
                                  },
                                }));
                              } catch (err) {
                                setRemoteError(err instanceof Error ? err.message : 'Upload failed');
                              }
                            }}
                            className="block w-full text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-secondary file:text-foreground hover:file:bg-secondary/80"
                          />
                        </div>
                        {draft.payments.qrDetails.telebirr.image ? (
                          <div className="mt-3 flex items-center justify-center">
                            <img
                              src={resolveAssetUrl(draft.payments.qrDetails.telebirr.image)}
                              alt="Telebirr QR"
                              className="max-h-44 max-w-full rounded-lg border border-border bg-background p-2"
                            />
                          </div>
                        ) : null}
                        <div className="grid grid-cols-1 gap-3 mt-3">
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Account Name</label>
                            <Input
                              value={draft.payments.qrDetails.telebirr.accountName}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      telebirr: { ...p.payments.qrDetails.telebirr, accountName: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="Merchant / Account name"
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Phone</label>
                            <Input
                              value={draft.payments.qrDetails.telebirr.phone}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      telebirr: { ...p.payments.qrDetails.telebirr, phone: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="+251..."
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Merchant ID</label>
                            <Input
                              value={draft.payments.qrDetails.telebirr.merchantId}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      telebirr: { ...p.payments.qrDetails.telebirr, merchantId: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="Merchant ID"
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Note</label>
                            <Input
                              value={draft.payments.qrDetails.telebirr.note}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      telebirr: { ...p.payments.qrDetails.telebirr, note: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="Optional instructions"
                              className="mt-2"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-bold text-muted-foreground">Bank Transfer QR</label>
                      <Input
                        value={draft.payments.qrCodes.bank_transfer}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            payments: { ...p.payments, qrCodes: { ...p.payments.qrCodes, bank_transfer: e.target.value } },
                          }))
                        }
                        placeholder="data:image/png;base64,... or URL"
                        className="mt-2"
                      />
                      <div className="mt-3 rounded-lg border border-border bg-background p-3">
                        <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Bank Transfer Details</div>
                        <div className="mt-3">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                const url = await uploadImage(f);
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      bank_transfer: { ...p.payments.qrDetails.bank_transfer, image: url },
                                    },
                                  },
                                }));
                              } catch (err) {
                                setRemoteError(err instanceof Error ? err.message : 'Upload failed');
                              }
                            }}
                            className="block w-full text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-secondary file:text-foreground hover:file:bg-secondary/80"
                          />
                        </div>
                        {draft.payments.qrDetails.bank_transfer.image ? (
                          <div className="mt-3 flex items-center justify-center">
                            <img
                              src={draft.payments.qrDetails.bank_transfer.image}
                              alt="Bank Transfer QR"
                              className="max-h-44 max-w-full rounded-lg border border-border bg-background p-2"
                            />
                          </div>
                        ) : null}
                        <div className="grid grid-cols-1 gap-3 mt-3">
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Bank Name</label>
                            <Input
                              value={draft.payments.qrDetails.bank_transfer.bankName}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      bank_transfer: { ...p.payments.qrDetails.bank_transfer, bankName: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="Bank name"
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Account Name</label>
                            <Input
                              value={draft.payments.qrDetails.bank_transfer.accountName}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      bank_transfer: { ...p.payments.qrDetails.bank_transfer, accountName: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="Account name"
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Account Number</label>
                            <Input
                              value={draft.payments.qrDetails.bank_transfer.accountNumber}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      bank_transfer: { ...p.payments.qrDetails.bank_transfer, accountNumber: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="Account number"
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Phone</label>
                            <Input
                              value={draft.payments.qrDetails.bank_transfer.phone}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      bank_transfer: { ...p.payments.qrDetails.bank_transfer, phone: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="+251..."
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Note</label>
                            <Input
                              value={draft.payments.qrDetails.bank_transfer.note}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      bank_transfer: { ...p.payments.qrDetails.bank_transfer, note: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="Optional instructions"
                              className="mt-2"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-bold text-muted-foreground">Card QR (optional)</label>
                      <Input
                        value={draft.payments.qrCodes.card}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            payments: { ...p.payments, qrCodes: { ...p.payments.qrCodes, card: e.target.value } },
                          }))
                        }
                        placeholder="data:image/png;base64,... or URL"
                        className="mt-2"
                      />
                      <div className="mt-3 rounded-lg border border-border bg-background p-3">
                        <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Card Details</div>
                        <div className="mt-3">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                const url = await uploadImage(f);
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      card: { ...p.payments.qrDetails.card, image: url },
                                    },
                                  },
                                }));
                              } catch (err) {
                                setRemoteError(err instanceof Error ? err.message : 'Upload failed');
                              }
                            }}
                            className="block w-full text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-secondary file:text-foreground hover:file:bg-secondary/80"
                          />
                        </div>
                        {draft.payments.qrDetails.card.image ? (
                          <div className="mt-3 flex items-center justify-center">
                            <img
                              src={draft.payments.qrDetails.card.image}
                              alt="Card QR"
                              className="max-h-44 max-w-full rounded-lg border border-border bg-background p-2"
                            />
                          </div>
                        ) : null}
                        <div className="grid grid-cols-1 gap-3 mt-3">
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Merchant ID</label>
                            <Input
                              value={draft.payments.qrDetails.card.merchantId}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      card: { ...p.payments.qrDetails.card, merchantId: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="Merchant ID"
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-muted-foreground">Note</label>
                            <Input
                              value={draft.payments.qrDetails.card.note}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  payments: {
                                    ...p.payments,
                                    qrDetails: {
                                      ...p.payments.qrDetails,
                                      card: { ...p.payments.qrDetails.card, note: e.target.value },
                                    },
                                  },
                                }))
                              }
                              placeholder="Optional instructions"
                              className="mt-2"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border divide-y divide-border">
                  <CheckboxRow
                    checked={draft.payments.requireReferenceForMethods.includes('mobile_money')}
                    onChange={(next) =>
                      setDraft((p) => {
                        const cur = new Set(p.payments.requireReferenceForMethods);
                        if (next) cur.add('mobile_money');
                        else cur.delete('mobile_money');
                        return { ...p, payments: { ...p.payments, requireReferenceForMethods: Array.from(cur) } };
                      })
                    }
                    title="Require payment reference for Telebirr"
                    subtitle="Waiter must enter the transaction reference (saved in uppercase)."
                  />
                  <CheckboxRow
                    checked={draft.payments.requireReferenceForMethods.includes('bank_transfer')}
                    onChange={(next) =>
                      setDraft((p) => {
                        const cur = new Set(p.payments.requireReferenceForMethods);
                        if (next) cur.add('bank_transfer');
                        else cur.delete('bank_transfer');
                        return { ...p, payments: { ...p.payments, requireReferenceForMethods: Array.from(cur) } };
                      })
                    }
                    title="Require payment reference for Bank Transfer"
                    subtitle="Waiter must enter the transfer reference (saved in uppercase)."
                  />
                  <CheckboxRow
                    checked={draft.payments.requireReferenceForMethods.includes('card')}
                    onChange={(next) =>
                      setDraft((p) => {
                        const cur = new Set(p.payments.requireReferenceForMethods);
                        if (next) cur.add('card');
                        else cur.delete('card');
                        return { ...p, payments: { ...p.payments, requireReferenceForMethods: Array.from(cur) } };
                      })
                    }
                    title="Require payment reference for Card"
                    subtitle="Waiter must enter the card slip/reference (saved in uppercase)."
                  />
                </div>

                <div className="rounded-lg border border-border divide-y divide-border">
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-foreground font-bold text-sm">Enable Sounds</p>
                      <p className="text-muted-foreground text-xs mt-1">Play UI sounds for new orders and important actions.</p>
                    </div>
                    <Toggle checked={draft.general.enableSounds} onChange={(next) => setDraft((p) => ({ ...p, general: { ...p.general, enableSounds: next } }))} label="Enable Sounds" />
                  </div>
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-foreground font-bold text-sm">Currency</p>
                      <p className="text-muted-foreground text-xs mt-1">Currency code displayed on receipts and reports.</p>
                    </div>
                    <div className="w-32 flex items-center justify-end">
                      <span className="text-foreground font-bold bg-secondary px-3 py-2 rounded-lg text-sm border border-border">
                        ETB
                      </span>
                    </div>
                  </div>

                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-foreground font-bold text-sm">Offline Mode</p>
                      <p className="text-muted-foreground text-xs mt-1">Allow POS operations when the network is unstable.</p>
                    </div>
                    <Toggle checked={draft.general.enableOfflineMode} onChange={(next) => setDraft((p) => ({ ...p, general: { ...p.general, enableOfflineMode: next } }))} label="Offline Mode" />
                  </div>

                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-foreground font-bold text-sm">Loyalty Rewards</p>
                      <p className="text-muted-foreground text-xs mt-1">Configure points earning and expiration for this branch.</p>
                    </div>
                  </div>

                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-bold text-muted-foreground">Earn Rate (points per ETB)</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={draft.loyalty.earnRate}
                        onChange={(e) => setDraft((p) => ({ ...p, loyalty: { ...p.loyalty, earnRate: Number(e.target.value) } }))}
                        className="mt-2"
                        placeholder="e.g. 1"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-bold text-muted-foreground">Expiry Days (optional)</label>
                      <Input
                        type="number"
                        value={draft.loyalty.expiryDays ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setDraft((p) => ({
                            ...p,
                            loyalty: { ...p.loyalty, expiryDays: raw === '' ? null : Number(raw) },
                          }));
                        }}
                        className="mt-2"
                        placeholder="Leave empty for no expiry"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'branch' && (
            <section className="max-w-4xl">
              <div className="rounded-xl border border-border bg-card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="text-sm font-bold text-muted-foreground">Business Name</label>
                  <Input value={draft.branchInfo.businessName} onChange={(e) => setDraft((p) => ({ ...p, branchInfo: { ...p.branchInfo, businessName: e.target.value } }))} className="mt-2" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-bold text-muted-foreground">Address</label>
                  <Input value={draft.branchInfo.address} onChange={(e) => setDraft((p) => ({ ...p, branchInfo: { ...p.branchInfo, address: e.target.value } }))} className="mt-2" />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted-foreground">Phone</label>
                  <Input value={draft.branchInfo.phone} onChange={(e) => setDraft((p) => ({ ...p, branchInfo: { ...p.branchInfo, phone: e.target.value } }))} className="mt-2" />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted-foreground">TIN</label>
                  <Input value={draft.branchInfo.tin} onChange={(e) => setDraft((p) => ({ ...p, branchInfo: { ...p.branchInfo, tin: e.target.value } }))} className="mt-2" />
                </div>
              </div>
            </section>
          )}

          {activeTab === 'hours' && (
            <section className="max-w-4xl">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                {([
                  ['mon', 'Monday'],
                  ['tue', 'Tuesday'],
                  ['wed', 'Wednesday'],
                  ['thu', 'Thursday'],
                  ['fri', 'Friday'],
                  ['sat', 'Saturday'],
                  ['sun', 'Sunday'],
                ] as Array<[keyof BranchSettingsState['operatingHours'], string]>).map(([key, label]) => (
                  <div key={key} className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="w-28 text-sm font-bold text-muted-foreground">{label}</div>
                    <Input
                      value={draft.operatingHours[key]}
                      onChange={(e) => setDraft((p) => ({ ...p, operatingHours: { ...p.operatingHours, [key]: e.target.value } }))}
                      placeholder="08:00 AM - 08:00 PM"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'taxes' && (
            <section className="max-w-4xl">
              <div className="rounded-xl border border-border bg-card p-5 space-y-6">
                <div className="rounded-lg border border-border divide-y divide-border">
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-foreground font-bold text-sm">VAT</p>
                      <p className="text-muted-foreground text-xs mt-1">Apply VAT to sales and show it on receipts.</p>
                    </div>
                    <Toggle checked={draft.taxes.vatEnabled} onChange={(next) => setDraft((p) => ({ ...p, taxes: { ...p.taxes, vatEnabled: next } }))} label="VAT enabled" />
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-bold text-muted-foreground">VAT Rate (%)</label>
                      <Input
                        type="number"
                        value={draft.taxes.vatRate}
                        onChange={(e) => setDraft((p) => ({ ...p, taxes: { ...p.taxes, vatRate: Number(e.target.value) } }))}
                        className="mt-2"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border divide-y divide-border">
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-foreground font-bold text-sm">Service Charge</p>
                      <p className="text-muted-foreground text-xs mt-1">Optional service charge added during checkout.</p>
                    </div>
                    <Toggle
                      checked={draft.taxes.serviceChargeEnabled}
                      onChange={(next) => setDraft((p) => ({ ...p, taxes: { ...p.taxes, serviceChargeEnabled: next } }))}
                      label="Service charge enabled"
                    />
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-bold text-muted-foreground">Service Charge Rate (%)</label>
                      <Input
                        type="number"
                        value={draft.taxes.serviceChargeRate}
                        onChange={(e) => setDraft((p) => ({ ...p, taxes: { ...p.taxes, serviceChargeRate: Number(e.target.value) } }))}
                        className="mt-2"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'integrations' && (
            <section className="max-w-4xl">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-foreground font-extrabold">Installed Integrations</div>
                    <div className="text-xs text-muted-foreground mt-1">Read-only view for managers. Owners install integrations.</div>
                  </div>
                  <button
                    onClick={() => void loadInstalledIntegrations()}
                    className="h-10 px-4 rounded-lg border border-border bg-secondary text-foreground text-sm font-bold hover:bg-secondary/80 disabled:opacity-60"
                    disabled={integrationsLoading}
                    type="button"
                  >
                    Refresh
                  </button>
                </div>

                {integrationsError ? <div className="text-sm text-red-300">{integrationsError}</div> : null}
                {integrationsLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

                {!integrationsLoading && installedIntegrations.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No integrations installed.</div>
                ) : null}

                <div className="divide-y divide-border rounded-lg border border-border">
                  {installedIntegrations.map((x) => (
                    <div key={x.id} className="p-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-foreground font-bold truncate">{x.name || x.code}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {x.category || '—'} • {x.integrationType || '—'} • {x.status || 'installed'}
                        </div>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">{x.code}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {activeTab === 'addons' && (
            <section className="max-w-4xl">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-foreground font-extrabold">Active Add-ons</div>
                    <div className="text-xs text-muted-foreground mt-1">Read-only view for managers. Owners subscribe to add-ons.</div>
                  </div>
                  <button
                    onClick={() => void loadAddonSubscriptions()}
                    className="h-10 px-4 rounded-lg border border-border bg-secondary text-foreground text-sm font-bold hover:bg-secondary/80 disabled:opacity-60"
                    disabled={addonsLoading}
                    type="button"
                  >
                    Refresh
                  </button>
                </div>

                {addonsError ? <div className="text-sm text-red-300">{addonsError}</div> : null}
                {addonsLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

                {!addonsLoading && addonSubscriptions.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No add-ons active for this tenant.</div>
                ) : null}

                <div className="divide-y divide-border rounded-lg border border-border">
                  {addonSubscriptions.map((x) => (
                    <div key={x.id} className="p-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-foreground font-bold truncate">{x.name || x.code}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {x.category || '—'} • {x.status || '—'} • {x.billingFrequency || '—'}
                        </div>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">{x.code}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>

        <Modal
          open={addOpen}
          title={editDeviceId && editDeviceId !== 'NEW' ? 'Edit Device' : 'Add New Device'}
          onClose={() => {
            setAddOpen(false);
            setEditDeviceId(null);
            setDeviceFormState(null);
          }}
          footer={
            <div className="flex gap-3">
              {editDeviceId && editDeviceId !== 'NEW' ? (
                <button
                  onClick={async () => {
                    const id = String(editDeviceId || '').trim();
                    if (!id) return;
                    const nextDraft: BranchSettingsState = {
                      ...draft,
                      devices: draft.devices.filter((d) => d.id !== id),
                      defaultReceiptPrinterId: draft.defaultReceiptPrinterId === id ? null : draft.defaultReceiptPrinterId,
                      defaultKitchenPrinterId: draft.defaultKitchenPrinterId === id ? null : draft.defaultKitchenPrinterId,
                      fallbackKitchenPrinterId: draft.fallbackKitchenPrinterId === id ? null : draft.fallbackKitchenPrinterId,
                      defaultBarPrinterId: draft.defaultBarPrinterId === id ? null : draft.defaultBarPrinterId,
                    };
                    try {
                      await saveSettings(nextDraft);
                    } catch (e) {
                      setRemoteError(e instanceof Error ? e.message : 'Save failed');
                      return;
                    }
                    setAddOpen(false);
                    setEditDeviceId(null);
                    setDeviceFormState(null);
                  }}
                  className="h-11 px-4 rounded-lg bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 text-red-400 font-bold"
                  type="button"
                >
                  Remove
                </button>
              ) : (
                <div />
              )}
              <div className="flex-1" />
              <button
                onClick={() => {
                  setAddOpen(false);
                  setEditDeviceId(null);
                  setDeviceFormState(null);
                }}
                className="h-11 px-4 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
                type="button"
              >
                Cancel
              </button>
              <button
                disabled={addDisabled}
                onClick={async () => {
                  if (!deviceFormState) return;
                  const next: ConnectedDevice = {
                    ...deviceFormState,
                    id: deviceFormState.id === 'NEW' ? uid('dev') : deviceFormState.id,
                  };
                  const nextDraft: BranchSettingsState = {
                    ...draft,
                    devices: draft.devices.some((d) => d.id === next.id)
                      ? draft.devices.map((d) => (d.id === next.id ? next : d))
                      : [next, ...draft.devices],
                  };
                  try {
                    await saveSettings(nextDraft);
                  } catch (e) {
                    setRemoteError(e instanceof Error ? e.message : 'Save failed');
                    return;
                  }
                  setAddOpen(false);
                  setEditDeviceId(null);
                  setDeviceFormState(null);
                }}
                className="h-11 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                type="button"
              >
                {editDeviceId && editDeviceId !== 'NEW' ? 'Save Changes' : 'Add Device'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-bold text-muted-foreground">Device Name</label>
                <Input
                  value={deviceFormState?.name ?? ''}
                  onChange={(e) => setDeviceFormState((p) => (p ? { ...p, name: e.target.value } : p))}
                  className="mt-2"
                  placeholder="e.g. Main Counter Thermal"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-muted-foreground">Device Type</label>
                <Select
                  value={deviceFormState?.kind ?? 'Printer'}
                  onChange={(e) => setDeviceFormState((p) => (p ? { ...p, kind: e.target.value as ConnectedDevice['kind'] } : p))}
                  className="mt-2"
                >
                  <option value="Printer">Printer</option>
                  <option value="KDS">KDS</option>
                  <option value="CashDrawer">Cash Drawer</option>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-bold text-muted-foreground">Model</label>
              <Input
                value={deviceFormState?.model ?? ''}
                onChange={(e) => setDeviceFormState((p) => (p ? { ...p, model: e.target.value } : p))}
                className="mt-2"
                placeholder="e.g. Epson TM-T88V"
              />
            </div>
            {deviceFormState?.connection === 'LAN' && (
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="text-sm font-bold text-muted-foreground">IP Address</label>
                  <Input
                    value={deviceFormState?.ip ?? ''}
                    onChange={(e) => setDeviceFormState((p) => (p ? { ...p, ip: e.target.value } : p))}
                    className="mt-2"
                    placeholder="192.168.1.120"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted-foreground">Port</label>
                  <Input
                    value={deviceFormState?.port ?? '9100'}
                    onChange={(e) => setDeviceFormState((p) => (p ? { ...p, port: e.target.value } : p))}
                    className="mt-2"
                    placeholder="9100"
                  />
                </div>
              </div>
            )}

            {deviceFormState?.connection === 'whitetooth' && (
              <div>
                <label className="text-sm font-bold text-muted-foreground">whitetooth Printer</label>
                <Input
                  value={deviceFormState?.whitetoothName ?? ''}
                  onChange={(e) => setDeviceFormState((p) => (p ? { ...p, whitetoothName: e.target.value } : p))}
                  className="mt-2"
                  placeholder="Paired device name"
                />
              </div>
            )}

            {deviceFormState?.connection === 'Cloud' && (
              <div>
                <label className="text-sm font-bold text-muted-foreground">Cloud Printer ID</label>
                <Input
                  value={deviceFormState?.cloudId ?? ''}
                  onChange={(e) => setDeviceFormState((p) => (p ? { ...p, cloudId: e.target.value } : p))}
                  className="mt-2"
                  placeholder="cloud-printer-001"
                />
              </div>
            )}
            <div>
              <label className="text-sm font-bold text-muted-foreground">Usage</label>
              <Input
                value={deviceFormState?.usage ?? ''}
                onChange={(e) => setDeviceFormState((p) => (p ? { ...p, usage: e.target.value } : p))}
                className="mt-2"
                placeholder="Receipts, Kitchen tickets..."
              />
            </div>
          </div>
        </Modal>

        <Modal
          open={settingsDevice != null}
          title={settingsDevice ? `Device Settings: ${settingsDevice.name}` : 'Device Settings'}
          onClose={() => {
            setSettingsDevice(null);
            setSettingsDeviceDraft(null);
          }}
          footer={
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSettingsDevice(null);
                  setSettingsDeviceDraft(null);
                }}
                className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!settingsDeviceDraft}
                onClick={async () => {
                  if (!settingsDeviceDraft) return;
                  const nextDraft: BranchSettingsState = {
                    ...draft,
                    devices: draft.devices.some((d) => d.id === settingsDeviceDraft.id)
                      ? draft.devices.map((d) => (d.id === settingsDeviceDraft.id ? settingsDeviceDraft : d))
                      : [settingsDeviceDraft, ...draft.devices],
                  };
                  setSettingsDevice(null);
                  setSettingsDeviceDraft(null);
                  try {
                    await saveSettings(nextDraft);
                  } catch (e) {
                    setRemoteError(e instanceof Error ? e.message : 'Save failed');
                  }
                }}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors disabled:opacity-60"
              >
                Save Changes
              </button>
            </div>
          }
        >
          {settingsDeviceDraft ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-bold text-muted-foreground">Device Name</label>
                  <Input
                    value={settingsDeviceDraft.name}
                    onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, name: e.target.value } : p))}
                    className="mt-2"
                    placeholder="Kitchen Printer"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted-foreground">Model</label>
                  <Input
                    value={settingsDeviceDraft.model}
                    onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, model: e.target.value } : p))}
                    className="mt-2"
                    placeholder="Epson TM-T88V"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-bold text-muted-foreground">Connection</label>
                  <Select
                    value={settingsDeviceDraft.connection}
                    onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, connection: e.target.value as any } : p))}
                    className="mt-2"
                  >
                    <option value="LAN">LAN</option>
                    <option value="USB">USB</option>
                    <option value="whitetooth">whitetooth</option>
                    <option value="Cloud">Cloud</option>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-bold text-muted-foreground">Profile</label>
                  <Select
                    value={settingsDeviceDraft.profile}
                    onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, profile: e.target.value as any } : p))}
                    className="mt-2"
                  >
                    <option value="Receipt">Receipt</option>
                    <option value="Kitchen">Kitchen</option>
                    <option value="Bar">Bar</option>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-bold text-muted-foreground">Status</label>
                  <Select
                    value={settingsDeviceDraft.status}
                    onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, status: e.target.value as any } : p))}
                    className="mt-2"
                  >
                    <option value="Online">Online</option>
                    <option value="Offline">Offline</option>
                  </Select>
                </div>
              </div>

              {settingsDeviceDraft.connection === 'LAN' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-bold text-muted-foreground">IP Address</label>
                    <Input
                      value={settingsDeviceDraft.ip}
                      onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, ip: e.target.value } : p))}
                      className="mt-2"
                      placeholder="192.168.1.120"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted-foreground">Port</label>
                    <Input
                      value={settingsDeviceDraft.port}
                      onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, port: e.target.value } : p))}
                      className="mt-2"
                      placeholder="9100"
                    />
                  </div>
                </div>
              ) : null}

              {settingsDeviceDraft.connection === 'USB' ? (
                <div>
                  <label className="text-sm font-bold text-muted-foreground">Windows Printer Name</label>
                  <Input
                    value={settingsDeviceDraft.printerName ?? ''}
                    onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, printerName: e.target.value } : p))}
                    className="mt-2"
                    placeholder="e.g. EPSON TM-T20II Receipt"
                  />
                </div>
              ) : null}

              {settingsDeviceDraft.connection === 'whitetooth' ? (
                <div>
                  <label className="text-sm font-bold text-muted-foreground">whitetooth Printer</label>
                  <Input
                    value={settingsDeviceDraft.whitetoothName ?? ''}
                    onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, whitetoothName: e.target.value } : p))}
                    className="mt-2"
                    placeholder="Paired device name"
                  />
                </div>
              ) : null}

              {settingsDeviceDraft.connection === 'Cloud' ? (
                <div>
                  <label className="text-sm font-bold text-muted-foreground">Cloud Printer ID</label>
                  <Input
                    value={settingsDeviceDraft.cloudId ?? ''}
                    onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, cloudId: e.target.value } : p))}
                    className="mt-2"
                    placeholder="cloud-printer-001"
                  />
                </div>
              ) : null}

              <div>
                <label className="text-sm font-bold text-muted-foreground">Usage</label>
                <Input
                  value={settingsDeviceDraft.usage}
                  onChange={(e) => setSettingsDeviceDraft((p) => (p ? { ...p, usage: e.target.value } : p))}
                  className="mt-2"
                  placeholder="Receipts, Kitchen tickets..."
                />
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Select a device to edit.</div>
          )}
        </Modal>

        <Modal
          open={testPrintDevice != null}
          title={testPrintDevice ? `Test Print: ${testPrintDevice.name}` : 'Test Print'}
          onClose={() => {
            setTestPrintDevice(null);
            setTestPrintStatus('');
          }}
          footer={
            <div className="flex gap-3">
              <button onClick={() => setTestPrintDevice(null)} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors">Close</button>
              <button
                onClick={async () => {
                  const device = testPrintDevice;
                  if (!device) return;

                  setTestPrintStatus('');

                  if (device.connection === 'LAN') {
                    try {
                      setTestPrintStatus('Sending to printer...');
                      const res = await apiFetch('/api/manager/print/test', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ deviceId: device.id }),
                      });
                      const json = (await res.json().catch(() => null)) as any;
                      if (!res.ok) {
                        const msg = typeof json?.error === 'string' ? json.error : json ? JSON.stringify(json) : `HTTP ${res.status}`;
                        setTestPrintStatus(`Failed: ${msg}`);
                        return;
                      }
                      setTestPrintStatus('Printed successfully.');
                      return;
                    } catch {
                      setTestPrintStatus('Failed: network error');
                      return;
                    }
                  }

                  // Fallback (whitetooth/Cloud): keep browser print preview for now.
                  if (device.profile === 'Kitchen') {
                    openPrintWindow(
                      kitchenSampleHtml({
                        title: 'Kitchen Ticket',
                        tableName: 'Table 1',
                        orderNumber: '#0001',
                        placedBy: 'Sarah Jenkins',
                        lines: [
                          { name: 'Cappuccino', qty: 1 },
                          { name: 'Sandwich', qty: 1 },
                        ],
                      }),
                    );
                    return;
                  }
                  if (device.profile === 'Bar') {
                    openPrintWindow(
                      kitchenSampleHtml({
                        title: 'Bar Ticket',
                        tableName: 'Table 1',
                        orderNumber: '#0001',
                        placedBy: 'Sarah Jenkins',
                        lines: [
                          { name: 'Cappuccino', qty: 1 },
                          { name: 'Sandwich', qty: 1 },
                        ],
                      }),
                    );
                    return;
                  }

                  openPrintWindow(
                    receiptHtml({
                      businessName: ownerBusinessName || '-',
                      address: draft.branchInfo.address,
                      phone: draft.branchInfo.phone,
                      tin: draft.branchInfo.tin,
                      showTin: true,
                      footer1: draft.receipt.footer1,
                      footer2: draft.receipt.footer2,
                      currency: draft.general.currency,
                      vatEnabled: draft.taxes.vatEnabled,
                      vatRate: draft.taxes.vatRate,
                      serviceEnabled: draft.taxes.serviceChargeEnabled,
                      serviceRate: draft.taxes.serviceChargeRate,
                      orderNumber: '#0001',
                      tableName: 'Table 1',
                      paymentMethod: 'Cash',
                      cashier: draft.managerName || 'Cashier',
                      waiter: draft.managerName || 'Waiter',
                      items: [
                        { name: 'Cappuccino', qty: 1, unitPrice: 120 },
                        { name: 'Sandwich', qty: 1, unitPrice: 180 },
                      ],
                    }),
                  );
                }}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors"
              >
                Print Sample
              </button>
            </div>
          }
        >
          <div className="text-sm text-muted-foreground">
            {testPrintDevice?.connection === 'LAN'
              ? 'This will send ESC/POS data to the configured LAN printer.'
              : 'A sample print will open your system print dialog.'}
          </div>
          {testPrintStatus ? <div className="mt-3 text-sm text-foreground">{testPrintStatus}</div> : null}
        </Modal>

        <Modal
          open={previewOpen}
          title="Receipt Preview"
          onClose={() => setPreviewOpen(false)}
          footer={
            <div className="flex gap-3">
              <button onClick={() => setPreviewOpen(false)} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors">Close</button>
              <button
                onClick={() => {
                  const html = receiptHtml({
                    businessName: ownerBusinessName || '-',
                    address: draft.branchInfo.address,
                    phone: draft.branchInfo.phone,
                    tin: draft.branchInfo.tin,
                    showTin: true,
                    footer1: draft.receipt.footer1,
                    footer2: draft.receipt.footer2,
                    currency: draft.general.currency,
                    vatEnabled: draft.taxes.vatEnabled,
                    vatRate: draft.taxes.vatRate,
                    serviceEnabled: draft.taxes.serviceChargeEnabled,
                    serviceRate: draft.taxes.serviceChargeRate,
                    orderNumber: '#0001',
                    tableName: 'Table 1',
                    paymentMethod: 'Cash',
                    cashier: draft.managerName || 'Cashier',
                    waiter: draft.managerName || 'Waiter',
                    items: [
                      { name: 'Cappuccino', qty: 1, unitPrice: 120 },
                      { name: 'Sandwich', qty: 1, unitPrice: 180 },
                    ],
                  });
                  openPrintWindow(html);
                }}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors"
              >
                Print Preview
              </button>
            </div>
          }
        >
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="text-center text-foreground font-bold">{ownerBusinessName || '-'}</div>
            <div className="mt-1 text-center text-xs text-muted-foreground">{draft.branchInfo.address || '-'}</div>
            <div className="mt-1 text-center text-xs text-muted-foreground">{draft.branchInfo.phone || '-'}</div>
            <div className="mt-1 text-center text-xs text-muted-foreground">TIN: {draft.branchInfo.tin || '-'}</div>
            <div className="mt-3 border-t border-dashed border-border" />
            <div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>Item</span><span>Amount</span></div>
            <div className="mt-2 space-y-2">
              <div className="flex justify-between text-sm text-foreground"><span>Cappuccino</span><span>120</span></div>
              <div className="flex justify-between text-sm text-foreground"><span>Sandwich</span><span>180</span></div>
            </div>
            <div className="mt-3 border-t border-dashed border-border" />
            <div className="mt-3 flex justify-between text-sm text-foreground font-bold"><span>Total</span><span>300</span></div>
            <div className="mt-4 text-center text-xs text-muted-foreground">{draft.receipt.footer1}</div>
            <div className="mt-1 text-center text-xs text-muted-foreground">{draft.receipt.footer2}</div>
            <div className="mt-2 text-center text-xs text-muted-foreground">Powered by Mirach POS</div>
          </div>
        </Modal>
      </div>
    </div >
  );
};
