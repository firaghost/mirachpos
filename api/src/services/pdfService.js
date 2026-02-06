/**
 * PDF Generation Service
 * 
 * Generates PDF documents for:
 * - Invoices (clean, professional layout)
 * - Reports (tables, charts summaries)
 */

const PDFDocument = require('pdfkit-table');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');

// Helper to format currency
const fmtMoney = (n) => {
    const x = Number(n);
    const safe = Number.isFinite(x) ? x : 0;
    return `ETB ${safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtDate = (d) => {
    try {
        const dt = new Date(d);
        if (Number.isNaN(dt.getTime())) return '';
        return dt.toLocaleDateString();
    } catch {
        return '';
    }
};

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

const safeText = (v) => String(v == null ? '' : v);

const truncate = (s, max) => {
    const str = safeText(s);
    if (str.length <= max) return str;
    return `${str.slice(0, Math.max(0, max - 1))}…`;
};

const ensureSpace = (doc, minRemainingHeight) => {
    const bottomY = doc.page.height - doc.page.margins.bottom;
    const remaining = bottomY - doc.y;
    if (remaining >= minRemainingHeight) return;
    doc.addPage();
};

const drawReportHeader = (doc, opts) => {
    const businessName = safeText(opts?.businessName || 'MirachPOS').trim() || 'MirachPOS';
    const reportTitle = safeText(opts?.reportTitle || 'Report').trim() || 'Report';
    const periodText = safeText(opts?.periodText || '').trim();

    const top = doc.page.margins.top;
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;

    doc.save();
    doc.fillColor('#111827');
    doc.font('Helvetica-Bold').fontSize(16);
    doc.text(truncate(businessName, 48), left, top, { width: right - left, align: 'left' });

    doc.font('Helvetica').fontSize(9).fillColor('#6b7280');
    doc.text(reportTitle.toUpperCase(), left, top + 20, { width: right - left, align: 'left' });
    if (periodText) {
        doc.text(periodText, left, top + 34, { width: right - left, align: 'left' });
    }

    doc.moveTo(left, top + 52).lineTo(right, top + 52).strokeColor('#e5e7eb').lineWidth(1).stroke();
    doc.restore();

    doc.y = Math.max(doc.y, top + 64);
};

const drawReportFooter = (doc, opts) => {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;

    const pageNum = Number(opts?.pageNum || 1) || 1;

    doc.save();
    doc.strokeColor('#e5e7eb').lineWidth(1);
    doc.moveTo(left, bottom - 18).lineTo(right, bottom - 18).stroke();

    doc.fillColor('#6b7280');
    doc.font('Helvetica').fontSize(8);
    doc.text(`Page ${pageNum}`, left, bottom - 14, { width: right - left, align: 'right' });
    doc.text('Powered by MirachPOS', left, bottom - 14, { width: right - left, align: 'left' });
    doc.restore();
};

const drawTotalsBlock = (doc, totals) => {
    const items = Array.isArray(totals) ? totals : [];
    if (!items.length) return;

    ensureSpace(doc, 26 + items.length * 14 + 42);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;

    doc.save();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827');
    doc.text('Totals', left, doc.y + 6, { width: right - left, align: 'left' });
    doc.moveDown(0.6);

    let y = doc.y;
    for (const t of items) {
        doc.font('Helvetica').fontSize(10).fillColor('#6b7280');
        doc.text(safeText(t?.label || ''), left, y, { width: 300, align: 'left' });
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827');
        doc.text(safeText(t?.value || ''), left, y, { width: right - left, align: 'right' });
        y += 14;
    }

    doc.y = y + 8;
    doc.restore();
};

const drawSignatures = (doc) => {
    ensureSpace(doc, 90);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const mid = left + (right - left) / 2;
    const y = doc.y + 24;

    doc.save();
    doc.strokeColor('#9ca3af').lineWidth(1);
    doc.moveTo(left, y).lineTo(mid - 18, y).stroke();
    doc.moveTo(mid + 18, y).lineTo(right, y).stroke();

    doc.fillColor('#6b7280');
    doc.font('Helvetica').fontSize(9);
    doc.text('Prepared by', left, y + 6, { width: mid - left - 18, align: 'center' });
    doc.text('Approved by', mid + 18, y + 6, { width: right - (mid + 18), align: 'center' });
    doc.restore();

    doc.y = y + 34;
};

const makeStampCode = (invoice) => {
    const idPart = String(invoice?.id || '').split('_').pop() || String(invoice?.id || '').slice(-8);
    const dt = new Date(invoice?.issue_date || invoice?.created_at || Date.now());
    const ymd = Number.isNaN(dt.getTime()) ? '00000000' : dt.toISOString().slice(0, 10).replace(/-/g, '');
    return `MPS-${ymd}-${String(idPart).slice(-10).toUpperCase()}`;
};

const drawCircularText = (doc, text, cx, cy, r, startAngleRad) => {
    const chars = String(text || '');
    if (!chars) return;

    const step = (2 * Math.PI) / Math.max(chars.length, 1);
    doc.save();
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const ang = startAngleRad + i * step;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        doc.save();
        doc.rotate((ang * 180) / Math.PI + 90, { origin: [x, y] });
        doc.text(ch, x - 2, y - 3, { lineBreak: false });
        doc.restore();
    }
    doc.restore();
};

const drawSeal = (doc, invoice) => {
    if (String(invoice?.status || '').toLowerCase() !== 'paid') return;

    const stampCode = makeStampCode(invoice);
    const cx = 300;
    const cy = 470;
    const white = '#1d4ed8';
    const rOuter = 112;
    const rMid = 100;
    const rInner = 78;

    doc.save();
    doc.rotate(-12, { origin: [cx, cy] });
    doc.opacity(0.12);
    doc.lineWidth(2);
    doc.strokeColor(white);
    doc.fillColor(white);

    // Outer ring
    doc.circle(cx, cy, rOuter).stroke();

    // Dashed mid ring
    doc.dash(6, { space: 6 });
    doc.circle(cx, cy, rMid).stroke();
    doc.undash();

    // Inner ring
    doc.lineWidth(1.5);
    doc.circle(cx, cy, rInner).stroke();

    // Circular text
    doc.font('Helvetica-Bold').fontSize(9);
    drawCircularText(doc, ' MIRACHPOS • VERIFIED • INVOICE • ', cx, cy, 94, -Math.PI / 2 - 0.7);

    // Center monogram
    doc.font('Helvetica-Bold').fontSize(26);
    doc.text('MP', cx - rInner, cy - 20, { width: rInner * 2, align: 'center' });

    doc.font('Helvetica-Bold').fontSize(12);
    doc.text('PAID', cx - rInner, cy + 10, { width: rInner * 2, align: 'center' });

    doc.font('Helvetica').fontSize(8);
    doc.text(stampCode, cx - rInner, cy + 28, { width: rInner * 2, align: 'center' });

    doc.opacity(1);
    doc.restore();
};

// Helper to draw header
const drawHeader = (doc, title, tenantConfig = null) => {
    // Logo placeholder - in production, load from tenantConfig or platform config
    // if (tenantConfig?.logoUrl) ...

    doc
        .fontSize(20)
        .text('MirachPOS', 50, 50)
        .fontSize(10)
        .text('Professional Point of Sale', 50, 75);

    doc
        .fontSize(20)
        .text(title, { align: 'right' }, 50);

    doc
        .moveTo(50, 100)
        .lineTo(550, 100)
        .stroke();

    return 120; // Y position after header
};

const drawKeyValueRow = (doc, label, value, y) => {
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280');
    doc.text(String(label || ''), 50, y, { width: 240, align: 'left' });

    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    doc.text(String(value || ''), 300, y, { width: 250, align: 'right' });

    doc.moveTo(50, y + 18).lineTo(550, y + 18).strokeColor('#e5e7eb').lineWidth(1).stroke();
    return y + 26;
};

const drawTotals = (doc, invoice, startY) => {
    const labelX = 360;
    const valueX = 540;
    let y = startY;

    doc.font('Helvetica').fontSize(10);
    doc.text('Subtotal:', labelX, y, { width: 120, align: 'right' });
    doc.text(fmtMoney(invoice.subtotal_etb), valueX - 120, y, { width: 120, align: 'right' });

    y += 18;
    doc.text('Tax:', labelX, y, { width: 120, align: 'right' });
    doc.text(fmtMoney(invoice.tax_etb), valueX - 120, y, { width: 120, align: 'right' });

    y += 18;
    doc.text('Discount:', labelX, y, { width: 120, align: 'right' });
    doc.text(fmtMoney(invoice.discount_etb), valueX - 120, y, { width: 120, align: 'right' });

    y += 22;
    doc.moveTo(360, y).lineTo(540, y).strokeColor('#111827').opacity(0.25).stroke().opacity(1);
    y += 10;

    doc.font('Helvetica-Bold').fontSize(14);
    doc.text('TOTAL:', labelX, y, { width: 120, align: 'right' });
    doc.text(fmtMoney(invoice.total_etb), valueX - 180, y, { width: 180, align: 'right' });

    return y + 24;
};

// Generate Invoice PDF
const generateInvoicePDF = async (invoiceId) => {
    const invoice = await db()
        .select(['*'])
        .from('invoices')
        .where({ id: invoiceId })
        .first();

    if (!invoice) throw new Error('Invoice not found');

    const tenant = await db()
        .select(['name'])
        .from('tenants')
        .where({ id: invoice.tenant_id })
        .first();

    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    // Watermark seal behind content (paid only)
    drawSeal(doc, invoice);

    // -- Header --
    drawHeader(doc, 'INVOICE');

    // -- Key/Value block (reference-style rows) --
    let y = 140;
    y = drawKeyValueRow(doc, 'Bill To', tenant?.name || 'Valued Customer', y);
    y = drawKeyValueRow(doc, 'Invoice #', invoice.invoice_number || '', y);
    y = drawKeyValueRow(doc, 'Invoice Date', fmtDate(invoice.issue_date), y);
    y = drawKeyValueRow(doc, 'Due Date', fmtDate(invoice.due_date), y);

    const statusText = String(invoice.status || '').toUpperCase();
    y = drawKeyValueRow(doc, 'Status', statusText, y);

    y += 10;

    // -- Line Items Table --
    y = Math.max(y, 280);

    const lineItemsRaw = safeJsonParse(invoice.line_items_json, []);
    const lineItems = Array.isArray(lineItemsRaw) ? lineItemsRaw : [];

    const tableRows = lineItems.length
        ? lineItems.map((item) => [
            String(item?.description ?? ''),
            String(item?.qty ?? ''),
            fmtMoney(item?.unitPrice),
            fmtMoney(item?.amount),
        ])
        : [['(No items)', '', '', '']];

    const table = {
        title: '',
        headers: ['Description', 'Qty', 'Unit Price', 'Total'],
        rows: tableRows,
    };

    await doc.table(table, {
        x: 50,
        y,
        width: 500,
        divider: {
            header: { disabled: false, width: 2, opacity: 1 },
            horizontal: { disabled: false, width: 1, opacity: 0.5 },
        },
        headers: [
            { width: 250, align: 'left' },
            { width: 50, align: 'center' },
            { width: 100, align: 'right' },
            { width: 100, align: 'right' },
        ],
    });

    // -- Totals (reference-style rows) --
    y = doc.y + 18;
    y = drawKeyValueRow(doc, 'Subtotal', fmtMoney(invoice.subtotal_etb), y);
    y = drawKeyValueRow(doc, 'Tax', fmtMoney(invoice.tax_etb), y);
    y = drawKeyValueRow(doc, 'Discount', fmtMoney(invoice.discount_etb), y);

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827');
    doc.text('TOTAL', 50, y, { width: 240, align: 'left' });
    doc.text(fmtMoney(invoice.total_etb), 300, y, { width: 250, align: 'right' });
    doc.moveTo(50, y + 18).lineTo(550, y + 18).strokeColor('#111827').opacity(0.15).lineWidth(1.5).stroke().opacity(1);
    y += 30;

    // Stamp code hint (like “scan to verify” style without QR dependency)
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280');
    doc.text(`Verification Code: ${makeStampCode(invoice)}`, 50, y, { width: 500, align: 'center' });

    // -- Footer --
    doc.end();

    return new Promise((resolve) => {
        doc.on('end', () => {
            resolve(Buffer.concat(buffers));
        });
    });
};

// Generate Report PDF (Generic)
const generateReportPDF = async (reportTitle, dateRange, columns, rows) => {
    const options = arguments.length >= 5 && arguments[4] && typeof arguments[4] === 'object' ? arguments[4] : {};

    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    let pageNum = 1;
    const periodText = dateRange?.from && dateRange?.to
        ? `Period: ${safeText(dateRange.from)} to ${safeText(dateRange.to)}`
        : '';

    const headerOpts = {
        businessName: options?.businessName,
        reportTitle: reportTitle,
        periodText,
    };

    drawReportHeader(doc, headerOpts);
    drawReportFooter(doc, { pageNum });

    doc.on('pageAdded', () => {
        pageNum += 1;
        drawReportHeader(doc, headerOpts);
        drawReportFooter(doc, { pageNum });
    });

    // -- Table --
    const table = {
        title: '',
        headers: columns.map(c => c.header),
        rows: rows.map(r => columns.map(c => {
            const val = r[c.key];
            return c.format ? c.format(val) : String(val ?? '');
        })),
    };

    await doc.table(table, {
        x: 50,
        y: doc.y,
        width: 500,
        divider: {
            header: { disabled: false, width: 1.5, opacity: 1 },
            horizontal: { disabled: false, width: 1, opacity: 0.45 },
        },
        headers: columns.map((c) => ({
            width: c.width || (500 / columns.length),
            align: c.align || 'left',
        })),
    });

    doc.y = doc.y + 10;
    drawTotalsBlock(doc, options?.totals);
    drawSignatures(doc);

    doc.end();

    return new Promise((resolve) => {
        doc.on('end', () => {
            resolve(Buffer.concat(buffers));
        });
    });
};

module.exports = {
    generateInvoicePDF,
    generateReportPDF,
};
