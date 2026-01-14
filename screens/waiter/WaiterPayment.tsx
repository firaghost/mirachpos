import React, { useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos, useSelectedOrder } from '../../PosContext';
import { apiFetch, resolveAssetUrl } from '../../api';
import { Modal } from '../../components/Modal';
import { usePersistedState } from '../../usePersistedState';
import { readSession } from '../../session';

interface Props {
  onNavigate: (screen: Screen) => void;
}

type PosSettingsResponse = {
  ok?: boolean;
  general?: { currency?: string };
  taxes?: { vatEnabled?: boolean; vatRate?: number; serviceChargeEnabled?: boolean; serviceChargeRate?: number };
  security?: { requirePinForDiscounts?: boolean };
  policies?: { maxDiscountPctWithoutApproval?: number };
  printers?: {
    autoPrintReceipts?: boolean;
    defaultReceiptPrinterId?: string | null;
  };
  payments?: {
    allowSplitPayments?: boolean;
    methods?: Array<{ id?: string; enabled?: boolean; label?: string; reason?: string }>;
  };
  branchPayments?: {
    qrCodes?: { telebirr?: string; bank_transfer?: string; card?: string };
    qrDetails?: {
      telebirr?: { image?: string; accountName?: string; phone?: string; merchantId?: string; note?: string };
      bank_transfer?: { image?: string; bankName?: string; accountName?: string; accountNumber?: string; phone?: string; note?: string };
      card?: { image?: string; merchantId?: string; note?: string };
    };
    requireReferenceForMethods?: string[];
  };
};

const RECEIPT_SPLIT_KEY = 'mirachpos.receipt.splitId.v1';

