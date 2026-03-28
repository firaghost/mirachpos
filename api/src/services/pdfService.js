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

function drawKpiTiles(doc, totals) {
    const items = Array.isArray(totals) ? totals : [];
    if (!items.length) return;

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const tileGap = 10;
    const tileH = 48;
    const tilesPerRow = width >= 520 ? 4 : 3;
    const tileW = (width - tileGap * (tilesPerRow - 1)) / tilesPerRow;

    const maxTiles = Math.min(items.length, tilesPerRow);
    ensureSpace(doc, tileH + 14);

    doc.save();
    let x = left;
    const y = doc.y;
    for (let i = 0; i < maxTiles; i++) {
        const t = items[i] || {};
        doc.roundedRect(x, y, tileW, tileH, 10).fill('#f8fafc');
        doc.roundedRect(x, y, tileW, tileH, 10).strokeColor('#e5e7eb').lineWidth(1).stroke();

        doc.fillColor('#64748b');
        doc.font('Helvetica').fontSize(8);
        doc.text(truncate(safeText(t.label || ''), 24), x + 10, y + 9, { width: tileW - 20, align: 'left' });

        doc.fillColor('#0f172a');
        doc.font('Helvetica-Bold').fontSize(11);
        doc.text(truncate(safeText(t.value || ''), 22), x + 10, y + 24, { width: tileW - 20, align: 'left' });

        x += tileW + tileGap;
    }
    doc.restore();

    doc.y = y + tileH + 14;
}

function normalizeColumns(doc, columns) {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const cols = Array.isArray(columns) ? columns : [];
    const base = cols.map((c) => {
        const w = Number(c?.width);
        return { ...c, width: Number.isFinite(w) && w > 0 ? w : 100 };
    });

    const sum = base.reduce((s, c) => s + (Number(c.width) || 0), 0) || 1;
    const usable = Math.max(280, width);
    return base.map((c) => ({
        ...c,
        _w: Math.max(44, Math.floor((usable * (Number(c.width) || 0)) / sum)),
    }));
}

function renderSimpleTable(doc, columns, rows) {
    const cols = normalizeColumns(doc, columns);
    const data = Array.isArray(rows) ? rows : [];

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    const headerH = 22;
    const rowH = 18;
    const padX = 6;

    const drawHeaderRow = () => {
        ensureSpace(doc, headerH + rowH);

        const y = doc.y;
        doc.save();
        doc.rect(left, y, width, headerH).fill('#111827');
        doc.fillColor('#ffffff');
        doc.font('Helvetica-Bold').fontSize(9);

        let x = left;
        for (const c of cols) {
            doc.text(truncate(safeText(c.header || ''), 26), x + padX, y + 6, {
                width: c._w - padX * 2,
                align: c.align || 'left',
                lineBreak: false,
            });
            x += c._w;
        }
        doc.restore();
        doc.y = y + headerH;
    };

    drawHeaderRow();

    for (let i = 0; i < data.length; i++) {
        const r = data[i];
        ensureSpace(doc, rowH + 8);
        const y = doc.y;
        const zebra = i % 2 === 0;
        doc.save();
        if (zebra) doc.rect(left, y, width, rowH).fill('#f8fafc');
        doc.strokeColor('#e5e7eb').lineWidth(1);
        doc.moveTo(left, y + rowH).lineTo(right, y + rowH).stroke();

        doc.fillColor('#0f172a');
        doc.font('Helvetica').fontSize(9);

        let x = left;
        for (const c of cols) {
            const raw = r && Object.prototype.hasOwnProperty.call(r, c.key) ? r[c.key] : '';
            const val = c.format ? c.format(raw) : safeText(raw);
            const maxChars = Math.max(8, Math.floor((c._w - padX * 2) / 5));
            doc.text(truncate(val, maxChars), x + padX, y + 5, {
                width: c._w - padX * 2,
                align: c.align || 'left',
                lineBreak: false,
            });
            x += c._w;
        }

        doc.restore();
        doc.y = y + rowH;
    }
}
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

const parseImageDataUrl = (dataUrl) => {
    const raw = String(dataUrl || '').trim();
    if (!raw) return null;
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(raw);
    if (!m) return null;
    try {
        const ext = String(m[1] || '').toLowerCase();
        const buf = Buffer.from(String(m[2] || ''), 'base64');
        if (!buf.length) return null;
        return { ext, buf };
    } catch {
        return null;
    }
};

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
    // Reset y position after page add (header will set proper position via pageAdded event)
    if (doc.y > doc.page.height - doc.page.margins.bottom - 100) {
        doc.y = doc.page.margins.top + 80;
    }
};

