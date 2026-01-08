import React, { useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos, useSelectedOrder } from '../../PosContext';
import { apiFetch } from '../../api';
import { readSession } from '../../session';

type PosSettingsResponse = {
  ok?: boolean;
  branch?: { id?: string; name?: string };
  general?: { currency?: string; timezone?: string };
  taxes?: { vatEnabled?: boolean; vatRate?: number; serviceChargeEnabled?: boolean; serviceChargeRate?: number };
  receipt?: { header?: string; footer1?: string; footer2?: string; showTin?: boolean; showBranchName?: boolean; logoDataUrl?: string };
  business?: { businessName?: string; legalName?: string; tin?: string; phone?: string; email?: string; address?: string };
  printers?: { autoPrintReceipts?: boolean; defaultReceiptPrinterId?: string | null };
};

const RECEIPT_SPLIT_KEY = 'mirachpos.receipt.splitId.v1';

const withBranchQuery = (url: string) => {
  try {
    const s = readSession<any>();
    const role = typeof s?.role === 'string' ? s.role : '';
    const tokenBranch = typeof s?.branchId === 'string' ? s.branchId.trim() : '';
    if (role !== 'Cafe Owner' && role !== 'Waiter Manager') return url;
    if (tokenBranch && tokenBranch !== 'global') return url;
    const selected =
      (localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
        localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
        localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') ||
        '')
        .trim();
    if (!selected || selected === 'global') return url;
    return url.includes('?') ? `${url}&branchId=${encodeURIComponent(selected)}` : `${url}?branchId=${encodeURIComponent(selected)}`;
  } catch {
    return url;
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
    if (!w) return false;
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
    return true;
  } catch {
    return false;
  }
};

