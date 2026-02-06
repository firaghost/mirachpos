# MirachPOS Reporting System - Full Analysis Report

**Date:** 2026-02-04  
**Analyst:** Khalid (AI Agent)  
**Scope:** Owner & Branch Manager Reporting + Export Functionality  

---

## Executive Summary

The MirachPOS reporting system has a solid foundation with pre-aggregated data tables and multiple export formats. However, several critical gaps prevent it from being "world-class" - most notably missing cost/profit calculations, lack of true Excel support, and no real-time data integration.

**Overall Rating: 6.5/10** - Functional but needs significant enhancement for enterprise use.

---

## 1. Current Architecture

### 1.1 Data Flow

```
Orders (Live) → Aggregation Jobs → Summary Tables → API Endpoints → Export
     ↓                (Daily)            ↓              ↓            ↓
  Real-time      reportAggregation    Pre-agg      Enhanced      PDF/CSV
  (voids,        Service              tables       Reports       Export
  refunds)       - aggregateDaily      - daily_     Routes        - pdfService
                 - aggregateHourly      sales_       - /hourly     - exportUtils
                 - aggregateProduct     summary      - /products
                 - aggregateStaff       - hourly_    - /shifts
                 - buildShiftReport     sales_       - /voids
                                        summary      - /export
                                        - product_
                                        sales_
                                        summary
                                        - staff_
                                        sales_
                                        summary
```

### 1.2 Database Schema (Report Tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `daily_sales_summary` | Daily aggregates | report_date, order_count, net_sales_etb, payment_breakdown_json |
| `hourly_sales_summary` | Hourly breakdown | report_date, hour, order_count, net_sales_etb |
| `product_sales_summary` | Product performance | product_id, report_date, qty_sold, revenue_etb, void_qty |
| `category_sales_summary` | Category aggregates | category, report_date, qty_sold, revenue_etb |
| `staff_sales_summary` | Staff performance | staff_id, report_date, order_count, net_sales_etb, tips_etb |
| `shift_reports` | Shift management | opened_at, closed_at, opening_cash_etb, expected_cash_etb, cash_difference_etb |
| `void_refund_log` | Audit trail | type, amount_etb, reason, authorized_by, occurred_at |

---

## 2. Owner Reports (`/api/owner/reports/*`)

### 2.1 Available Endpoints

| Endpoint | Method | Description | Export Formats |
|----------|--------|-------------|----------------|
| `/hourly` | GET | Hourly sales heatmap | CSV, PDF |
| `/products` | GET | Product performance | CSV, PDF |
| `/shifts` | GET | Shift reports list | CSV, PDF |
| `/shifts/:id` | GET | Single shift detail | - |
| `/voids-refunds` | GET | Void/refund analysis | CSV, PDF |
| `/export/csv` | GET | CSV export (all types) | CSV |
| `/export/pdf` | GET | PDF export (all types) | PDF |
| `/aggregate` | POST | Manual aggregation trigger | - |

### 2.2 Code Analysis: enhancedReports.js

**Strengths:**
- Pre-aggregated data for fast queries
- Proper date range handling
- Branch filtering support
- Peak hours calculation in hourly reports
- Category grouping in product reports

**Weaknesses:**
```javascript
// Line ~45-50: Hardcoded date defaults
const from = fromIso && !Number.isNaN(new Date(fromIso).getTime())
    ? toDateString(fromIso)
    : toDateString(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
// No validation of date range limits

// Line ~200-210: No pagination on shift reports
const shifts = await query
    .orderBy('s.opened_at', 'desc')
    .limit(limit)  // Only client-provided limit
    .offset(offset);

// Line ~350-380: CSV generation is string concatenation
// No streaming, can cause memory issues with large datasets
let csvContent = '';
for (const row of data) {
    csvContent += `${row.date},${row.branchId},...\n`;
}
```

### 2.3 PDF Export Analysis

**Current Implementation (pdfService.js):**

```javascript
// Uses pdfkit-table library
const PDFDocument = require('pdfkit-table');

// Report PDF generation
const generateReportPDF = async (reportTitle, dateRange, columns, rows) => {
    const doc = new PDFDocument({ margin: 50 });
    // ... basic table layout
};
```

**Limitations:**
1. No business logo support
2. No TIN number display (required for ERCA compliance)
3. No signature lines for audit purposes
4. No page numbers
5. No multi-sheet reports
6. Basic styling only

---

## 3. Branch Manager Reports (`/api/manager/reports/*`)

### 3.1 Available Endpoints