export const WaiterPayment: React.FC<Props> = ({ onNavigate }) => {
  const { confirmPayment, refreshFromServer, products, orders, tables, selectOrder, selectTable } = usePos();
  const order = useSelectedOrder();
  const [method, setMethod] = useState<'Cash' | 'Telebirr' | 'Bank Transfer' | 'Loyalty' | 'Mobile Pay'>('Cash');
  const [isOnline, setIsOnline] = useState(() => {
    try {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    } catch {
      return true;
    }
  });
  const [tendered, setTendered] = useState('');
  const [manualTip, setManualTip] = useState('');
  const [selectedSplitId, setSelectedSplitId] = useState<string>('');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [actionErr, setActionErr] = useState<string>('');
  const [posSettings, setPosSettings] = useState<PosSettingsResponse | null>(null);

  const [billCollapsed, setBillCollapsed] = usePersistedState<boolean>('mirachpos.waiter.payment.billSummaryCollapsed.v1', false, {
    validate: (v): v is boolean => typeof v === 'boolean',
  });

  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountValue, setDiscountValue] = useState('');
  const [discountPin, setDiscountPin] = useState('');
  const [discountErr, setDiscountErr] = useState('');
  const [discountSaving, setDiscountSaving] = useState(false);

  const recoverRef = React.useRef<string>('');

  // Telebirr Online States
  const [telebirrOnlineLoading, setTelebirrOnlineLoading] = useState(false);
  const [telebirrCheckoutUrl, setTelebirrCheckoutUrl] = useState<string | null>(null);
  const [telebirrOnlineActive, setTelebirrOnlineActive] = useState(false);
  const pollRef = React.useRef<any>(null);

  // Chapa Online (Mobile Pay) States
  const [chapaOnlineLoading, setChapaOnlineLoading] = useState(false);
  const [chapaCheckoutUrl, setChapaCheckoutUrl] = useState<string | null>(null);
  const [chapaOnlineActive, setChapaOnlineActive] = useState(false);
  const chapaPollRef = React.useRef<any>(null);
  const chapaInitAttemptRef = React.useRef<string>('');

  const paymentCompleteRef = React.useRef<string>('');

  const serverRefreshRef = React.useRef<any>(null);

  const withBranchQuery = (url: string) => {
    try {
      const s = readSession<any>();
      const role = typeof s?.role === 'string' ? s.role : '';
      const tokenBranch = typeof s?.branchId === 'string' ? s.branchId.trim() : '';

      // Branch-scoped tokens (Waiter/Manager or Owner already bound to a branch)
      if (tokenBranch && tokenBranch !== 'global') return url;

      // Owner "global" token must provide branchId in query for branch-scoped endpoints
      if (role !== 'Cafe Owner') return url;

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

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch(withBranchQuery('/api/pos/settings'));
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
      if (pollRef.current) clearInterval(pollRef.current);
      if (chapaPollRef.current) clearInterval(chapaPollRef.current);
      if (serverRefreshRef.current) clearInterval(serverRefreshRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      if (!order) return;

      const st = String(order.status || '').trim();
      const terminal = st === 'Paid' || st === 'Voided' || st === 'Refunded';
      if (!terminal) return;

      const tableId = String((order as any)?.tableId || '').trim();
      const tableName = String((order as any)?.tableName || '').trim();
      if (!tableId && !tableName) return;

      const tbl = Array.isArray(tables)
        ? tables.find((t: any) => {
            const tid = String(t?.id || '').trim();
            const tnm = String(t?.name || '').trim();
            if (tableId && tid === tableId) return true;
            if (tableName && tnm && tnm === tableName) return true;
            return false;
          })
        : null;
      const tblStatus = String((tbl as any)?.status || '').trim();
      if (tblStatus !== 'Payment') return;

      const candidates = (Array.isArray(orders) ? orders : [])
        .filter((o: any) => {
          const oid = String(o?.tableId || '').trim();
          const onm = String(o?.tableName || '').trim();
          if (tableId && oid === tableId) return true;
          if (tableName && onm && onm === tableName) return true;
          return false;
        })
        .filter((o: any) => {
          const s = String(o?.status || '').trim();
          return s !== 'Paid' && s !== 'Voided' && s !== 'Refunded';
        })
        .sort((a: any, b: any) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));

      const recovered = candidates[0];
      const nextId = recovered?.id ? String(recovered.id) : '';
      if (!nextId || nextId === String(order.id || '')) return;

      const key = `${String(order.id || '')}->${nextId}`;
      if (recoverRef.current === key) return;
      recoverRef.current = key;

      try {
        selectTable(tableId);
      } catch {
        // ignore
      }
      selectOrder(nextId);
      void refreshFromServer();
    } catch {
      // ignore
    }
  }, [order?.id, (order as any)?.status, (order as any)?.tableId, orders, tables, refreshFromServer, selectOrder, selectTable]);

  useEffect(() => {
    // Stop polling if we switch away from Telebirr or close online mode
    if (method !== 'Telebirr' || !telebirrOnlineActive) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [method, telebirrOnlineActive]);

  useEffect(() => {
    // Stop polling if we switch away from Mobile Pay or close online mode
    if (method !== 'Mobile Pay' || !chapaOnlineActive) {
      if (chapaPollRef.current) {
        clearInterval(chapaPollRef.current);
        chapaPollRef.current = null;
      }
    }
  }, [method, chapaOnlineActive]);

  useEffect(() => {
    // Refresh state on mount to ensure we have latest order status/payment info
    void refreshFromServer();
  }, []);

  const stopOnlinePollers = () => {
    try {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (chapaPollRef.current) {
        clearInterval(chapaPollRef.current);
        chapaPollRef.current = null;
      }
      if (serverRefreshRef.current) {
        clearInterval(serverRefreshRef.current);
        serverRefreshRef.current = null;
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    // Prod resilience: even if gateway status polling is blocked/failing,
    // keep refreshing from server while we are in an online-waiting state.
    // This lets us observe order.status -> Paid via webhook/server updates.
    if (!telebirrOnlineActive && !chapaOnlineActive) {
      if (serverRefreshRef.current) {
        clearInterval(serverRefreshRef.current);
        serverRefreshRef.current = null;
      }
      return;
    }

    if (serverRefreshRef.current) return;

    serverRefreshRef.current = setInterval(() => {
      try {
        void refreshFromServer();
      } catch {
        // ignore
      }
    }, 2500);

    return () => {
      if (serverRefreshRef.current) {
        clearInterval(serverRefreshRef.current);
        serverRefreshRef.current = null;
      }
    };
  }, [telebirrOnlineActive, chapaOnlineActive, refreshFromServer]);

  const onPaymentCompleted = async () => {
    const oid = order?.id ? String(order.id) : '';
    if (!oid) return;
    if (paymentCompleteRef.current === oid) return;
    paymentCompleteRef.current = oid;

    stopOnlinePollers();
    setTelebirrOnlineActive(false);
    setTelebirrCheckoutUrl(null);
    setChapaOnlineActive(false);
    setChapaCheckoutUrl(null);

    try {
      await refreshFromServer();
    } catch {
      // ignore
    }

    // Print immediately after confirming payment (LAN only via backend).
    try {
      const enabled = settingsUi.autoPrintReceipts === true;
      const deviceId = typeof settingsUi.defaultReceiptPrinterId === 'string' ? settingsUi.defaultReceiptPrinterId : null;
      if (enabled && deviceId) {
        const key = `mirachpos.printedReceipt.${oid}.full`;
        if (sessionStorage.getItem(key) !== '1') {
          sessionStorage.setItem(key, '1');
          void apiFetch(withBranchQuery(`/api/pos/print/receipt/${encodeURIComponent(oid)}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId }),
          }).catch(() => {
            // ignore
          });
        }
      }
    } catch {
      // ignore
    }

    onNavigate(Screen.WAITER_RECEIPT);
  };

  useEffect(() => {
    try {
      if (!order) return;
      const st = String((order as any)?.status || '').trim();
      if (st !== 'Paid') return;
      if (telebirrOnlineActive || chapaOnlineActive) {
        void onPaymentCompleted();
      }
    } catch {
      // ignore
    }
  }, [order?.id, (order as any)?.status, telebirrOnlineActive, chapaOnlineActive]);

  useEffect(() => {
    // Reset attempt tracking when leaving Mobile Pay or changing order.
    const oid = order?.id ? String(order.id) : '';
    if (method !== 'Mobile Pay') {
      chapaInitAttemptRef.current = '';
      setChapaOnlineActive(false);
      setChapaCheckoutUrl(null);
      return;
    }

    // Auto-generate QR on selection (once per order, no spam retries).
    const attemptKey = oid ? `order:${oid}` : '';
    if (!attemptKey) return;
    if (chapaOnlineLoading) return;
    if (chapaOnlineActive && chapaCheckoutUrl) return;
    if (chapaInitAttemptRef.current === attemptKey) return;
    if (selectedSplitId) return;

    chapaInitAttemptRef.current = attemptKey;
    void initiateChapaOnline();
  }, [method, order?.id, chapaOnlineLoading, chapaOnlineActive, chapaCheckoutUrl, selectedSplitId]);

  const initiateTelebirrOnline = async () => {
    if (!order) return;
    setTelebirrOnlineLoading(true);
    setActionErr('');
    try {
      const res = await apiFetch(`/api/pos/orders/${order.id}/pay-telebirr`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || 'Failed to initiate Telebirr');

      setTelebirrCheckoutUrl(json.checkoutUrl);
      setTelebirrOnlineActive(true);

      // Start polling
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const sRes = await apiFetch(`/api/pos/orders/${order.id}/payment-status`);
          const sJson = await sRes.json();
          if (sRes.ok && sJson.paid) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            // Success!
            void onPaymentCompleted();
          }
        } catch {
          // ignore polling errors
        }
      }, 3000);
    } catch (e: any) {
      setActionErr(e.message || 'Telebirr Online Error');
    } finally {
      setTelebirrOnlineLoading(false);
    }
  };

  const initiateChapaOnline = async () => {
    if (!order) return;
    if (selectedSplitId) {
      setActionErr('Mobile Pay is not available for split payments yet. Please pay the full bill.');
      return;
    }
    setChapaOnlineLoading(true);
    setActionErr('');
    try {
      const res = await apiFetch(withBranchQuery(`/api/pos/orders/${order.id}/pay-chapa-link`), { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const err = String(json?.error || '').trim();
        const msg = String(json?.message || '').trim();
        throw new Error(msg || err || 'Failed to initiate Mobile Pay');
      }

      const payerUrl = String(json?.payerUrl || '');
      if (!payerUrl) throw new Error('Missing payer URL from server');

      setChapaCheckoutUrl(payerUrl);
      setChapaOnlineActive(true);

      // Start polling
      if (chapaPollRef.current) clearInterval(chapaPollRef.current);
      chapaPollRef.current = setInterval(async () => {
        try {
          const sRes = await apiFetch(withBranchQuery(`/api/pos/orders/${order.id}/payment-status-chapa`));
          const sJson = await sRes.json().catch(() => null);
          if (sRes.ok && sJson && sJson.paid) {
            clearInterval(chapaPollRef.current);
            chapaPollRef.current = null;
            void onPaymentCompleted();
          }
        } catch {
          // ignore polling errors
        }
      }, 3000);
    } catch (e: any) {
      setActionErr(e?.message || 'Mobile Pay Error');
    } finally {
      setChapaOnlineLoading(false);
    }
  };

  const settingsUi = useMemo(() => {
    const cur = typeof posSettings?.general?.currency === 'string' ? posSettings.general.currency : 'ETB';
    const vatEnabled = posSettings?.taxes?.vatEnabled !== false;
    const vatRate = Number.isFinite(Number(posSettings?.taxes?.vatRate)) ? Number(posSettings?.taxes?.vatRate) : 15;
    const serviceEnabled = posSettings?.taxes?.serviceChargeEnabled === true;
    const serviceRate = Number.isFinite(Number(posSettings?.taxes?.serviceChargeRate)) ? Number(posSettings?.taxes?.serviceChargeRate) : 10;
    const requirePinForDiscounts = posSettings?.security?.requirePinForDiscounts === true;
    const maxDiscountPctWithoutApproval = Number.isFinite(Number(posSettings?.policies?.maxDiscountPctWithoutApproval))
      ? Math.max(0, Math.min(90, Number(posSettings?.policies?.maxDiscountPctWithoutApproval)))
      : 10;
    return {
      currency: String(cur || 'ETB').toUpperCase(),
      vatEnabled,
      vatRate,
      serviceEnabled,
      serviceRate,
      autoPrintReceipts: posSettings?.printers?.autoPrintReceipts === true,
      defaultReceiptPrinterId: posSettings?.printers?.defaultReceiptPrinterId ?? null,
      requirePinForDiscounts,
      maxDiscountPctWithoutApproval,
    };
  }, [posSettings]);

  const methodConfig = useMemo(() => {
    const list = Array.isArray(posSettings?.payments?.methods) ? posSettings?.payments?.methods || [] : [];
    const map = new Map<string, { enabled: boolean; label: string; reason: string }>();
    for (const m of list) {
      const id = String(m?.id || '').trim();
      if (!id) continue;
      map.set(id, {
        enabled: m?.enabled !== false,
        label: typeof m?.label === 'string' && m.label.trim() ? m.label.trim() : id,
        reason: typeof m?.reason === 'string' ? m.reason : '',
      });
    }
    return map;
  }, [posSettings]);

  const requireRefList = useMemo(() => {
    return Array.isArray(posSettings?.branchPayments?.requireReferenceForMethods) ? (posSettings?.branchPayments?.requireReferenceForMethods || []).map((x) => String(x || '').trim()) : [];
  }, [posSettings]);

  const requireReference = useMemo(() => {
    const id =
      method === 'Telebirr'
        ? 'mobile_money'
        : method === 'Mobile Pay'
          ? 'chapa'
          : method === 'Bank Transfer'
            ? 'bank_transfer'
            : method === 'Card'
              ? 'card'
              : method === 'Loyalty'
                ? 'loyalty'
                : 'cash';
    return requireRefList.includes(id);
  }, [method, requireRefList]);

  const qrSrc = useMemo(() => {
    const q = posSettings?.branchPayments?.qrCodes;
    const d = posSettings?.branchPayments?.qrDetails;
    if (method === 'Mobile Pay') return '';
    if (method === 'Telebirr') return typeof q?.telebirr === 'string' ? q.telebirr : '';
    if (method === 'Bank Transfer') return typeof q?.bank_transfer === 'string' ? q.bank_transfer : '';
    if (method === 'Card') return typeof q?.card === 'string' ? q.card : '';
    return '';
  }, [posSettings, method]);

  const paymentDetails = useMemo(() => {
    const d = posSettings?.branchPayments?.qrDetails;
    const q = posSettings?.branchPayments?.qrCodes;

    if (method === 'Telebirr') {
      const t = d?.telebirr;
      return {
        title: 'Telebirr',
        image: (typeof t?.image === 'string' && t.image.trim()) ? t.image : (typeof q?.telebirr === 'string' ? q.telebirr : ''),
        rows: [
          { k: 'Account Name', v: typeof t?.accountName === 'string' ? t.accountName : '' },
          { k: 'Phone', v: typeof t?.phone === 'string' ? t.phone : '' },
          { k: 'Merchant ID', v: typeof t?.merchantId === 'string' ? t.merchantId : '' },
          { k: 'Note', v: typeof t?.note === 'string' ? t.note : '' },
        ].filter((r) => r.v && r.v.trim()),
      };
    }

    if (method === 'Bank Transfer') {
      const b = d?.bank_transfer;
      return {
        title: 'Bank Transfer',
        image: (typeof b?.image === 'string' && b.image.trim()) ? b.image : (typeof q?.bank_transfer === 'string' ? q.bank_transfer : ''),
        rows: [
          { k: 'Bank', v: typeof b?.bankName === 'string' ? b.bankName : '' },
          { k: 'Account Name', v: typeof b?.accountName === 'string' ? b.accountName : '' },
          { k: 'Account No', v: typeof b?.accountNumber === 'string' ? b.accountNumber : '' },
          { k: 'Phone', v: typeof b?.phone === 'string' ? b.phone : '' },
          { k: 'Note', v: typeof b?.note === 'string' ? b.note : '' },
        ].filter((r) => r.v && r.v.trim()),
      };
    }

    if (method === 'Card') {
      const c = d?.card;
      return {
        title: 'Card',
        image: (typeof c?.image === 'string' && c.image.trim()) ? c.image : (typeof q?.card === 'string' ? q.card : ''),
        rows: [
          { k: 'Merchant ID', v: typeof c?.merchantId === 'string' ? c.merchantId : '' },
          { k: 'Note', v: typeof c?.note === 'string' ? c.note : '' },
        ].filter((r) => r.v && r.v.trim()),
      };
    }

    if (method === 'Mobile Pay') {
      return { title: 'Mobile Pay', image: '', rows: [] as Array<{ k: string; v: string }> };
    }

    return { title: '', image: '', rows: [] as Array<{ k: string; v: string }> };
  }, [posSettings, method]);

  const bankTransferConfigured = useMemo(() => {
    const q = posSettings?.branchPayments?.qrCodes;
    const d = posSettings?.branchPayments?.qrDetails;
    const qr = typeof q?.bank_transfer === 'string' ? q.bank_transfer.trim() : '';
    const b = d?.bank_transfer;
    const hasDetails =
      !!b &&
      typeof b === 'object' &&
      (Boolean(typeof (b as any).image === 'string' && String((b as any).image).trim()) ||
        Boolean(typeof (b as any).bankName === 'string' && String((b as any).bankName).trim()) ||
        Boolean(typeof (b as any).accountName === 'string' && String((b as any).accountName).trim()) ||
        Boolean(typeof (b as any).accountNumber === 'string' && String((b as any).accountNumber).trim()) ||
        Boolean(typeof (b as any).phone === 'string' && String((b as any).phone).trim()) ||
        Boolean(typeof (b as any).note === 'string' && String((b as any).note).trim()));
    return Boolean(qr) || hasDetails;
  }, [posSettings]);

  const itemCount = useMemo(() => (order ? order.items.reduce((sum, i) => sum + i.qty, 0) : 0), [order]);

  const assetUrl = useMemo(() => {
    return (raw: string): string => resolveAssetUrl(raw);
  }, []);

  const methodButtons = useMemo(() => {
    const offline = !isOnline;
    const defs: Array<{ id: string; label: string; icon: string; value: any }> = [
      { id: 'cash', label: 'Cash', icon: 'payments', value: 'Cash' },
      { id: 'mobile_money', label: 'Telebirr', icon: 'qr_code', value: 'Telebirr' },
      { id: 'chapa', label: 'Mobile Pay', icon: 'qr_code_2', value: 'Mobile Pay' },
      { id: 'bank_transfer', label: 'Bank Transfer', icon: 'account_balance', value: 'Bank Transfer' },
    ];

    const base = (offline ? defs.filter((d) => d.id === 'cash') : defs)
      .map((d) => {
        const cfg = methodConfig.get(d.id);
        const enabled = cfg ? cfg.enabled : true;
        const reason = cfg ? cfg.reason : '';
        return { ...d, enabled, reason };
      })
      .filter((d) => d.id !== 'bank_transfer' || methodConfig.has('bank_transfer') || bankTransferConfigured);

    const result = base;
    if (!offline && order?.customer) result.push({ id: 'loyalty', label: 'Loyalty', icon: 'loyalty', value: 'Loyalty', enabled: true, reason: '' } as any);
    return result;
  }, [isOnline, methodConfig, order?.customer, bankTransferConfigured]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline && method !== 'Cash') setMethod('Cash');
  }, [isOnline, method]);

  useEffect(() => {
    setTendered('');
    setManualTip('');
    setPaymentReference('');
  }, [selectedSplitId, method]);

  if (!order) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-[#0f0c07] text-white">
        <header className="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-solid border-[#2f281c] bg-[#17130b] px-6 py-3">
          <div className="flex items-center gap-4 text-white">
            <div className="size-8 flex items-center justify-center rounded-lg bg-[#eead2b] text-[#221c11]">
              <span className="material-symbols-outlined">payments</span>
            </div>
            <h2 className="text-white text-xl font-bold leading-tight tracking-tight">Payment</h2>
          </div>
          <button onClick={() => onNavigate(Screen.WAITER_DASHBOARD)} className="flex items-center justify-center h-10 px-4 rounded-lg border border-[#2f281c] hover:bg-[#221c11] transition-colors text-[#c9b792] text-sm font-medium">
            <span className="material-symbols-outlined text-lg mr-2">arrow_back</span> Back
          </button>
        </header>

        {actionErr ? (
          <div className="px-6 py-2 text-xs text-red-300 font-semibold bg-red-900/10 border-b border-red-900/30">
            {actionErr}
          </div>
        ) : null}
      </div>
    );
  }

  const tableForOrder = (() => {
    try {
      const tableId = String((order as any)?.tableId || '').trim();
      if (!tableId) return null;
      return Array.isArray(tables) ? (tables as any[]).find((t: any) => String(t?.id || '').trim() === tableId) : null;
    } catch {
      return null;
    }
  })();

  const isTerminal = order.status === 'Voided' || order.status === 'Paid' || order.status === 'Refunded';
  const isPaymentPhase = (() => {
    if (order.status === 'Served') return true;
    const tblStatus = String((tableForOrder as any)?.status || '').trim();
    return tblStatus === 'Payment';
  })();

  if (isTerminal || !isPaymentPhase) {
    const isPaid = order.status === 'Paid';
    return (
      <div className="flex flex-col h-full overflow-hidden bg-[#0f0c07] text-white">
        <header className="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-solid border-[#2f281c] bg-[#17130b] px-6 py-3">
          <div className="flex items-center gap-4 text-white">
            <div className="size-8 flex items-center justify-center rounded-lg bg-[#eead2b] text-[#221c11]">
              <span className="material-symbols-outlined">payments</span>
            </div>
            <h2 className="text-white text-xl font-bold leading-tight tracking-tight">Payment</h2>
          </div>
          <button onClick={() => onNavigate(Screen.WAITER_STATUS)} className="flex items-center justify-center h-10 px-4 rounded-lg border border-[#2f281c] hover:bg-[#221c11] transition-colors text-[#c9b792] text-sm font-medium">
            <span className="material-symbols-outlined text-lg mr-2">arrow_back</span> Back
          </button>
        </header>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full bg-[#17130b] border border-[#2f281c] rounded-xl p-6">
            <div className="text-white font-bold text-lg mb-2">
              {isPaid ? 'Order is already Paid' : 'Payment is not available yet'}
            </div>
            <div className="text-[#c9b792] text-sm">
              {isPaid ? 'This order has been fully paid.' : 'Orders can be paid only after they are marked Served.'}
            </div>
            <div className="mt-4 flex gap-3">
              {isPaid ? (
                <button onClick={() => onNavigate(Screen.WAITER_RECEIPT)} className="flex-1 h-11 rounded-lg bg-[#eead2b] hover:bg-[#d49619] text-[#221c11] font-bold transition-colors">View Receipt</button>
              ) : (
                <button onClick={() => onNavigate(Screen.WAITER_STATUS)} className="flex-1 h-11 rounded-lg bg-[#221c11] hover:bg-[#2c241b] border border-[#2f281c] text-white font-semibold transition-colors">Go to Kitchen</button>
              )}
              <button onClick={() => onNavigate(Screen.WAITER_ACTIVE_ORDERS)} className="flex-1 h-11 rounded-lg bg-[#eead2b] hover:bg-[#d49619] text-[#221c11] font-bold transition-colors">Active Orders</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleConfirm = () => {
    setActionErr('');

    if (method === 'Mobile Pay') {
      void initiateChapaOnline();
      return;
    }

    const tenderedValue = Number.parseFloat(tendered);
    const tenderedAmount = Number.isFinite(tenderedValue) ? tenderedValue : undefined;
    const splitId = selectedSplitId || undefined;
    try {
      if (splitId) localStorage.setItem(RECEIPT_SPLIT_KEY, splitId);
      else localStorage.removeItem(RECEIPT_SPLIT_KEY);
    } catch {
      // ignore
    }
    const ref = paymentReference.trim() ? paymentReference.trim().toUpperCase() : undefined;

    if (requireReference && !ref) {
      setActionErr('Payment reference is required for this method.');
      return;
    }

    if (manualTipValue > 0 && splitId) {
      setActionErr('Tip is not supported for split payments yet. Please pay the full bill.');
      return;
    }

    const applyManualTip = async () => {
      if (!order) return;
      if (manualTipValue <= 0) return;
      try {
        const currentTip = Number((order as any)?.tip ?? 0) || 0;
        const nextTip = Math.max(0, Math.round((currentTip + manualTipValue) * 100) / 100);
        const payload = {
          number: (order as any).number,
          tableId: (order as any).tableId,
          tableName: (order as any).tableName,
          orderType: (order as any).orderType ?? (order as any)?.payload?.orderType ?? null,
          takeawayFee: Number((order as any).takeawayFee ?? (order as any)?.payload?.takeawayFee ?? 0) || 0,
          items: Array.isArray((order as any).items) ? (order as any).items : [],
          subtotal: Number((order as any).subtotal ?? 0) || 0,
          tax: Number((order as any).tax ?? 0) || 0,
          serviceCharge: Number((order as any).serviceCharge ?? 0) || 0,
          total: Number((order as any).total ?? 0) || 0,
          createdAt: (order as any).createdAt,
          paidAt: (order as any).paidAt ?? null,
          createdByStaffId: (order as any).createdByStaffId ?? null,
          createdByName: (order as any).createdByName ?? null,
          paidByStaffId: (order as any).paidByStaffId ?? null,
          paidByName: (order as any).paidByName ?? null,
          paymentMethod: (order as any).paymentMethod ?? null,
          tenderedAmount: (order as any).tenderedAmount ?? null,
          paymentReference: (order as any).paymentReference ?? null,
          splits: (order as any).splits ?? null,
          notes: (order as any).notes ?? null,
          tip: nextTip,
          tipAmount: nextTip,
          tipPct: 0,
          tipPctAmount: 0,
        };

        const res = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(String(order.id))}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tip: nextTip, payload }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          const msg = String(j?.message || j?.error || '').trim();
          throw new Error(msg || 'Failed to apply tip');
        }

        try {
          await refreshFromServer();
        } catch {
          // ignore
        }
      } catch (e: any) {
        setActionErr(e?.message || 'Failed to apply tip');
        throw e;
      }
    };

    void (async () => {
      try {
        await applyManualTip();
        confirmPayment(order.id, method, method === 'Cash' ? tenderedAmount : undefined, splitId, ref);

        // Print immediately after confirming payment (LAN only via backend).
        // This prevents missed prints if the user navigates away from the receipt screen.
        try {
          const enabled = settingsUi.autoPrintReceipts === true;
          const deviceId = typeof settingsUi.defaultReceiptPrinterId === 'string' ? settingsUi.defaultReceiptPrinterId : null;
          if (enabled && deviceId && !splitId) {
            const key = `mirachpos.printedReceipt.${order.id}.full`;
            if (sessionStorage.getItem(key) !== '1') {
              sessionStorage.setItem(key, '1');
              void apiFetch(withBranchQuery(`/api/pos/print/receipt/${encodeURIComponent(String(order.id))}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId }),
              }).catch(() => {
                // ignore (receipt screen still has browser print fallback)
              });
            }
          }
        } catch {
          // ignore
        }

        onNavigate(Screen.WAITER_RECEIPT);
      } catch {
        // actionErr already set
      }
    })();

    return;
  };

  const split = selectedSplitId ? (order.splits || []).find((s) => s.id === selectedSplitId) ?? null : null;
  const totalDue = split ? split.total : order.total;

  const manualTipValue = (() => {
    const v = Number.parseFloat(manualTip);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.round(v * 100) / 100);
  })();
  const totalDueWithTip = totalDue + manualTipValue;

  const discountAmount = Number((order as any)?.discount ?? 0) || 0;
  const discountPct = Number((order as any)?.discountPct ?? (order as any)?.payload?.discountPct ?? 0) || 0;
  const subtotal = Number(order.subtotal ?? 0) || 0;
  const previewPctValue = Number(discountValue);
  const previewPct = Number.isFinite(previewPctValue) ? Math.max(0, Math.min(90, previewPctValue)) : 0;
  const previewDiscountAmount = subtotal > 0 ? (subtotal * previewPct) / 100 : 0;
  const discountNeedsApproval = settingsUi.requirePinForDiscounts && previewPct > settingsUi.maxDiscountPctWithoutApproval + 1e-9;

  const tenderedValue = Number.parseFloat(tendered);
  const tenderedAmount = Number.isFinite(tenderedValue) ? tenderedValue : 0;
  const changeDue = Math.max(0, tenderedAmount - totalDueWithTip);
  const loyaltyBalance = Number(order.customer?.loyaltyBalance) || 0;
  const canConfirm =
    method === 'Cash'
      ? tenderedAmount >= totalDueWithTip
      : method === 'Loyalty'
        ? Boolean(order.customer) && loyaltyBalance + 1e-9 >= totalDue
        : method === 'Mobile Pay'
          ? false
          : requireReference
            ? Boolean(paymentReference.trim())
            : true;

  const appendTendered = (val: string) => {
    setTendered((prev) => {
      if (val === '.') {
        if (prev.includes('.')) return prev;
        return prev.length === 0 ? '0.' : `${prev}.`;
      }
      if (prev === '0') return val;
      return `${prev}${val}`;
    });
  };

  const backspaceTendered = () => {
    setTendered((prev) => (prev.length <= 1 ? '' : prev.slice(0, -1)));
  };

  const setQuickTendered = (amount: number) => {
    setTendered(amount.toFixed(2));
  };

  const isCash = method === 'Cash';
  const qrImage = assetUrl(paymentDetails.image || qrSrc);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0f0c07] text-white">
      {/* Top Navigation */}
      <header className="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-solid border-[#2f281c] bg-[#17130b] px-6 py-3">
        <div className="flex items-center gap-4 text-white">
          <div className="size-8 flex items-center justify-center rounded-lg bg-[#eead2b] text-[#221c11]">
            <span className="material-symbols-outlined">payments</span>
          </div>
          <h2 className="text-white text-xl font-bold leading-tight tracking-tight">Payment</h2>
          <div className="h-6 w-px bg-[#2f281c] mx-2"></div>
          <div className="flex flex-col">
            <span className="text-sm font-bold leading-none">{order.tableName}</span>
            <span className="text-xs text-[#c9b792] leading-none mt-1">{order.number}</span>
          </div>
        </div>
        <button onClick={() => onNavigate(Screen.WAITER_DASHBOARD)} className="flex items-center justify-center h-10 px-4 rounded-lg border border-[#2f281c] hover:bg-[#221c11] transition-colors text-[#c9b792] text-sm font-medium">
          <span className="material-symbols-outlined text-lg mr-2">arrow_back</span> Back
        </button>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Column: Order Summary */}
        <section className={`w-full ${billCollapsed ? 'lg:w-[92px]' : 'lg:w-[240px]'} min-h-0 flex flex-col lg:border-r border-b lg:border-b-0 border-[#2f281c] bg-[#17130b] shrink-0`}>
          <div className={`px-4 py-3 border-b border-[#2f281c] flex justify-between items-center ${billCollapsed ? 'lg:px-3' : ''}`}>
            <h3 className={`text-base font-bold ${billCollapsed ? 'lg:hidden' : ''}`}>Bill Summary</h3>
            <div className={`text-[10px] font-black uppercase tracking-widest text-[#c9b792] ${billCollapsed ? 'hidden lg:block' : 'hidden'}`}>Bill</div>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] bg-[#3a2e22] px-2 py-1 rounded text-[#c9b792] ${billCollapsed ? 'lg:hidden' : ''}`}>{itemCount} Items</span>
              <button
                type="button"
                onClick={() => setBillCollapsed((v) => !v)}
                className="size-9 rounded-lg border border-[#2f281c] bg-[#0f0c07] hover:bg-[#221c11] text-[#c9b792] transition-colors flex items-center justify-center"
                title={billCollapsed ? 'Expand bill' : 'Collapse bill'}
              >
                <span className="material-symbols-outlined text-[20px]">{billCollapsed ? 'chevron_right' : 'chevron_left'}</span>
              </button>
            </div>
          </div>

          <div className={`flex-1 min-h-0 flex flex-col ${billCollapsed ? 'lg:hidden' : ''}`}>
            {order.customer ? (
              <div className="px-4 py-2 border-b border-[#2f281c]">
                <div className="text-[11px] text-[#c9b792]">Customer</div>
                <div className="text-sm font-bold text-white truncate">{order.customer.name}</div>
                <div className="text-[11px] text-[#c9b792] truncate">{order.customer.phone}    Points {order.customer.loyaltyPoints}    Balance {settingsUi.currency} {order.customer.loyaltyBalance.toFixed(2)}</div>
              </div>
            ) : null}

            {/* Order List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
              {order.items.map((item) => (
                <div key={item.productId} className="flex items-center gap-3 bg-[#0f0c07] p-2 rounded-lg border border-transparent hover:border-[#2f281c] transition-colors">
                  <div
                    className="rounded-md size-10 shrink-0 border border-[#2f281c] bg-[#1a1612] bg-cover bg-center"
                    style={{ backgroundImage: `url('${String(products.find((p) => p.id === item.productId)?.image || '')}')` }}
                  />
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <p className="text-white text-sm font-semibold truncate">{item.name} x{item.qty}</p>
                      <p className="text-white text-sm font-semibold">{settingsUi.currency} {(item.unitPrice * item.qty).toFixed(2)}</p>
                    </div>
                    {item.note?.trim() ? <p className="text-[#c9b792] text-xs truncate">{item.note.trim()}</p> : null}
                  </div>
                </div>
              ))}
            </div>
            {/* Totals */}
            <div className="shrink-0 p-4 border-t border-[#2f281c] bg-[#221c11]/40">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[#c9b792] text-[12px]">Subtotal</span>
                <span className="text-white font-semibold text-[12px]">{settingsUi.currency} {order.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[#c9b792] text-[12px]">Tax ({Math.round((order.tax / Math.max(1, order.subtotal)) * 100)}%)</span>
                <span className="text-white font-semibold text-[12px]">{settingsUi.currency} {order.tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[#c9b792] text-[12px]">Service ({Math.round((order.serviceCharge / Math.max(1, order.subtotal)) * 100)}%)</span>
                <span className="text-white font-semibold text-[12px]">{settingsUi.currency} {order.serviceCharge.toFixed(2)}</span>
              </div>
              {Number((order as any)?.takeawayFee ?? (order as any)?.payload?.takeawayFee ?? 0) > 0 ? (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[#c9b792] text-[12px]">Takeaway Fee</span>
                  <span className="text-white font-semibold text-[12px]">{settingsUi.currency} {Number((order as any)?.takeawayFee ?? (order as any)?.payload?.takeawayFee ?? 0).toFixed(2)}</span>
                </div>
              ) : null}

              <button
                onClick={() => {
                  setDiscountErr('');
                  setDiscountPin('');
                  setDiscountValue('');
                  setDiscountOpen(true);
                }}
                className="w-full h-10 rounded-xl border border-[#2f281c] bg-[#0f0c07] hover:bg-[#221c11] text-[#c9b792] font-bold transition-colors text-sm"
                type="button"
              >
                Discount
              </button>

              <div className="mt-3 pt-3 border-t border-[#2f281c] flex justify-between items-center">
                <span className="text-white text-base font-extrabold">Total</span>
                <span className="text-[#eead2b] text-2xl font-black">{settingsUi.currency} {order.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className={`hidden lg:flex flex-1 min-h-0 flex-col items-center justify-between py-4 ${billCollapsed ? '' : 'lg:hidden'}`}>
            <div className="text-[11px] bg-[#3a2e22] px-2 py-1 rounded text-[#c9b792]">{itemCount}</div>
            <div className="flex flex-col items-center">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#c9b792]">Total</div>
              <div className="mt-1 text-[#eead2b] text-xl font-black text-center px-1">{settingsUi.currency} {order.total.toFixed(2)}</div>
            </div>
            <button
              onClick={() => {
                setDiscountErr('');
                setDiscountPin('');
                setDiscountValue('');
                setDiscountOpen(true);
              }}
              className="size-10 rounded-xl border border-[#2f281c] bg-[#0f0c07] hover:bg-[#221c11] text-[#c9b792] transition-colors flex items-center justify-center"
              type="button"
              title="Discount"
            >
              <span className="material-symbols-outlined text-[20px]">percent</span>
            </button>
          </div>
        </section>

        {/* Right Column: Payment Interface */}
        <section className="flex-1 min-h-0 flex flex-col bg-[#0f0c07] overflow-hidden">
          <div className="shrink-0 px-6 py-5 bg-[#17130b] border-b border-[#2f281c]">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
              <div>
                <p className="text-[#c9b792] uppercase tracking-widest text-[11px] font-semibold">Total Amount Due</p>
                <div className="text-3xl md:text-4xl font-black text-white tracking-tight">{settingsUi.currency} {totalDue.toFixed(2)}</div>
              </div>
              <div className="text-xs text-[#c9b792]">
                {split ? 'Paying: selected split' : Array.isArray(order.splits) && order.splits.length > 0 ? 'Paying: full bill' : ''}
              </div>
            </div>
            {split ? (
              null
            ) : Array.isArray(order.splits) && order.splits.length > 0 ? (
              null
            ) : null}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
            <div className={`grid grid-cols-1 ${isCash ? 'lg:grid-cols-[420px,1fr]' : 'lg:grid-cols-1'} gap-6 items-start`}>
              <div className={`flex flex-col gap-6 ${isCash ? 'order-2 lg:order-2' : 'order-1 lg:order-1 mx-auto w-full max-w-[1100px]'}`}>
                {Array.isArray(order.splits) && order.splits.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-bold text-[#c9b792] mb-3 uppercase tracking-wider">Split Bills</h4>
                    <div className="space-y-2">
                      {order.splits.map((sp, idx) => {
                        const selected = selectedSplitId === sp.id;
                        const disabled = sp.status === 'Paid';
                        return (
                          <button
                            key={sp.id}
                            disabled={disabled}
                            onClick={() => setSelectedSplitId(sp.id)}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${disabled
                              ? 'border-[#483c23] bg-[#2c241b]/40 text-[#c9b792]/60 cursor-not-allowed'
                              : selected
                                ? 'border-[#eead2b] bg-[#eead2b]/10 text-white'
                                : 'border-[#483c23] bg-[#2c241b] hover:bg-[#3a2e22] text-white'
                              }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`text-xs font-black px-2 py-1 rounded ${selected ? 'bg-[#eead2b] text-[#221c11]' : 'bg-[#3a2e22] text-[#c9b792]'}`}>Split {idx + 1}</div>
                              <div className="text-xs">{sp.status}</div>
                            </div>
                            <div className="text-sm font-extrabold">{settingsUi.currency} {sp.total.toFixed(2)}</div>
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setSelectedSplitId('')}
                        className={`w-full px-4 py-3 rounded-xl border border-[#483c23] ${selectedSplitId ? 'bg-[#2c241b] hover:bg-[#3a2e22] text-[#c9b792]' : 'bg-[#eead2b]/10 border-[#eead2b]/40 text-[#eead2b]'} transition-colors text-sm font-bold`}
                      >
                        Pay Full Bill
                      </button>
                    </div>
                  </div>
                ) : null}
                <div>
                  <h4 className="text-sm font-bold text-[#c9b792] mb-3 uppercase tracking-wider">Payment Method</h4>
                  <div
                    className={`grid gap-3 ${isCash
                      ? (order.customer ? 'grid-cols-1 sm:grid-cols-5' : 'grid-cols-1 sm:grid-cols-4')
                      : (order.customer ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4')
                      }`}
                  >
                    {methodButtons.map((b) => {
                      const selected = method === b.value;
                      const disabled = b.enabled === false;
                      return (
                        <button
                          key={b.id}
                          disabled={disabled}
                          title={disabled && b.reason ? b.reason : undefined}
                          onClick={() => setMethod(b.value)}
                          className={`flex flex-col items-center justify-center ${isCash ? 'p-6 min-h-[108px]' : 'p-7 min-h-[124px]'} rounded-2xl transition-all ${disabled
                            ? 'border border-[#483c23] bg-[#2c241b]/40 text-[#c9b792]/60 cursor-not-allowed'
                            : selected
                              ? 'border-2 border-[#eead2b] bg-[#eead2b]/10 text-[#eead2b] shadow-lg ring-2 ring-[#eead2b]/20'
                              : 'border border-[#483c23] bg-[#2c241b] hover:bg-[#3a2e22] text-[#c9b792] hover:text-white'
                            }`}
                        >
                          <span className={`material-symbols-outlined ${isCash ? 'text-4xl' : 'text-5xl'} mb-1`}>{b.icon}</span>
                          <span className={`font-bold ${isCash ? 'text-sm' : 'text-base'}`}>{b.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-col gap-4 mt-2">
                  {qrImage ? (
                    <div className="bg-[#2c241b] p-4 rounded-xl border border-[#483c23]">
                      <div className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">Scan to Pay</div>
                      <div className="mt-3 flex items-center justify-center">
                        <img src={qrImage} alt="QR" className="max-h-80 max-w-full rounded-lg border border-[#483c23] bg-white p-2" />
                      </div>
                    </div>
                  ) : method === 'Mobile Pay' ? (
                    <div className="bg-[#2c241b] p-4 rounded-xl border border-[#483c23]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">Mobile Pay (Chapa)</div>
                          <div className="mt-1 text-sm text-[#c9b792]">Generate a QR for this order and wait for confirmation.</div>
                        </div>
                        <button
                          type="button"
                          disabled={chapaOnlineLoading || chapaOnlineActive}
                          onClick={() => void initiateChapaOnline()}
                          className="h-10 px-4 rounded-lg bg-[#eead2b] hover:bg-[#d49619] disabled:bg-[#3a2e22] disabled:text-[#c9b792] text-[#221c11] font-extrabold transition-colors"
                        >
                          {chapaOnlineLoading ? 'Generating...' : chapaOnlineActive ? 'Waiting…' : 'Generate QR'}
                        </button>
                      </div>

                      {chapaOnlineActive && chapaCheckoutUrl ? (
                        <div className="mt-4 flex flex-col items-center gap-3">
                          <div className="bg-white p-3 rounded-xl">
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(chapaCheckoutUrl)}`}
                              alt="Mobile Pay QR"
                              className="w-56 h-56"
                            />
                          </div>
                          <div className="text-center text-xs text-[#c9b792]">
                            Keep this screen open. Once the customer pays, the receipt will open automatically.
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              try {
                                if (chapaCheckoutUrl) window.open(chapaCheckoutUrl, '_blank', 'noopener,noreferrer');
                              } catch {
                                try {
                                  if (chapaCheckoutUrl) window.location.href = chapaCheckoutUrl;
                                } catch {
                                }
                              }
                            }}
                            className="h-10 px-4 rounded-lg bg-[#eead2b] hover:bg-[#d49619] text-[#221c11] font-extrabold transition-colors"
                          >
                            Open payment page
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setChapaOnlineActive(false);
                              setChapaCheckoutUrl(null);
                            }}
                            className="h-10 px-4 rounded-lg border border-[#483c23] bg-[#221c11] hover:bg-[#2c241b] text-[#c9b792] font-bold transition-colors"
                          >
                            Cancel Mobile Pay
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : method === 'Telebirr' ? (
                    <div className="bg-[#2c241b] p-4 rounded-xl border border-[#483c23]">
                      <div className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">Scan to Pay</div>
                      <div className="mt-2 text-sm text-[#c9b792]">QR code not configured in Branch Settings.</div>
                    </div>
                  ) : null}

                  {paymentDetails.rows.length > 0 ? (
                    <div className="bg-[#2c241b] p-4 rounded-xl border border-[#483c23]">
                      <div className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">{paymentDetails.title} Details</div>
                      <div className="mt-3 space-y-2">
                        {paymentDetails.rows.map((r) => (
                          <div key={`${r.k}:${r.v}`} className="flex items-start justify-between gap-3">
                            <div className="text-xs text-[#c9b792] font-semibold">{r.k}</div>
                            <div className="text-xs text-white font-bold text-right break-words max-w-[65%]">{r.v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {telebirrOnlineActive && telebirrCheckoutUrl && (
                    <div className="bg-[#1a150d] p-5 rounded-xl border-2 border-[#eead2b] shadow-[0_0_15px_rgba(238,173,43,0.3)] animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-xs text-[#eead2b] font-black uppercase tracking-widest flex items-center gap-2">
                          <span className="size-2 rounded-full bg-[#eead2b] animate-pulse"></span>
                          Waiting for Payment
                        </div>
                        <button onClick={() => setTelebirrOnlineActive(false)} className="text-[#c9b792] hover:text-white transition-colors">
                          <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                      </div>
                      <div className="flex flex-col items-center gap-4">
                        <div className="bg-white p-3 rounded-xl">
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(telebirrCheckoutUrl)}`}
                            alt="Dynamic QR"
                            className="w-48 h-48"
                          />
                        </div>
                        <p className="text-center text-xs text-[#c9b792] px-4">
                          Ask the customer to scan this QR with their Telebirr app. The system will automatically confirm once paid.
                        </p>
                        <div className="w-full h-1 bg-[#2c241b] rounded-full overflow-hidden">
                          <div className="h-full bg-[#eead2b] animate-pulse" style={{ width: '100%' }}></div>
                        </div>
                      </div>
                    </div>
                  )}

                  {requireReference ? (
                    <div className="bg-[#2c241b] p-4 rounded-xl border border-[#483c23]">
                      <div className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">PAYMENT REFERENCE</div>
                      <div className="mt-2">
                        <input
                          value={paymentReference}
                          onChange={(e) => setPaymentReference(String(e.target.value || '').toUpperCase())}
                          placeholder="ENTER REFERENCE"
                          className="w-full h-11 bg-[#221c11] border border-[#483c23] rounded-lg px-4 text-white font-mono focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b]"
                        />
                        <div className="text-[#c9b792] text-xs mt-2">Reference is required.</div>
                      </div>
                    </div>
                  ) : null}

                  {method === 'Loyalty' ? (
                    <div className="bg-[#2c241b] p-4 rounded-xl border border-[#483c23] flex justify-between items-center">
                      <span className="text-[#c9b792] font-medium">Loyalty Balance</span>
                      <div className={`text-xl font-bold ${loyaltyBalance + 1e-9 >= totalDue ? 'text-green-400' : 'text-red-400'}`}>{settingsUi.currency} {loyaltyBalance.toFixed(2)}</div>
                    </div>
                  ) : null}
                  {method !== 'Mobile Pay' && method !== 'Loyalty' && !selectedSplitId ? (
                    <div className="bg-[#2c241b] p-4 rounded-xl border border-[#483c23]">
                      <div className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">TIP (ETB)</div>
                      <div className="mt-2">
                        <input
                          value={manualTip}
                          onChange={(e) => setManualTip(String(e.target.value || '').replace(/[^0-9.]/g, ''))}
                          placeholder="0.00"
                          className="w-full h-11 bg-[#221c11] border border-[#483c23] rounded-lg px-4 text-white font-mono focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b]"
                        />
                        <div className="text-[#c9b792] text-xs mt-2">Added to total so it appears on the receipt.</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={`w-full flex flex-col gap-3 order-1 lg:order-1 ${isCash ? '' : 'hidden'}`}>
                {isCash ? (
                  <>
                    <div className="bg-[#2c241b] p-4 rounded-xl border border-[#483c23]">
                      <div className="flex justify-between items-center">
                        <span className="text-[#c9b792] font-medium">Tendered Amount</span>
                        <div className="text-2xl font-bold text-white border-b-2 border-[#eead2b] px-2 pb-1 min-w-[140px] text-right">{tendered.length ? tendered : ' ”'}</div>
                      </div>
                      <div className="mt-3 flex justify-between items-center opacity-75">
                        <span className="text-[#c9b792] font-medium">Change Due</span>
                        <span className="text-2xl font-bold text-green-400">{settingsUi.currency} {changeDue.toFixed(2)}</span>
                      </div>
                    </div>
                    <h4 className="text-sm font-bold text-[#c9b792] mb-0 uppercase tracking-wider">Quick Entry</h4>
                    <div className="grid grid-cols-4 gap-2">
                      <button onClick={() => setQuickTendered(100)} className="h-10 bg-[#2c241b] hover:bg-[#3a2e22] border border-[#483c23] rounded-lg text-sm font-bold text-white transition-colors">100</button>
                      <button onClick={() => setQuickTendered(200)} className="h-10 bg-[#2c241b] hover:bg-[#3a2e22] border border-[#483c23] rounded-lg text-sm font-bold text-white transition-colors">200</button>
                      <button onClick={() => setQuickTendered(500)} className="h-10 bg-[#2c241b] hover:bg-[#3a2e22] border border-[#483c23] rounded-lg text-sm font-bold text-white transition-colors">500</button>
                      <button onClick={() => setQuickTendered(totalDueWithTip)} className="h-10 bg-[#2c241b] hover:bg-[#3a2e22] border border-[#483c23] rounded-lg text-sm font-bold text-[#eead2b] transition-colors">Exact</button>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0].map((n) => (
                        <button
                          key={n}
                          onClick={() => appendTendered(String(n))}
                          className="h-14 bg-[#3a2e22] hover:bg-[#4a3b2b] rounded-xl text-2xl font-semibold text-white transition-colors shadow-sm"
                        >
                          {n}
                        </button>
                      ))}
                      <button onClick={backspaceTendered} className="h-14 bg-[#3a2e22] hover:bg-[#4a3b2b] rounded-xl text-xl font-semibold text-white transition-colors shadow-sm flex items-center justify-center">
                        <span className="material-symbols-outlined">backspace</span>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-[#2f281c] bg-[#17130b] px-4 md:px-6 py-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={() => onNavigate(Screen.WAITER_DASHBOARD)} className="w-full sm:w-1/3 h-12 rounded-xl border border-[#2f281c] bg-transparent hover:bg-[#221c11] text-white font-bold transition-colors flex items-center justify-center gap-2">Cancel</button>
              {method === 'Mobile Pay' ? (
                <button
                  disabled={chapaOnlineLoading || chapaOnlineActive}
                  onClick={handleConfirm}
                  className="w-full sm:flex-1 h-12 rounded-xl bg-[#eead2b] hover:bg-[#d49619] disabled:bg-[#3a2e22] disabled:text-[#c9b792] text-[#221c11] font-extrabold shadow-lg shadow-black/20 transition-all transform active:scale-[0.99] flex items-center justify-center gap-3 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined icon-filled">qr_code_2</span> {chapaOnlineLoading ? 'Generating…' : chapaOnlineActive ? 'Waiting…' : 'Generate QR'}
                </button>
              ) : (
                <button disabled={!canConfirm} onClick={handleConfirm} className="w-full sm:flex-1 h-12 rounded-xl bg-[#eead2b] hover:bg-[#d49619] disabled:bg-[#3a2e22] disabled:text-[#c9b792] text-[#221c11] font-extrabold shadow-lg shadow-black/20 transition-all transform active:scale-[0.99] flex items-center justify-center gap-3 disabled:cursor-not-allowed">
                  <span className="material-symbols-outlined icon-filled">check_circle</span> Charge {settingsUi.currency} {totalDueWithTip.toFixed(2)}
                </button>
              )}
            </div>
          </div>
        </section>
      </main>

      <Modal
        open={discountOpen}
        title="Apply Discount"
        onClose={() => {
          if (discountSaving) return;
          setDiscountOpen(false);
          setDiscountErr('');
          setDiscountPin('');
          setDiscountValue('');
        }}
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                if (discountSaving) return;
                setDiscountOpen(false);
                setDiscountErr('');
                setDiscountPin('');
                setDiscountValue('');
              }}
              className="h-11 px-4 rounded-lg bg-[#393328] hover:bg-[#4a4234] border border-[#544b3b] text-white font-semibold transition-colors"
            >
              Cancel
            </button>
            <div className="flex-1" />
            <button
              type="button"
              disabled={discountSaving || !(Number(discountValue) >= 0)}
              onClick={async () => {
                if (!order) return;
                if (discountSaving) return;

                setDiscountErr('');
                const pct = Number(discountValue);
                if (!Number.isFinite(pct) || pct < 0 || pct > 90) {
                  setDiscountErr('Enter a valid discount percentage (0 - 90).');
                  return;
                }
                if (discountNeedsApproval && !discountPin.trim()) {
                  setDiscountErr('Manager PIN required.');
                  return;
                }

                setDiscountSaving(true);
                try {
                  const payload = {
                    number: order.number,
                    tableId: order.tableId,
                    tableName: order.tableName,
                    items: order.items,
                    createdAt: order.createdAt,
                    paidAt: (order as any).paidAt ?? null,
                    createdByStaffId: (order as any).createdByStaffId ?? null,
                    createdByName: (order as any).createdByName ?? null,
                    paymentMethod: (order as any).paymentMethod ?? null,
                    tenderedAmount: (order as any).tenderedAmount ?? null,
                    paymentReference: (order as any).paymentReference ?? null,
                    splits: (order as any).splits ?? null,
                    notes: (order as any).notes ?? null,
                  };

                  const res = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(order.id)}`), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      discountPct: pct,
                      payload,
                      pin: discountPin.trim() || undefined,
                    }),
                  });
                  const json = await res.json().catch(() => null);
                  if (!res.ok) {
                    const err = String(json?.error || json?.message || 'discount_failed');
                    if (err === 'pin_required') setDiscountErr('PIN required or incorrect.');
                    else setDiscountErr('Failed to apply discount.');
                    return;
                  }

                  setDiscountOpen(false);
                  setDiscountErr('');
                  setDiscountPin('');
                  setDiscountValue('');
                  await refreshFromServer();
                } catch {
                  setDiscountErr('Failed to apply discount.');
                } finally {
                  setDiscountSaving(false);
                }
              }}
              className="h-11 px-4 rounded-lg bg-[#eead2b] hover:bg-[#d49619] text-[#221c11] font-extrabold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {discountSaving ? 'Saving...' : 'Apply'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-[#c9b792]">
          Enter discount percentage. Up to {settingsUi.maxDiscountPctWithoutApproval.toFixed(0)}% can be applied without approval.
        </div>

        {discountErr ? <div className="mt-3 text-sm text-red-300">{discountErr}</div> : null}

        <div className="mt-4">
          <label className="text-xs font-bold text-[#c9b792]">Discount (%)</label>
          <input
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            inputMode="decimal"
            placeholder=""
            className="mt-2 w-full h-11 bg-[#221c10] border border-[#483c23] rounded-lg px-4 text-white focus:ring-1 focus:ring-[#eead2b]/50 focus:border-[#eead2b]/50"
          />
          <div className="mt-2 text-xs text-[#c9b792]">
            Preview: -{settingsUi.currency} {Number.isFinite(previewDiscountAmount) ? previewDiscountAmount.toFixed(2) : '0.00'} (Subtotal {settingsUi.currency} {subtotal.toFixed(2)})
          </div>
        </div>

        {discountNeedsApproval ? (
          <div className="mt-4">
            <label className="text-xs font-bold text-[#c9b792]">Manager PIN</label>
            <input
              value={discountPin}
              onChange={(e) => setDiscountPin(e.target.value)}
              placeholder="Enter PIN"
              className="mt-2 w-full h-11 bg-[#221c10] border border-[#483c23] rounded-lg px-4 text-white focus:ring-1 focus:ring-[#eead2b]/50 focus:border-[#eead2b]/50"
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
};