const receiptHtml = (
  order: NonNullable<ReturnType<typeof useSelectedOrder>>,
  settings: {
    footer1: string;
    footer2: string;
    currency: string;
    timezone: string;
    vatEnabled: boolean;
    vatRate: number;
    serviceEnabled: boolean;
    serviceRate: number;
    businessName: string;
    tin: string;
    phone: string;
    address: string;
    showTin: boolean;
  },
) => {
  const cur = escapeHtml(settings.currency);
  const biz = escapeHtml(settings.businessName);
  const tin = escapeHtml(settings.tin);
  const phone = escapeHtml(settings.phone);
  const address = escapeHtml(settings.address);

  const createdAtIso = typeof (order as any)?.paidAt === 'string' && (order as any).paidAt ? (order as any).paidAt : order.createdAt;
  const dt = (() => {
    try {
      return new Date(createdAtIso);
    } catch {
      return new Date();
    }
  })();

  const tz = typeof settings.timezone === 'string' && settings.timezone.trim() ? settings.timezone.trim() : '';
  const dateStr = (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz || undefined,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).formatToParts(dt);
      const dd = parts.find((p) => p.type === 'day')?.value ?? '';
      const mm = parts.find((p) => p.type === 'month')?.value ?? '';
      const yyyy = parts.find((p) => p.type === 'year')?.value ?? '';
      if (!dd || !mm || !yyyy) return '';
      return `${dd}/${mm}/${yyyy}`;
    } catch {
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const yyyy = String(dt.getFullYear());
      return `${dd}/${mm}/${yyyy}`;
    }
  })();

  const timeStr = (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz || undefined,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(dt);
      const hh = parts.find((p) => p.type === 'hour')?.value ?? '';
      const mi = parts.find((p) => p.type === 'minute')?.value ?? '';
      if (!hh || !mi) return '';
      return `${hh}:${mi}`;
    } catch {
      const hh = String(dt.getHours()).padStart(2, '0');
      const mi = String(dt.getMinutes()).padStart(2, '0');
      return `${hh}:${mi}`;
    }
  })();

  const customerLabel = order.customer ? `${escapeHtml(order.customer.name)} (${escapeHtml(order.customer.phone)})` : 'WALKING';
  const waiter = escapeHtml((order as any)?.createdByName || (order as any)?.createdByStaffId || '');
  const operator = (() => {
    try {
      const s = readSession<any>();
      return escapeHtml(String((order as any)?.paidByName || s?.staffName || (order as any)?.paidByStaffId || '').trim());
    } catch {
      return escapeHtml(String((order as any)?.paidByName || (order as any)?.paidByStaffId || '').trim());
    }
  })();
  const tableNo = escapeHtml(order.tableName || '');

  const discount = Number((order as any)?.discount ?? 0) || 0;
  const discountPct = Number((order as any)?.discountPct ?? (order as any)?.payload?.discountPct ?? 0) || 0;
  const serviceCharge = Number(order.serviceCharge) || 0;
  const taxableBase = Math.max(0, Number(order.subtotal || 0) - discount + serviceCharge);
  const taxRateLabel = settings.vatEnabled ? `${settings.vatRate.toFixed(2)}%` : '';
  const serviceLabel = settings.serviceEnabled ? `SERVICE CHARGE +${settings.serviceRate.toFixed(0)}%` : 'SERVICE CHARGE';

  const tip = Number((order as any)?.tip ?? (order as any)?.payload?.tip ?? 0) || 0;

  const tendered = Number((order as any)?.tenderedAmount ?? 0) || 0;
  const change = Math.max(0, tendered - Number(order.total || 0));
  const payMethod = String((order as any)?.paymentMethod || order.paymentMethod || 'CASH').toUpperCase();

  const norm = (v: string) => v.trim().replace(/\s+/g, ' ');
  const normKey = (v: string) => norm(v).toLowerCase();
  const headerLines = (() => {
    const lines = [
      norm(biz || '-'),
      norm(address || '-'),
      norm(phone),
      settings.showTin ? norm(tin ? `TIN: ${tin}` : 'TIN: -') : '',
    ]
      .map((x) => norm(String(x || '')))
      .filter(Boolean);

    const out: string[] = [];
    const seen = new Set<string>();
    for (const l of lines) {
      const k = normKey(l);
      if (!k) continue;
      if (k === 'tel-' || k === 'tel:' || k === 'tel') continue;
      if (seen.has(k)) continue;

      // Hide noise/too-short lines.
      if (k.startsWith('tel-') && k.length < 8) continue;
      if (!k.startsWith('tin') && l.length < 3) continue;
      if (!k.startsWith('tel') && !k.startsWith('tin') && l.length < 4) continue;

      seen.add(k);
      out.push(l);
    }

    // If businessName and legalName are identical, keep only one.
    return out;
  })();

  const phoneLine = (() => {
    const p = norm(phone);
    if (!p) return '';
    if (p.length < 6) return '';
    const stripped = p.replace(/^tel\s*[:\-]?\s*/i, '');
    return `TEL: ${escapeHtml(stripped)}`;
  })();

  const addressLine = (() => {
    const a = norm(address);
    if (!a) return '';
    if (a.length < 5) return '';
    return escapeHtml(a);
  })();

  const showTendered = payMethod === 'CASH' && tendered > 0 && (Math.abs(tendered - Number(order.total || 0)) > 0.009 || change > 0.009);

  const cols = 32;
  const padR = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
  const padL = (s: string, n: number) => (s.length >= n ? s.slice(s.length - n) : ' '.repeat(n - s.length) + s);
  const center = (s: string, n: number) => {
    const t = String(s || '').trim();
    if (!t) return '';
    if (t.length >= n) return t.slice(0, n);
    const left = Math.floor((n - t.length) / 2);
    const right = n - t.length - left;
    return ' '.repeat(left) + t + ' '.repeat(right);
  };
  const dash = '-'.repeat(cols);
  const twoCol = (a: string, b: string) => {
    const left = String(a || '').trim();
    const right = String(b || '').trim();
    if (!right) return padR(left, cols);
    const maxLeft = Math.max(0, cols - right.length - 1);
    return padR(left.slice(0, maxLeft), maxLeft) + ' ' + padL(right, cols - maxLeft - 1);
  };
  const fmtAmt = (n: number) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '0.00');
  const wrap = (s: string, width: number) => {
    const t = String(s || '').trim();
    if (!t) return [''];
    const out: string[] = [];
    let i = 0;
    while (i < t.length) {
      out.push(t.slice(i, i + width));
      i += width;
    }
    return out;
  };

  const receiptLines: string[] = [];
  receiptLines.push(center(biz || '-', cols));
  if (addressLine) receiptLines.push(center(addressLine, cols));
  if (phoneLine) receiptLines.push(center(phoneLine, cols));
  if (settings.showTin) receiptLines.push(center(tin ? `TIN: ${tin}` : 'TIN: -', cols));
  receiptLines.push('');
  receiptLines.push(twoCol(dateStr, timeStr));
  receiptLines.push('');
  if (String(order.number || '').trim()) receiptLines.push(padR(`Order: ${String(order.number).trim()}`, cols));
  if ((order as any)?.paymentReference) receiptLines.push(padR(`Ref: ${String((order as any).paymentReference).trim()}`, cols));
  if (operator) receiptLines.push(padR(`Operator: ${operator}`, cols));
  if (waiter) receiptLines.push(padR(`Waiter: ${waiter}`, cols));
  if (tableNo) receiptLines.push(padR(`Table: ${tableNo}`, cols));
  if (customerLabel) receiptLines.push(padR(`Customer: ${customerLabel}`, cols));
  receiptLines.push(dash);
  receiptLines.push(twoCol('Description', 'Amount'));
  receiptLines.push(dash);

  for (const it of order.items.slice(0, 200)) {
    const name = String(it?.name || '').trim();
    const qty = Number(it?.qty ?? 0) || 0;
    const unit = Number(it?.unitPrice ?? 0) || 0;
    const lineTotal = qty * unit;

    for (const w of wrap(name || '-', cols)) receiptLines.push(padR(w, cols));
    const left = `${qty} x ${fmtAmt(unit)}`;
    receiptLines.push(twoCol(left, fmtAmt(lineTotal)));
  }

  receiptLines.push(dash);
  receiptLines.push(twoCol('SUBTOTAL', fmtAmt(Number(order.subtotal || 0))));
  if (discount > 0.0001 || discountPct > 0.0001) {
    const label = discountPct > 0.0001 ? `DISCOUNT ${discountPct.toFixed(0)}%` : 'DISCOUNT';
    receiptLines.push(twoCol(label, fmtAmt(discount)));
  }
  if (serviceCharge > 0.0001) receiptLines.push(twoCol(serviceLabel, fmtAmt(serviceCharge)));
  if (settings.vatEnabled) receiptLines.push(twoCol(`TAX ${taxRateLabel}`, fmtAmt(Number(order.tax || 0))));
  if (tip > 0.0001) receiptLines.push(twoCol('TIP', fmtAmt(tip)));
  receiptLines.push(dash);
  receiptLines.push(twoCol('TOTAL', `${fmtAmt(Number(order.total || 0))} ${cur}`));
  receiptLines.push(padR(payMethod, cols));
  if (showTendered) {
    receiptLines.push(twoCol('Tendered', fmtAmt(tendered)));
    receiptLines.push(twoCol('Change', fmtAmt(change)));
  }
  receiptLines.push('');
  receiptLines.push(center('Powered by MirachPOS', cols));

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Receipt</title>
      <style>
        *{box-sizing:border-box;}
        body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin:0; padding:12px; color:#111;}
        pre{margin:0; font-size:12px; line-height:1.25; white-space:pre;}
        @media print{body{padding:0}}
      </style>
    </head>
    <body>
      <pre>${escapeHtml(receiptLines.join('\\n'))}</pre>
    </body>
  </html>
  `;
};

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterReceipt: React.FC<Props> = ({ onNavigate }) => {
  const { selectedOrderId } = usePos();
  const order = useSelectedOrder();
  const [fallbackOrder, setFallbackOrder] = useState<NonNullable<ReturnType<typeof useSelectedOrder>> | null>(null);
  const [remoteOrder, setRemoteOrder] = useState<ReturnType<typeof useSelectedOrder>>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [receiptSplitId, setReceiptSplitId] = useState<string>('');
  const [posSettings, setPosSettings] = useState<PosSettingsResponse | null>(null);

  const effectiveOrder = order ?? fallbackOrder ?? remoteOrder;

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (order) {
        setFallbackOrder(null);
        return;
      }
      if (!selectedOrderId) return;
      try {
        const res = await apiFetch(`/api/waiter/order/${encodeURIComponent(String(selectedOrderId))}`);
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const o = json?.order;
        if (!mounted) return;
        if (!o || typeof o !== 'object') return;
        // Normalize into PosOrder-like shape expected by this screen.
        const items = Array.isArray(o.items) ? o.items : [];
        const normalized: any = {
          id: String(o.id || ''),
          number: String(o.number || ''),
          tableId: String(o?.payload?.tableId || ''),
          tableName: String(o.tableName || ''),
          items,
          subtotal: Number(o?.payload?.subtotal ?? 0) || 0,
          tax: Number(o.tax ?? o?.payload?.tax ?? 0) || 0,
          serviceCharge: Number(o?.payload?.serviceCharge ?? 0) || 0,
          total: Number(o.total ?? 0) || 0,
          status: String(o.status || ''),
          createdAt: String(o?.payload?.createdAt || o.createdAt || ''),
          timeLabel: String(o.timeLabel || o?.payload?.timeLabel || ''),
          createdByStaffId: String(o.createdByStaffId || o?.payload?.createdByStaffId || ''),
          createdByName: String(o.createdByName || o?.payload?.createdByName || ''),
          paidAt: o?.payload?.paidAt || undefined,
          paymentMethod: o?.payload?.paymentMethod || undefined,
          paymentReference: o?.payload?.paymentReference || undefined,
          tenderedAmount: o?.payload?.tenderedAmount || undefined,
          customer: o?.payload?.customer || undefined,
          splits: o?.payload?.splits || undefined,
          discount: o?.payload?.discount || undefined,
          tip: o?.payload?.tip || undefined,
        };
        setFallbackOrder(normalized);
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [order, selectedOrderId]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (order) {
        setRemoteOrder(null);
        setRemoteError(null);
        return;
      }
      if (!selectedOrderId) {
        setRemoteOrder(null);
        setRemoteError(null);
        return;
      }

      try {
        setRemoteError(null);
        const res = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(selectedOrderId)}`));
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || String(res.status));
        if (!mounted) return;

        const row = json?.order;
        const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
        const createdAt = typeof row?.createdAt === 'string' && row.createdAt ? row.createdAt : typeof payload?.createdAt === 'string' ? payload.createdAt : new Date().toISOString();
        const number = typeof payload?.number === 'string' && payload.number ? payload.number : String(row?.id || selectedOrderId);
        const items = Array.isArray(payload?.items) ? (payload.items as any[]) : [];

        const normalized = {
          id: String(row?.id || selectedOrderId),
          number,
          tableId: typeof payload?.tableId === 'string' ? payload.tableId : '',
          tableName: typeof payload?.tableName === 'string' ? payload.tableName : '',
          items: items
            .map((it) => ({
              productId: String((it as any)?.productId || (it as any)?.product_id || ''),
              name: String((it as any)?.name || ''),
              unitPrice: Number((it as any)?.unitPrice ?? (it as any)?.unit_price ?? 0) || 0,
              qty: Number((it as any)?.qty ?? 0) || 0,
              note: typeof (it as any)?.note === 'string' ? (it as any).note : undefined,
              voidedQty: Number((it as any)?.voidedQty ?? (it as any)?.voided_qty ?? 0) || 0,
              voidReason: typeof (it as any)?.voidReason === 'string' ? (it as any).voidReason : typeof (it as any)?.void_reason === 'string' ? (it as any).void_reason : undefined,
            }))
            .filter((it) => it.productId && it.name && it.qty > 0),
          subtotal: Number(payload?.subtotal ?? 0) || 0,
          tax: Number(row?.tax ?? payload?.tax ?? 0) || 0,
          serviceCharge: Number(payload?.serviceCharge ?? 0) || 0,
          discount: Number(row?.discount ?? payload?.discount ?? 0) || 0,
          tip: Number(row?.tip ?? payload?.tip ?? 0) || 0,
          total: Number(row?.total ?? payload?.total ?? 0) || 0,
          status: String(row?.status || payload?.status || 'Pending'),
          createdAt,
          paidAt: (typeof row?.paidAt === 'string' && row.paidAt) ? row.paidAt : (typeof payload?.paidAt === 'string' ? payload.paidAt : undefined),
          timeLabel: typeof payload?.timeLabel === 'string' && payload.timeLabel ? payload.timeLabel : undefined,
          paymentMethod: typeof payload?.paymentMethod === 'string' ? payload.paymentMethod : undefined,
          paymentReference: typeof payload?.paymentReference === 'string' ? payload.paymentReference : undefined,
          tenderedAmount: typeof payload?.tenderedAmount === 'number' ? payload.tenderedAmount : undefined,
          customer: payload?.customer && typeof payload.customer === 'object' ? payload.customer : undefined,
          splits: Array.isArray(payload?.splits) ? payload.splits : undefined,
        } as any;

        setRemoteOrder(normalized);
      } catch (e) {
        if (!mounted) return;
        setRemoteOrder(null);
        setRemoteError(e instanceof Error ? e.message : 'Failed to load order');
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [order, selectedOrderId]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(RECEIPT_SPLIT_KEY) || '';
      setReceiptSplitId(v);
    } catch {
      setReceiptSplitId('');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch('/api/pos/settings');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        if (!mounted) return;
        setPosSettings((json && typeof json === 'object' ? json : null) as any);
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const displayOrder = useMemo(() => {
    const base = effectiveOrder as any;
    if (!base) return null;
    if (!receiptSplitId) return base;
    const splits = Array.isArray(base.splits) ? base.splits : [];
    const sp = splits.find((x: any) => x && x.id === receiptSplitId) || null;
    if (!sp) return base;

    const qtyByProductId = new Map<string, number>();
    for (const it of Array.isArray(sp.items) ? sp.items : []) {
      if (!it || typeof it !== 'object') continue;
      const pid = String(it.productId || '');
      const q = Number(it.qty) || 0;
      if (!pid || q <= 0) continue;
      qtyByProductId.set(pid, (qtyByProductId.get(pid) || 0) + q);
    }

    const items = (Array.isArray(base.items) ? base.items : [])
      .map((it: any) => {
        const q = qtyByProductId.get(String(it.productId || '')) || 0;
        if (q <= 0) return null;
        return { ...it, qty: q };
      })
      .filter(Boolean);

    return {
      ...base,
      items,
      subtotal: Number(sp.subtotal) || 0,
      tax: Number(sp.tax) || 0,
      serviceCharge: Number(sp.serviceCharge) || 0,
      total: Number(sp.total) || 0,
      paymentMethod: sp.paymentMethod || base.paymentMethod,
      paymentReference: sp.paymentReference || base.paymentReference,
      paidAt: sp.paidAt || base.paidAt,
    };
  }, [effectiveOrder, receiptSplitId]);

  const effectiveOrderTyped = displayOrder as any;

  const settingsUi = useMemo(() => {
    const currency = typeof posSettings?.general?.currency === 'string' ? posSettings.general.currency : 'ETB';
    const timezone = typeof posSettings?.general?.timezone === 'string' ? posSettings.general.timezone : '';
    const vatEnabled = posSettings?.taxes?.vatEnabled !== false;
    const vatRate = Number.isFinite(Number(posSettings?.taxes?.vatRate)) ? Number(posSettings?.taxes?.vatRate) : 15;
    const serviceEnabled = posSettings?.taxes?.serviceChargeEnabled === true;
    const serviceRate = Number.isFinite(Number(posSettings?.taxes?.serviceChargeRate)) ? Number(posSettings?.taxes?.serviceChargeRate) : 10;
    const footer1 = typeof posSettings?.receipt?.footer1 === 'string' ? posSettings.receipt.footer1.trim() : '';
    const footer2 = typeof posSettings?.receipt?.footer2 === 'string' ? posSettings.receipt.footer2.trim() : '';
    const biz = typeof posSettings?.business?.businessName === 'string' ? posSettings.business.businessName.trim() : '';
    const tin = typeof posSettings?.business?.tin === 'string' ? posSettings.business.tin.trim() : '';
    const phone = typeof posSettings?.business?.phone === 'string' ? posSettings.business.phone.trim() : '';
    const address = typeof posSettings?.business?.address === 'string' ? posSettings.business.address.trim() : '';
    const showTin = posSettings?.receipt?.showTin !== false;
    return {
      footer1,
      footer2,
      currency: String(currency || 'ETB').toUpperCase(),
      timezone,
      vatEnabled,
      vatRate,
      serviceEnabled,
      serviceRate,
      businessName: biz,
      tin,
      phone,
      address,
      showTin,
      autoPrintReceipts: posSettings?.printers?.autoPrintReceipts === true,
      defaultReceiptPrinterId: posSettings?.printers?.defaultReceiptPrinterId ?? null,
    };
  }, [posSettings]);

  const itemCount = useMemo(
    () => (displayOrder ? (displayOrder as any).items.reduce((sum: number, i: any) => sum + (Number(i.qty) || 0), 0) : 0),
    [displayOrder],
  );

  useEffect(() => {
    if (!displayOrder) return;

    try {
      const enabled = settingsUi.autoPrintReceipts === true;
      if (!enabled) return;

      // If a split receipt is displayed, fall back to browser printing for now.
      if (receiptSplitId) return;

      const key = `mirachpos.printedReceipt.${displayOrder.id}.${receiptSplitId || 'full'}`;
      if (sessionStorage.getItem(key) === '1') return;
      sessionStorage.setItem(key, '1');

      const deviceId = typeof settingsUi.defaultReceiptPrinterId === 'string' ? settingsUi.defaultReceiptPrinterId : null;
      if (deviceId) {
        const t = window.setTimeout(() => {
          void apiFetch(withBranchQuery(`/api/pos/print/receipt/${encodeURIComponent(String(displayOrder.id))}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId }),
          }).catch(() => {
            const ok = openPrintWindow(receiptHtml(effectiveOrderTyped, settingsUi));
            if (!ok) window.print();
          });
        }, 250);
        return () => window.clearTimeout(t);
      }

      const t = window.setTimeout(() => {
        const ok = openPrintWindow(receiptHtml(effectiveOrderTyped, settingsUi));
        if (!ok) window.print();
      }, 350);
      return () => window.clearTimeout(t);
    } catch {
      return;
    }
  }, [displayOrder, receiptSplitId]);

  useEffect(() => {
    if (!receiptSplitId) return;
    if (!displayOrder) return;
    try {
      localStorage.removeItem(RECEIPT_SPLIT_KEY);
    } catch {
      // ignore
    }
  }, [receiptSplitId, displayOrder]);

  if (!effectiveOrderTyped) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-[#221c11] text-white">
        <header className="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-solid border-[#483c23] bg-[#2c241b] px-6 py-3">
          <div className="flex items-center gap-4 text-white">
            <div className="size-8 flex items-center justify-center rounded-lg bg-[#eead2b] text-[#221c11]">
              <span className="material-symbols-outlined">receipt_long</span>
            </div>
            <h2 className="text-white text-xl font-bold leading-tight tracking-tight">Receipt</h2>
          </div>
          <button onClick={() => onNavigate(Screen.WAITER_HISTORY)} className="flex items-center justify-center h-10 px-4 rounded-lg border border-[#483c23] hover:bg-[#3a2e22] transition-colors text-[#c9b792] text-sm font-medium">
            <span className="material-symbols-outlined text-lg mr-2">arrow_back</span> Back
          </button>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center text-[#c9b792] px-6 text-center gap-3">
          <div>{remoteError ? `Failed to load order: ${remoteError}` : 'No order selected.'}</div>
          {selectedOrderId ? <div className="text-xs opacity-80">Order ID: {selectedOrderId}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c11] text-white">
      <header className="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-solid border-[#483c23] bg-[#2c241b] px-6 py-3">
        <div className="flex items-center gap-4 text-white">
          <div className="size-8 flex items-center justify-center rounded-lg bg-[#eead2b] text-[#221c11]">
            <span className="material-symbols-outlined">receipt_long</span>
          </div>
          <h2 className="text-white text-xl font-bold leading-tight tracking-tight">Receipt</h2>
          <div className="h-6 w-px bg-[#483c23] mx-2"></div>
          <div className="flex flex-col">
            <span className="text-sm font-bold leading-none">{effectiveOrderTyped.tableName}</span>
            <span className="text-xs text-[#c9b792] leading-none mt-1">{effectiveOrderTyped.number}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => onNavigate(Screen.WAITER_HISTORY)} className="flex items-center justify-center h-10 px-4 rounded-lg border border-[#483c23] hover:bg-[#3a2e22] transition-colors text-[#c9b792] text-sm font-medium">
            <span className="material-symbols-outlined text-lg mr-2">arrow_back</span> History
          </button>
          <button
            onClick={() => {
              if (!effectiveOrder) return;
              try {
                const deviceId = typeof settingsUi.defaultReceiptPrinterId === 'string' ? settingsUi.defaultReceiptPrinterId : null;
                if (deviceId && !receiptSplitId) {
                  void apiFetch(withBranchQuery(`/api/pos/print/receipt/${encodeURIComponent(String(effectiveOrderTyped.id))}`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceId }),
                  }).catch(() => {
                    const ok = openPrintWindow(receiptHtml(effectiveOrderTyped, settingsUi));
                    if (!ok) window.print();
                  });
                  return;
                }
              } catch {
                // ignore
              }

              const ok = openPrintWindow(receiptHtml(effectiveOrderTyped, settingsUi));
              if (!ok) window.print();
            }}
            className="h-11 px-4 rounded-lg bg-[#eead2b] hover:bg-[#d49a26] text-[#181611] font-bold flex items-center"
          >
            <span className="material-symbols-outlined text-lg mr-2">print</span> Print
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[520px] bg-[#2c241b] border border-[#483c23] rounded-xl overflow-hidden">
          <div className="p-6 border-b border-[#483c23]">
            <div className="flex justify-between">
              <div>
                <div className="text-white font-bold text-lg">{settingsUi.businessName || '-'}</div>
                <div className="text-[#c9b792] text-sm mt-1">{settingsUi.address || '-'}</div>
                <div className="text-[#c9b792] text-sm">{settingsUi.phone || '-'}</div>
                {settingsUi.showTin ? <div className="text-[#c9b792] text-xs mt-1">TIN: {settingsUi.tin || '-'}</div> : null}
              </div>
              <div className="text-right">
                <div className="text-white font-mono font-bold">{effectiveOrderTyped.number}</div>
                <div className="text-[#c9b792] text-sm">{effectiveOrderTyped.timeLabel}</div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="flex justify-between text-sm text-[#c9b792]">
              <span>Table</span>
              <span className="text-white font-medium">{effectiveOrderTyped.tableName}</span>
            </div>
            <div className="flex justify-between text-sm text-[#c9b792] mt-2">
              <span>Items</span>
              <span className="text-white font-medium">{itemCount}</span>
            </div>
            <div className="flex justify-between text-sm text-[#c9b792] mt-2">
              <span>Payment</span>
              <span className="text-white font-medium">{effectiveOrderTyped.paymentMethod ?? '-'}</span>
            </div>

            {effectiveOrderTyped.paymentReference ? (
              <div className="flex justify-between text-sm text-[#c9b792] mt-2">
                <span>Reference</span>
                <span className="text-white font-mono font-bold">{String(effectiveOrderTyped.paymentReference)}</span>
              </div>
            ) : null}

            {effectiveOrderTyped.customer ? (
              <div className="flex justify-between text-sm text-[#c9b792] mt-2">
                <span>Customer</span>
                <span className="text-white font-medium">{effectiveOrderTyped.customer.name} ({effectiveOrderTyped.customer.phone})</span>
              </div>
            ) : null}

            <div className="mt-6 border-t border-[#483c23] pt-4">
              <div className="text-xs text-[#c9b792] font-bold uppercase tracking-wider mb-3">Line Items</div>
              <div className="flex flex-col gap-3">
                {effectiveOrderTyped.items.map((i) => (
                  <div key={i.productId} className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-white font-semibold">{i.name}</span>
                      <span className="text-[#c9b792] text-xs">{i.qty} x {settingsUi.currency} {i.unitPrice.toFixed(2)}</span>
                    </div>
                    <span className="text-white font-mono font-bold">{settingsUi.currency} {(i.unitPrice * i.qty).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 border-t border-[#483c23] pt-4">
              <div className="flex justify-between text-sm text-[#c9b792]">
                <span>Subtotal</span>
                <span className="text-white font-medium">{settingsUi.currency} {effectiveOrderTyped.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-[#c9b792] mt-2">
                <span>{settingsUi.vatEnabled ? `Tax (${settingsUi.vatRate}%)` : 'Tax (disabled)'}</span>
                <span className="text-white font-medium">{settingsUi.currency} {effectiveOrderTyped.tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-[#c9b792] mt-2">
                <span>{settingsUi.serviceEnabled ? `Service (${settingsUi.serviceRate}%)` : 'Service (disabled)'}</span>
                <span className="text-white font-medium">{settingsUi.currency} {effectiveOrderTyped.serviceCharge.toFixed(2)}</span>
              </div>
              {Number((effectiveOrderTyped as any).tip ?? 0) > 0 ? (
                <div className="flex justify-between text-sm text-[#c9b792] mt-2">
                  <span>Tip</span>
                  <span className="text-white font-medium">{settingsUi.currency} {Number((effectiveOrderTyped as any).tip ?? 0).toFixed(2)}</span>
                </div>
              ) : null}
              <div className="flex justify-between items-center mt-4 pt-4 border-t border-dashed border-[#483c23]">
                <span className="text-white font-bold text-lg">Total</span>
                <span className="text-[#eead2b] font-black text-2xl">{settingsUi.currency} {effectiveOrderTyped.total.toFixed(2)}</span>
              </div>
            </div>

            {(settingsUi.footer1 || settingsUi.footer2) && (
              <div className="mt-8 pt-4 border-t border-[#483c23]">
                {settingsUi.footer1 && <div className="text-center text-[#c9b792] text-sm">{settingsUi.footer1}</div>}
                {settingsUi.footer2 && <div className="text-center text-[#c9b792] text-sm mt-1">{settingsUi.footer2}</div>}
              </div>
            )}

            <div className="mt-4 text-center text-[#c9b792] text-xs">Powered by Mirach POS</div>
          </div>
        </div>
      </main>
    </div>
  );
};