| Endpoint | Method | Description | Aggregation Source |
|----------|--------|-------------|-------------------|
| `/daily` | GET | Daily sales summary | Pre-aggregated |
| `/hourly` | GET | Hourly breakdown | Pre-aggregated |
| `/products` | GET | Top products | Pre-aggregated |
| `/categories` | GET | Category performance | Pre-aggregated |
| `/staff` | GET | Staff sales performance | Pre-aggregated |
| `/shifts` | GET | Shift reports | Pre-aggregated |
| `/voids` | GET | Void/refund events | Raw data |
| `/aggregate` | POST | Trigger manual aggregation | - |

### 3.2 Frontend Analysis: BranchReports.tsx

**File Size:** 2,272 lines  
**Key Features:**
- Period selection (Daily/Weekly/Monthly/Custom)
- Date range picker
- Staff filter dropdown
- Real-time KPI calculations
- Multiple chart types (Area chart, Bar chart)
- Three export modes: Full CSV, Summary CSV, Staff CSV

**Export Functions Analysis:**

```typescript
// exportFullCsv() - Lines ~850-1050
// Exports EVERYTHING in one massive CSV
// Sections: meta, kpi, payments, trend, categories, products, 
//           expenses, shifts, voids, staff, transactions

// exportCsv() - Lines ~1052-1150  
// Summary-only export with professional formatting
// Uses exportUtils.ts helpers

// exportStaffCsv() - Lines ~1152-1220
// Staff-specific export with hours calculation
```

**Frontend PDF Issue:**
```typescript
// Lines ~35-36: Libraries imported but NOT USED
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
// No PDF export function implemented!
```

---

## 4. Critical Issues Found

### 4.1 🔴 CRITICAL: Product Cost/Profit Data is Wrong

**Location:** `reportAggregationService.js` lines 312-320

```javascript
await db().from('product_sales_summary').insert({
    id: summaryId,
    tenant_id: tenantId,
    branch_id: branchId,
    product_id: productId,
    product_name: data.name,
    category: data.category,
    report_date: dateStr,
    qty_sold: data.qtySold,
    revenue_etb: data.revenue,
    cost_etb: 0, // ⚠️ HARDCODED TO ZERO!
    profit_etb: data.revenue, // ⚠️ Just revenue, not profit!
    void_qty: data.voidQty,
    computed_at: nowIso,
})
```

**Impact:** All profit reports show 100% margin, which is incorrect.

**Fix Required:**
```javascript
// Fetch cost from inventory_items
const inventoryItem = await db()
    .select(['avg_cost_etb', 'unit_cost_etb'])
    .from('inventory_items')
    .where({ product_id: productId, tenant_id: tenantId })
    .first();

const unitCost = inventoryItem?.avg_cost_etb || inventoryItem?.unit_cost_etb || 0;
const cost = unitCost * data.qtySold;
const profit = data.revenue - cost;
```

### 4.2 🔴 CRITICAL: No Real-Time Data

**Location:** `reportAggregationService.js` line 627

```javascript
const runDailyAggregation = async (date = null) => {
    const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday only!
    // ...
}
```

**Impact:** Today's sales don't appear in reports until tomorrow.

**Fix Required:**
```javascript
// Add fallback to live orders when requesting today
const getDailySalesSummary = async ({ tenantId, branchId, fromDate, toDate }) => {
    const todayStr = toDateString(new Date());
    
    // Get aggregated data
    const aggregated = await db()...;
    
    // If requesting today, also fetch live orders
    if (toDate >= todayStr) {
        const liveOrders = await fetchLiveOrdersForToday(tenantId, branchId);
        const liveSummary = calculateSummaryFromOrders(liveOrders);
        // Merge with aggregated
    }
    
    return mergedData;
};
```

### 4.3 🟡 HIGH: No True Excel Export

**Current State:** Only CSV export available

**Location:** `exportUtils.ts`

```typescript
export type ExportFormat = 'csv' | 'excel' | 'pdf';
// 'excel' type declared but NOT IMPLEMENTED
```

**Fix Required:**
```javascript
// Add xlsx library to backend
const XLSX = require('xlsx');

// Multi-sheet Excel export
const exportToExcel = (data) => {
    const wb = XLSX.utils.book_new();
    
    // Sheet 1: Summary
    const ws1 = XLSX.utils.json_to_sheet(data.summary);
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
    
    // Sheet 2: Daily Breakdown
    const ws2 = XLSX.utils.json_to_sheet(data.daily);
    XLSX.utils.book_append_sheet(wb, ws2, 'Daily');
    
    // Sheet 3: Products
    const ws3 = XLSX.utils.json_to_sheet(data.products);
    XLSX.utils.book_append_sheet(wb, ws3, 'Products');
    
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
```

### 4.4 🟡 HIGH: Branch Manager PDF Export Missing

