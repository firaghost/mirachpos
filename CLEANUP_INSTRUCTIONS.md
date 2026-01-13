# SQL Cleanup Script for Tenant: tnt_a0b1013cf894f_19ba90bcc40

Run these commands in your database to completely wipe all order history, report aggregates, and dashboard stats for the specified tenant.

```sql
SET @tenantId = 'tnt_a0b1013cf894f_19ba90bcc40';

-- 1. POS Transactional Data (Orders & Payments)
DELETE FROM order_payments WHERE tenant_id = @tenantId;
DELETE FROM order_split_items WHERE tenant_id = @tenantId;
DELETE FROM order_splits WHERE tenant_id = @tenantId;
DELETE FROM order_items WHERE tenant_id = @tenantId;
DELETE FROM pos_payment_gateway_transactions WHERE tenant_id = @tenantId;
DELETE FROM pos_public_order_links WHERE tenant_id = @tenantId;
DELETE FROM void_refund_log WHERE tenant_id = @tenantId;
DELETE FROM guests_transactions WHERE tenant_id = @tenantId;
DELETE FROM orders WHERE tenant_id = @tenantId;

-- 2. Reporting & Dashboard Statistics (The charts and KPIs)
DELETE FROM daily_sales_summary WHERE tenant_id = @tenantId;
DELETE FROM hourly_sales_summary WHERE tenant_id = @tenantId;
DELETE FROM product_sales_summary WHERE tenant_id = @tenantId;
DELETE FROM category_sales_summary WHERE tenant_id = @tenantId;
DELETE FROM staff_sales_summary WHERE tenant_id = @tenantId;
DELETE FROM shift_reports WHERE tenant_id = @tenantId;

-- 3. Logs, Events, and Audit Trails
DELETE FROM events WHERE tenant_id = @tenantId;
DELETE FROM audit_log WHERE tenant_id = @tenantId;
DELETE FROM sync_events WHERE tenant_id = @tenantId;
DELETE FROM sync_drafts WHERE tenant_id = @tenantId;
DELETE FROM shift_logs WHERE tenant_id = @tenantId;
DELETE FROM finance_ledger WHERE tenant_id = @tenantId;
DELETE FROM notification_reads WHERE tenant_id = @tenantId;

-- 4. POS Application State (Crucial for UI reset)
DELETE FROM pos_state WHERE tenant_id = @tenantId;

-- 5. Reset Restaurant Tables (Freeing them up)
UPDATE restaurant_tables 
SET status = 'Free', 
    open_order_id = NULL, 
    last_order_id = NULL,
    assigned_staff_id = NULL,
    assigned_staff_name = NULL,
    cart_item_count = 0,
    current_total = 0
WHERE tenant_id = @tenantId;
```

# Frontend Cache Reset (Browser / Electron)

If data is still visible in the UI after the SQL above, it is definitely being loaded from the browser's local cache. Open the browser console (F12) and run:

```javascript
localStorage.clear();
sessionStorage.clear();
window.location.reload();
```
