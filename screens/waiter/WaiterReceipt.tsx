import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePos, useSelectedOrder } from '../../PosContext';
import { Screen } from '../../types';
import { apiFetch } from '../../api';
import { readSession } from '../../session';
import { formatDeviceDate, formatDeviceTime } from '../../datetime';

import { AppIcon } from '@/components/ui/app-icon';
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
const DISPLAY_ENABLED_KEY = 'mirachpos.customerDisplay.enabled.v1';

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
  receiptVerifyUrl?: string,
  renderMode?: 'preview' | 'print',
) => {
  const expandNewlines = (v: string) => {
    try {
      // Some tenants store multi-line values as literal "\n" or "\\n".
      // Normalize both forms into actual newlines.
      return String(v || '')
        .replace(/\\\\n/g, '\n')
        .replace(/\\n/g, '\n');
    } catch {
      return String(v || '');
    }
  };
  const splitLines = (v: string) => {
    const raw = expandNewlines(v);
    return raw
      .split(/\r?\n/)
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  };

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
      return formatDeviceDate(dt, { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const yy = String(dt.getFullYear());
      return `${dd}/${mm}/${yy}`;
    }
  })();

  const timeStr = (() => {
    try {
      return formatDeviceTime(dt, { hour: '2-digit', minute: '2-digit', hour12: true });
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
  const payloadObj = (order as any)?.payload && typeof (order as any).payload === 'object' ? (order as any).payload : null;
  const payloadSubtotal = Number(payloadObj?.subtotal ?? 0) || 0;
  const payloadDiscount = Number(payloadObj?.discount ?? 0) || 0;
  const payloadTax = Number(payloadObj?.tax ?? 0) || 0;
  const payloadTip = Number(payloadObj?.tip ?? 0) || 0;
  const payloadServiceCharge = Number(payloadObj?.serviceCharge ?? payloadObj?.service_charge ?? 0) || 0;

  const takeawayFee = Math.max(0, Number((order as any)?.takeawayFee ?? payloadObj?.takeawayFee ?? payloadObj?.takeaway_fee ?? 0) || 0);
  const orderType = String((order as any)?.orderType ?? payloadObj?.orderType ?? payloadObj?.order_type ?? '').trim();

  const baseSubtotal = Number(order.subtotal || 0) || payloadSubtotal;
  const baseDiscount = discount || payloadDiscount;
  const baseTax = Number(order.tax || 0) || payloadTax;
  const baseTip = Number((order as any)?.tip ?? 0) || payloadTip;
  const totalForDerive = Number(order.total || 0) || Number(payloadObj?.total ?? 0) || 0;
  const derivedServiceCharge = Math.max(0, totalForDerive - Math.max(0, baseSubtotal - baseDiscount) - baseTax - baseTip - takeawayFee);
  const serviceCharge = Number(order.serviceCharge) || payloadServiceCharge || derivedServiceCharge;
  const taxableBase = Math.max(0, Number(order.subtotal || 0) - discount + serviceCharge);
  const taxRateLabel = settings.vatEnabled ? `${settings.vatRate.toFixed(2)}%` : '';
  const serviceLabel = settings.serviceEnabled ? `SERVICE CHARGE +${settings.serviceRate.toFixed(0)}%` : 'SERVICE CHARGE';

  const tip = (() => {
    const direct = Number((order as any)?.tip ?? 0) || 0;
    if (direct > 0.0001) return direct;
    const p = (order as any)?.payload && typeof (order as any).payload === 'object' ? (order as any).payload : null;
    const fromPayloadTip = Number(p?.tip ?? 0) || 0;
    if (fromPayloadTip > 0.0001) return fromPayloadTip;
    const fromBreakdown = (Number(p?.tipAmount ?? 0) || 0) + (Number(p?.tipPctAmount ?? 0) || 0);
    return fromBreakdown;
  })();

  const tendered = Number((order as any)?.tenderedAmount ?? 0) || 0;
  const change = Math.max(0, tendered - Number(order.total || 0));
  const payMethod = String((order as any)?.paymentMethod || order.paymentMethod || 'CASH').toUpperCase();
  const ref = String((order as any)?.paymentReference || '').trim();

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
  const fmtAmt = (n: number) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '0.00');
  const safe = (v: any) => escapeHtml(String(v ?? '').trim());

  const headerBizLines = splitLines(settings.businessName);
  const headerAddrLines = splitLines(settings.address);

  const title = payMethod === 'CASH' ? 'Cash Invoice' : 'Receipt';
  const orderNo = String(order.number || '').trim();

  const itemRows = order.items.slice(0, 200).map((it) => {
    const name = String(it?.name || '').trim() || '-';
    const qty = Math.max(0, Number(it?.qty ?? 0) || 0);
    const unit = Math.max(0, Number(it?.unitPrice ?? 0) || 0);
    const amount = qty * unit;
    return {
      name,
      qty,
      amount,
    };
  });

  const totals: Array<{ label: string; value: number }> = [];
  totals.push({ label: 'SUBTOTAL', value: Number(order.subtotal || 0) || 0 });
  if (discount > 0.0001 || discountPct > 0.0001) totals.push({ label: discountPct > 0.0001 ? `DISCOUNT (${discountPct.toFixed(0)}%)` : 'DISCOUNT', value: -Math.abs(discount) });
  if (serviceCharge > 0.0001) totals.push({ label: serviceLabel.includes('%') ? serviceLabel.replace('+', '').trim() : serviceLabel, value: serviceCharge });
  if (settings.vatEnabled) totals.push({ label: `TAX (${String(settings.vatRate || 0).trim()}%)`, value: Number(order.tax || 0) || 0 });
  if (takeawayFee > 0.0001) totals.push({ label: 'TAKEAWAY FEE', value: takeawayFee });
  if (tip > 0.0001) totals.push({ label: 'TIP', value: tip });

  const html = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Receipt</title>
      <style>
        :root{--paper:#ffffff;--ink:#111827;--muted:#6b7280;--border:#e5e7eb;--shadow:0 24px 60px rgba(0,0,0,.22);} 
        *{box-sizing:border-box;}
        html,body{margin:0;padding:0; overflow:hidden;}
        body{background:transparent; color:var(--ink);
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Liberation Sans", sans-serif;
        }
        .wrap{padding:0; display:flex; justify-content:center; align-items:flex-start;}
        .paper{width:100%; max-width:420px; background:var(--paper); box-shadow:var(--shadow); position:relative;}
        .paper-top-gap{height:16px; width:100%; background:var(--paper); position:relative; top:-8px;}
        .content{padding:24px 32px 22px; text-align:center;}
        .serif{font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;}
        .mono{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;}
        .title{font-size:30px; font-weight:700; letter-spacing:.02em; margin:4px 0 4px; color:#111827;}
        .subtitle{font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.14em; margin:0;}
        .bizmeta{margin-top:18px; font-size:12px; color:var(--muted); line-height:1.6;}
        .divider{width:100%; border-top:2px dashed var(--border); margin:16px 0;}
        .row{display:flex; justify-content:space-between; align-items:baseline; gap:16px;}
        .invoice{font-size:14px; font-weight:700; margin:10px 0;}
        .small{font-size:12px; color:var(--muted); line-height:1.7; text-align:left;}
        .small p{margin:0;}
        .tableHead{display:flex; justify-content:space-between; font-size:12px; font-weight:700; border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:10px;}
        .w50{width:50%; text-align:left;}
        .w25c{width:25%; text-align:center;}
        .w25r{width:25%; text-align:right;}
        .item{display:flex; justify-content:space-between; align-items:flex-start; font-size:14px; margin:10px 0;}
        .item .name{font-weight:700;}
        .item .note{font-size:12px; color:var(--muted); margin-top:2px;}
        .totals{margin-top:6px; font-size:14px;}
        .totals .k{color:var(--muted);}
        .grand{margin-top:14px; padding-top:14px; border-top:2px solid #111827; font-weight:700; font-size:20px;}
        .payline{margin-top:4px; font-size:12px; color:var(--muted);}
        .qrwrap{margin-top:18px; display:flex; justify-content:center;}
        .qr{width:132px; height:132px; object-fit:contain; border:1px solid var(--border); padding:8px; background:#fff;}
        .thanks{margin-top:14px; color:var(--muted); font-size:14px; font-style:italic;}
        .powered{margin-top:4px; font-size:10px; text-transform:uppercase; letter-spacing:.14em; color:#9ca3af;}
        .tear-bottom{position:relative; bottom:-8px; width:100%; height:16px; color:#ffffff;
          background-image: linear-gradient(-45deg, transparent 50%, currentColor 50%), linear-gradient(225deg, currentColor 50%, transparent 50%);
          background-position: bottom;
          background-repeat: repeat-x;
          background-size: 16px 16px;
        }
        ::-webkit-scrollbar{width:0;height:0;}
        @page{size:80mm auto; margin:4mm;}
        @media print{
          body{background:#fff;}
          .paper{max-width:none; width:80mm; box-shadow:none;}
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="paper">
          <div class="paper-top-gap"></div>
          <div class="content">
            <div class="serif title">${safe(headerBizLines[0] || settings.businessName || biz || '-')}</div>

            <div class="mono bizmeta">
              ${settings.showTin ? `<p>TIN: ${safe(tin || '-')}</p>` : ''}
              ${addressLine ? `<p>${safe(addressLine)}</p>` : ''}
              ${phoneLine ? `<p>${safe(phoneLine)}</p>` : ''}
              <p>Date: ${safe(dateStr)} ${safe(timeStr)}</p>
            </div>

            <div class="divider"></div>

            <div class="mono row invoice">
              <span>${safe(payMethod === 'CASH' ? 'CASH INVOICE' : 'RECEIPT')}</span>
              <span>#A</span>
            </div>

            <div class="mono small">
              <p>CUSTOMER: ${safe(order.customer ? customerLabel : '_WALKING')}</p>
              <p>CASHIER: ${safe(operator || '-')}</p>
              <p>WAITER: ${safe(waiter || '-')}</p>
              ${tableNo ? `<p>TABLE NO: ${safe(tableNo)}</p>` : ''}
              ${orderType === 'takeaway' ? `<p>ORDER TYPE: TAKEAWAY</p>` : ''}
              ${ref ? `<p>REF: ${safe(ref)}</p>` : ''}
            </div>

            <div class="divider"></div>

            <div class="mono tableHead">
              <span class="w50">DESCRIPTION</span>
              <span class="w25c">QTY</span>
              <span class="w25r">AMT</span>
            </div>

            <div class="mono" style="text-align:left;">
              ${order.items
                .slice(0, 200)
                .map((it) => {
                  const nm = String(it?.name || '').trim() || '-';
                  const qty = Math.max(0, Number(it?.qty ?? 0) || 0);
                  const unit = Math.max(0, Number(it?.unitPrice ?? 0) || 0);
                  const amount = qty * unit;
                  const note = typeof (it as any)?.note === 'string' ? String((it as any).note).trim() : '';
                  return `
                    <div class="item">
                      <div class="w50">
                        <div class="name">${safe(nm)}</div>
                        ${note ? `<div class="note">${safe(note)}</div>` : ''}
                      </div>
                      <div class="w25c">${safe(qty)}</div>
                      <div class="w25r">${safe(fmtAmt(amount))}</div>
                    </div>
                  `;
                })
                .join('')}
            </div>

            <div class="divider"></div>

            <div class="mono totals">
              ${totals
                .map(
                  (t) => `
                    <div class="row">
                      <span class="k">${safe(t.label)}</span>
                      <span>${safe(fmtAmt(t.value))}</span>
                    </div>
                  `,
                )
                .join('')}

              <div class="row grand">
                <span>TOTAL</span>
                <span>${safe(fmtAmt(Number(order.total || 0)))}</span>
              </div>
              <div class="row payline">
                <span>${safe(payMethod || 'CASH')}</span>
                <span>${safe(fmtAmt(Number(order.total || 0)))}</span>
              </div>
            </div>

            ${receiptVerifyUrl ? `
              <div class="qrwrap">
                <img class="qr" alt="Verify" src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(String(receiptVerifyUrl))}" />
              </div>
            ` : ''}
            <div class="serif thanks">Thank you for visiting!</div>
            <div class="mono powered">Powered by Mirach POS</div>
          </div>
          <div class="tear-bottom"></div>
        </div>
      </div>
      <script>
        (function () {
          function send() {
            try {
              var h = Math.max(
                document.documentElement ? document.documentElement.scrollHeight : 0,
                document.body ? document.body.scrollHeight : 0
              );
              parent && parent.postMessage && parent.postMessage({ type: 'mirachpos_receipt_height', height: h }, '*');
            } catch (e) {
            }
          }
          try {
            window.addEventListener('load', send);
            window.addEventListener('resize', send);
            setTimeout(send, 50);
            setTimeout(send, 250);
            setTimeout(send, 750);
          } catch (e) {
          }
        })();
      </script>
    </body>
  </html>
  `;

  return html;
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
  const [receiptFrameHeight, setReceiptFrameHeight] = useState<number>(860);
  const [receiptVerifyUrl, setReceiptVerifyUrl] = useState<string>('');
  const [displayEnabled] = useState(() => {
    try {
      return sessionStorage.getItem(DISPLAY_ENABLED_KEY) === '1';
    } catch {
      return false;
    }
  });

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
        if (!mounted) return;

        const o = json?.order;
        if (!o || typeof o !== 'object') return;
        // Normalize into PosOrder-like shape expected by this screen.
        const items = Array.isArray(o.items) ? o.items : [];
        const normalized = {
          id: String(o.id || ''),
          tableName: String(o.tableName || ''),
          number: String(o.number || ''),
          items: Array.isArray(o.items) ? o.items : [],
          subtotal: Number(o.subtotal ?? 0) || 0,
          tax: Number(o.tax ?? 0) || 0,
          serviceCharge: Number(o.serviceCharge ?? 0) || 0,
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
          tip: (() => {
            const t = Number(o?.tip ?? o?.payload?.tip ?? 0) || 0;
            if (t > 0.0001) return t;
            const tb = (Number(o?.payload?.tipAmount ?? 0) || 0) + (Number(o?.payload?.tipPctAmount ?? 0) || 0);
            return tb > 0.0001 ? tb : undefined;
          })(),
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
          tip: (() => {
            const t = Number(row?.tip ?? payload?.tip ?? 0) || 0;
            if (t > 0.0001) return t;
            return (Number(payload?.tipAmount ?? 0) || 0) + (Number(payload?.tipPctAmount ?? 0) || 0);
          })(),
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

  const updateDisplayMode = useCallback(async (mode: 'menu' | 'payment' | 'receipt') => {
    const oid = displayOrder?.id ? String((displayOrder as any).id) : '';
    if (!oid) return;
    try {
      await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(oid)}/display-mode`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } catch {
      // ignore
    }
  }, [displayOrder?.id]);

  useEffect(() => {
    if (!displayEnabled) return;
    void updateDisplayMode('receipt');
  }, [displayEnabled, updateDisplayMode]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const oid = displayOrder?.id ? String((displayOrder as any).id) : '';
        if (!oid) return;
        // Don't attach verification QR to split receipts for now.
        if (receiptSplitId) {
          if (mounted) setReceiptVerifyUrl('');
          return;
        }

        const res = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(oid)}/receipt-link`));
        const json = (await res.json().catch(() => null)) as any;
        if (!mounted) return;
        if (!res.ok) {
          setReceiptVerifyUrl('');
          return;
        }
        const url = typeof json?.receiptUrl === 'string' ? json.receiptUrl.trim() : '';
        setReceiptVerifyUrl(url);
      } catch {
        if (!mounted) return;
        setReceiptVerifyUrl('');
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [displayOrder?.id, receiptSplitId]);

  const itemCount = useMemo(
    () => (displayOrder ? (displayOrder as any).items.reduce((sum: number, i: any) => sum + (Number(i.qty) || 0), 0) : 0),
    [displayOrder],
  );

  const receiptDoc = useMemo(() => {
    try {
      if (!effectiveOrderTyped) return '';
      return receiptHtml(effectiveOrderTyped, settingsUi, receiptVerifyUrl || undefined, 'preview');
    } catch {
      return '';
    }
  }, [effectiveOrderTyped, settingsUi, receiptVerifyUrl]);

  useEffect(() => {
    try {
      if (!displayOrder?.id) return;
      const oid = String(displayOrder.id);
      if (!oid) return;

      const key = `mirachpos.manualPrintReceiptOnce.${oid}`;
      if (sessionStorage.getItem(key) !== '1') return;
      sessionStorage.removeItem(key);

      const deviceId = typeof settingsUi.defaultReceiptPrinterId === 'string' ? settingsUi.defaultReceiptPrinterId : null;
      if (deviceId && !receiptSplitId) {
        void apiFetch(withBranchQuery(`/api/pos/print/receipt/${encodeURIComponent(String(oid))}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId }),
        }).catch(() => {
          const ok = openPrintWindow(receiptHtml(effectiveOrderTyped, settingsUi, receiptVerifyUrl || undefined, 'print'));
          if (!ok) window.print();
        });
        return;
      }

      const ok = openPrintWindow(receiptHtml(effectiveOrderTyped, settingsUi, receiptVerifyUrl || undefined, 'print'));
      if (!ok) window.print();
    } catch {
      // ignore
    }
  }, [displayOrder?.id, effectiveOrderTyped, receiptSplitId, receiptVerifyUrl, settingsUi]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      try {
        const data: any = (ev as any)?.data;
        if (!data || data.type !== 'mirachpos_receipt_height') return;
        const h = Number(data.height || 0) || 0;
        if (h <= 0) return;
        setReceiptFrameHeight((prev) => {
          const next = Math.max(420, Math.min(2400, Math.ceil(h)));
          return prev === next ? prev : next;
        });
      } catch {
        // ignore
      }
    };
    try {
      window.addEventListener('message', onMsg);
      return () => window.removeEventListener('message', onMsg);
    } catch {
      return;
    }
  }, []);

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
            const ok = openPrintWindow(receiptHtml(effectiveOrderTyped, settingsUi, receiptVerifyUrl || undefined, 'print'));
            if (!ok) window.print();
          });
        }, 250);
        return () => window.clearTimeout(t);
      }

      const t = window.setTimeout(() => {
        const ok = openPrintWindow(receiptHtml(effectiveOrderTyped, settingsUi, receiptVerifyUrl || undefined, 'print'));
        if (!ok) window.print();
      }, 350);
      return () => window.clearTimeout(t);
    } catch {
      return;
    }
  }, [displayOrder, receiptSplitId, receiptVerifyUrl]);

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
      <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
        <header className="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-solid border-border bg-card px-6 py-3">
          <div className="flex items-center gap-4 text-foreground">
            <div className="size-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <AppIcon name="receipt_long" />
            </div>
            <h2 className="text-foreground text-xl font-bold leading-tight tracking-tight">Receipt</h2>
          </div>
          <button onClick={() => onNavigate(Screen.WAITER_HISTORY)} className="flex items-center justify-center h-10 px-4 rounded-lg border border-border hover:bg-secondary transition-colors text-muted-foreground text-sm font-medium">
            <AppIcon name="arrow_back" className="text-lg mr-2" size={18} /> Back
          </button>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground px-6 text-center gap-3">
          <div>{remoteError ? `Failed to load order: ${remoteError}` : 'No order selected.'}</div>
          {selectedOrderId ? <div className="text-xs opacity-80">Order ID: {selectedOrderId}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-solid border-border bg-card px-6 py-3">
        <div className="flex items-center gap-4 text-foreground">
          <div className="size-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <AppIcon name="receipt_long" />
          </div>
          <h2 className="text-foreground text-xl font-bold leading-tight tracking-tight">Receipt</h2>
          <div className="h-6 w-px bg-border mx-2"></div>
          <div className="flex flex-col">
            <span className="text-sm font-bold leading-none">{effectiveOrderTyped.tableName}</span>
            <span className="text-xs text-muted-foreground leading-none mt-1">{effectiveOrderTyped.number}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              if (displayEnabled) void updateDisplayMode('menu');
              onNavigate(Screen.WAITER_HISTORY);
            }}
            className="flex items-center justify-center h-10 px-4 rounded-lg border border-border hover:bg-secondary transition-colors text-muted-foreground text-sm font-medium"
          >
            <AppIcon name="arrow_back" className="text-lg mr-2" size={18} /> History
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
                    const ok = openPrintWindow(receiptDoc || receiptHtml(effectiveOrderTyped, settingsUi, receiptVerifyUrl || undefined, 'print'));
                    if (!ok) window.print();
                  });
                  return;
                }
              } catch {
                // ignore
              }

              const ok = openPrintWindow(receiptDoc || receiptHtml(effectiveOrderTyped, settingsUi, receiptVerifyUrl || undefined, 'print'));
              if (!ok) window.print();
            }}
            className="h-11 px-4 rounded-lg bg-primary hover:bg-primary/80 text-primary-foreground font-bold flex items-center"
          >
            <AppIcon name="print" className="text-lg mr-2" size={18} /> Print
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[760px]">
          <div className="flex justify-center">
            <div className="w-full max-w-md">
              <iframe
                title="receipt-preview"
                sandbox="allow-same-origin allow-scripts"
                srcDoc={receiptDoc || '<html><body></body></html>'}
                className="w-full border-0"
                style={{ height: receiptFrameHeight, background: 'transparent' }}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