**Location:** `BranchReports.tsx`

**Issue:** jspdf library imported but no export function implemented.

**Fix Required:** Implement PDF export function or connect to backend PDF endpoint.

### 4.5 🟡 HIGH: Large Date Range Performance Risk

**Location:** Multiple files

```javascript
// No hard limits on date ranges
const from = req.query.from || '2020-01-01';
const to = req.query.to || '2030-12-31';
// Could return millions of rows!
```

**Fix Required:**
```javascript
const MAX_DATE_RANGE_DAYS = 90;
const days = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24);
if (days > MAX_DATE_RANGE_DAYS) {
    return res.status(400).json({ error: 'Date range too large. Maximum 90 days.' });
}
```

### 4.6 🟠 MEDIUM: No Report Scheduling

**Missing Feature:** Automated daily/weekly/monthly reports via email

**Implementation Needed:**
- New table: `report_schedules`
- Cron job to generate and email reports
- UI to configure schedules

### 4.7 🟠 MEDIUM: Missing Inventory Valuation Report

**Gap:** No report showing current stock value

**Implementation:**
```sql
SELECT 
    ii.product_id,
    ii.product_name,
    ii.current_qty,
    ii.avg_cost_etb,
    (ii.current_qty * ii.avg_cost_etb) as stock_value
FROM inventory_items ii
WHERE ii.tenant_id = ?;
```

### 4.8 🟠 MEDIUM: No ERCA Tax Compliance Report

**Gap:** Ethiopia requires specific tax reporting format

**Required Fields:**
- TIN number
- Taxable sales by category
- VAT collected
- Date range
- Digital signature/stamp

---

## 5. Code Quality Issues

### 5.1 Inconsistent Error Handling

```javascript
// Good example (enhancedReports.js)
try {
    const data = await getDailySalesSummary(...);
    return res.json({ ok: true, data });
} catch (e) {
    return next(e);
}

// Bad example (BranchReports.tsx)
try {
    const res = await apiFetch(...);
    const json = await res.json();
} catch {
    // Silent failure - no user notification
}
```

### 5.2 Date Handling Inconsistencies

**Three different date formats used:**
1. `toDateString()` - returns '2026-02-04'
2. `toISOString()` - returns '2026-02-04T12:00:00.000Z'
3. `new Date()` - Date objects

**Recommendation:** Standardize on ISO 8601 strings for API, Date objects internally.

### 5.3 Missing Input Validation

**No Zod validation on report parameters:**
```javascript
// Current - no validation
const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';

// Should be:
const schema = z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    branchId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(1000).default(100)
});
```

### 5.4 Memory Issues with Large Exports

```javascript
// Current: String concatenation
let csvContent = '';
for (const row of data) {
    csvContent += `${row.date},...\n`;  // Can cause memory overflow
}

// Better: Use streams
const stream = require('stream');
const readable = new stream.Readable({
    read() {
        for (const row of data) {
            this.push(formatRow(row));
        }
        this.push(null);
    }
});
```

---

## 6. Security Review

### 6.1 Access Control ✅ GOOD

All endpoints properly check authentication:
```javascript
tenantMiddleware, requireAuth, requireModule('reports')
```

### 6.2 Missing Rate Limiting ⚠️

Export endpoints should have stricter limits:
```javascript
// Add to enhancedReports.js exports
app.use('/api/owner/reports/export', strictLimiter);  // 10 req/min
```

### 6.3 Missing Audit Logging ⚠️

Report exports should be logged:
```javascript
await logAudit({
    tenantId: req.tenant.id,
    actorStaffId: req.auth.userId,
    type: 'report_export',
    summary: `Exported ${reportType} as ${format}`,
    payload: { from, to, format }
});
```

---

## 7. Recommendations Summary

### Phase 1: Critical Fixes (Week 1)

| Task | File(s) | Effort | Priority |
|------|---------|--------|----------|
| Fix cost/profit calculation | reportAggregationService.js | 4 hrs | P0 |
| Add real-time data fallback | reportAggregationService.js | 6 hrs | P0 |
| Add date range limits | enhancedReports.js, manager.js | 2 hrs | P1 |
| Add rate limiting to exports | app.js | 1 hr | P1 |

### Phase 2: Feature Enhancement (Week 2-3)

| Task | File(s) | Effort | Priority |
|------|---------|--------|----------|
| Implement Excel (.xlsx) export | New: excelService.js | 8 hrs | P1 |
| Add Branch Manager PDF export | BranchReports.tsx | 6 hrs | P1 |
| Add professional PDF templates | pdfService.js | 8 hrs | P2 |
| Add inventory valuation report | New endpoint | 8 hrs | P2 |
| Add ERCA tax report | New endpoint | 12 hrs | P2 |