const drawReportHeader = (doc, opts) => {
    const businessName = safeText(opts?.businessName || 'MirachPOS').trim() || 'MirachPOS';
    const reportTitle = safeText(opts?.reportTitle || 'Report').trim() || 'Report';
    const periodText = safeText(opts?.periodText || '').trim();

    const accent = safeText(opts?.accent || '#111827').trim() || '#111827';
    const logoDataUrl = opts?.logoDataUrl;
    const parsedLogo = parseImageDataUrl(logoDataUrl);

    const top = doc.page.margins.top;
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;

    doc.save();
    doc.rect(left, top, right - left, 56).fill('#0b1220');
    doc.rect(left, top + 56, right - left, 4).fill(accent);

    const hasLogo = !!parsedLogo;
    const logoSize = 28;
    const logoX = left + 14;
    const logoY = top + 14;
    if (hasLogo) {
        try {
            doc.image(parsedLogo.buf, logoX, logoY, { width: logoSize, height: logoSize });
        } catch {
            // ignore
        }
    }

    const textX = hasLogo ? logoX + logoSize + 10 : left + 14;
    const titleRightX = right - 14;

    doc.fillColor('#ffffff');
    doc.font('Helvetica-Bold').fontSize(14);
    doc.text(truncate(businessName, 48), textX, top + 12, { width: titleRightX - textX, align: 'left' });

    doc.font('Helvetica').fontSize(9).fillColor('#cbd5e1');
    doc.text(reportTitle.toUpperCase(), textX, top + 30, { width: titleRightX - textX, align: 'left' });
    if (periodText) {
        doc.text(periodText, textX, top + 42, { width: titleRightX - textX, align: 'left' });
    }

    doc.restore();

    doc.y = Math.max(doc.y, top + 74);
};

const drawReportFooter = (doc, opts) => {
    const yBefore = doc.y;
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

    doc.y = yBefore;
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
}

// Professional Daily Sales Report PDF - ULTRA SIMPLE
async function generateReportPDF(reportTitle, dateRange, columns, rows, options = {}) {
    const doc = new PDFDocument({ 
        margin: 30,
        size: 'A4'
    });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));

    const colors = {
        primary: '#1A365D',
        headerBg: '#F7FAFC',
        border: '#E2E8F0',
        text: '#2D3748',
        lightText: '#718096',
    };

    const safeText = (t) => (t === null || t === undefined ? '' : String(t));
    const businessName = safeText(options?.businessName || 'Business');
    let y = 30;

    // HEADER
    doc.rect(30, 30, doc.page.width - 60, 3).fill(colors.primary);
    doc.font('Helvetica-Bold').fontSize(16).fillColor(colors.primary).text(businessName, 30, 38);
    doc.font('Helvetica').fontSize(10).fillColor(colors.lightText).text('DAILY SALES REPORT', 30, 58);
    doc.font('Helvetica').fontSize(8).fillColor(colors.lightText)
       .text(`${dateRange.from}`, doc.page.width - 180, 38, { align: 'right' });

    y = 80;

    // SUMMARY - 2 columns compact
    if (options?.totals?.length) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(colors.primary).text('SUMMARY', 30, y);
        y += 14;
        
        const colWidth = (doc.page.width - 60) / 2;
        options.totals.slice(0, 6).forEach((item, idx) => {
            const col = idx % 2;
            const row = Math.floor(idx / 2);
            const x = 30 + (col * colWidth);
            const itemY = y + (row * 18);
            doc.font('Helvetica').fontSize(7).fillColor(colors.lightText).text(item.label, x, itemY);
            doc.font('Helvetica-Bold').fontSize(9).fillColor(colors.text).text(item.value, x, itemY + 9);
        });
        y += (Math.ceil(Math.min(options.totals.length, 6) / 2) * 18) + 6;
    }

    // TABLE FUNCTION - NO PAGE BREAKS
    const drawTable = (title, cols, data) => {
        if (!data?.length || y > 760) return y;
        
        const left = 30;
        const tableWidth = doc.page.width - 60;
        const colWidth = tableWidth / cols.length;
        
        // Title
        doc.font('Helvetica-Bold').fontSize(9).fillColor(colors.primary).text(title.toUpperCase(), left, y);
        y += 12;
        
        // Header
        doc.rect(left, y, tableWidth, 16).fill(colors.primary);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
        cols.forEach((col, i) => {
            const x = left + (i * colWidth);
            const align = col.align === 'right' ? 'right' : 'left';
            const textX = align === 'right' ? x + colWidth - 5 : x + 5;
            let text = (col.header || col.key || '').substring(0, 10);
            doc.text(text, textX, y + 4, { width: colWidth - 10, align, lineBreak: false });
        });
        y += 16;
        
        // Data rows - max 3 rows
        doc.font('Helvetica').fontSize(8).fillColor(colors.text);
        data.slice(0, 3).forEach((row, rowIdx) => {
            if (rowIdx % 2 === 1) {
                doc.rect(left, y, tableWidth, 14).fill(colors.headerBg);
            }
            
            cols.forEach((col, i) => {
                const x = left + (i * colWidth);
                let val = row?.[col.key] ?? '';
                if (col.format) val = col.format(val);
                val = String(val).substring(0, 12);
                const align = col.align === 'right' ? 'right' : 'left';
                const textX = align === 'right' ? x + colWidth - 5 : x + 5;
                doc.text(val, textX, y + 3, { width: colWidth - 10, align, lineBreak: false });
            });
            
            y += 14;
        });
        y += 4;
        return y;
    };

    // Payment Methods table (first additional section)
    const sections = options?.additionalSections || [];
    if (sections[0]?.rows?.length && y < 700) {
        y = drawTable(sections[0].title, sections[0].columns, sections[0].rows);
    }

    // Products table
    if (columns?.length && rows?.length && y < 700) {
        y = drawTable('PRODUCTS', columns, rows);
    }

    // Footer
    doc.font('Helvetica').fontSize(7).fillColor(colors.lightText)
       .text('Page 1 of 1', 30, 830)
       .text(businessName, doc.page.width - 100, 830, { align: 'right', width: 70 });
    
    doc.end();
    return new Promise((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
    });
};

module.exports = {
    generateInvoicePDF,
    generateReportPDF,
};