### Phase 3: Advanced Features (Week 4)

| Task | File(s) | Effort | Priority |
|------|---------|--------|----------|
| Add report scheduling | New: scheduler.js | 16 hrs | P2 |
| Add report comparison (YoY, MoM) | enhancedReports.js | 12 hrs | P3 |
| Add streaming for large exports | export utils | 8 hrs | P3 |
| Add report caching | Redis/file | 12 hrs | P3 |

---

## 8. Implementation Guide

### 8.1 Fix Product Cost/Profit (Priority P0)

```javascript
// In reportAggregationService.js, update aggregateProductSales

const inventoryItem = await trx('inventory_items')
    .select(['avg_cost_etb'])
    .where({ product_id: productId, tenant_id: tenantId })
    .first();

const unitCost = Number(inventoryItem?.avg_cost_etb || 0);
const cost = soldQty * unitCost;
const profit = revenue - cost;

await db().from('product_sales_summary').insert({
    // ... other fields
    cost_etb: cost,
    profit_etb: profit,
    // ...
});
```

### 8.2 Add Excel Export (Priority P1)

```bash
npm install xlsx
```

```javascript
// New file: services/excelService.js

const XLSX = require('xlsx');

const generateExcelReport = async (options) => {
    const { tenantId, branchId, fromDate, toDate, type } = options;
    
    const wb = XLSX.utils.book_new();
    
    // Fetch data
    const dailyData = await getDailySalesSummary({ tenantId, branchId, fromDate, toDate });
    const productData = await getProductPerformance({ tenantId, branchId, fromDate, toDate, limit: 500 });
    
    // Create sheets
    const ws1 = XLSX.utils.json_to_sheet(dailyData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Daily Summary');
    
    const ws2 = XLSX.utils.json_to_sheet(productData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Product Performance');
    
    // Style headers (requires xlsx-style or similar)
    // ... styling code
    
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

module.exports = { generateExcelReport };
```

### 8.3 Add Real-Time Data (Priority P0)

```javascript
// In reportAggregationService.js, add helper function

const fetchLiveOrdersForDate = async (tenantId, branchId, dateStr) => {
    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;
    
    return await db()
        .select(['id', 'total', 'tax', 'tip', 'discount', 'paid_at', 'payload'])
        .from('orders')
        .where({ tenant_id: tenantId, branch_id: branchId, status: 'Paid' })
        .andWhere('paid_at', '>=', startOfDay)
        .andWhere('paid_at', '<=', endOfDay);
};

// Modify getDailySalesSummary to include live data
const getDailySalesSummary = async ({ tenantId, branchId, fromDate, toDate }) => {
    // Get aggregated data
    const aggregated = await fetchAggregatedData(...);
    
    // Check if today is in range
    const todayStr = toDateString(new Date());
    if (toDate >= todayStr) {
        const liveOrders = await fetchLiveOrdersForDate(tenantId, branchId, todayStr);
        const liveSummary = calculateSummaryFromOrders(liveOrders);
        
        // Replace today's aggregated with live (or add if missing)
        const todayIndex = aggregated.findIndex(r => r.date === todayStr);
        if (todayIndex >= 0) {
            aggregated[todayIndex] = liveSummary;
        } else {
            aggregated.push(liveSummary);
        }
    }
    
    return aggregated;
};
```

---

## 9. Testing Checklist

After implementing fixes:

- [ ] Product profit calculation matches (Revenue - Cost)
- [ ] Today's orders appear in reports immediately
- [ ] Excel exports open correctly in Microsoft Excel
- [ ] Date ranges over 90 days are rejected
- [ ] PDF exports include business logo and TIN
- [ ] Branch Manager can export PDFs
- [ ] Large exports (>10MB) don't crash the server
- [ ] Report exports are logged in audit_log
- [ ] Rate limiting prevents export abuse
- [ ] All date ranges return consistent results

---

## 10. Conclusion

The MirachPOS reporting system has a solid architecture but needs refinement for enterprise use. The critical issues (cost calculation, real-time data) should be fixed immediately. The enhanced features (Excel export, PDF templates, scheduling) should follow in phases.

**Estimated time to world-class:** 3-4 weeks of focused development

**Contact:** For questions about this report, contact the development team.

---

*Report generated by Khalid (AI Agent) on 2026-02-04*  
*Scope: api/src/routes/enhancedReports.js, api/src/routes/manager.js, api/src/services/reportAggregationService.js, api/src/services/pdfService.js, screens/manager/BranchReports.tsx, utils/exportUtils.ts*
