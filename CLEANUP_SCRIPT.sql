-- SQL Cleanup Script for Tenant: tnt_a0b1013cf894f_19ba90bcc40
-- Version 3: Fixed column errors for restaurant_tables

-- 1. POS Transactional Data (Orders & Payments)
DELETE FROM order_payments WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM order_items WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM pos_payment_gateway_transactions WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM pos_public_order_links WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM void_refund_log WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM guests_transactions WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM loyalty_transactions WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM print_queue WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM purchase_order_items WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM purchase_orders WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM orders WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';

-- 2. Reporting & Dashboard Statistics (The charts and KPIs)
DELETE FROM daily_sales_summary WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM hourly_sales_summary WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM product_sales_summary WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM category_sales_summary WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM staff_sales_summary WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM shift_reports WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';

-- 3. Logs, Events, and Audit Trails
DELETE FROM events WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM branch_events WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM audit_log WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM sync_events WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM sync_drafts WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM shift_logs WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM finance_ledger WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM notification_reads WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
DELETE FROM billing_notifications WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';

-- 4. POS Application State (Crucial for UI reset)
DELETE FROM pos_state WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';

-- 5. Reset Restaurant Tables (Freeing them up)
UPDATE restaurant_tables 
SET status = 'Free', 
    open_order_id = NULL, 
    last_order_id = NULL,
    assigned_staff_id = NULL,
    assigned_staff_name = NULL
WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';

-- 6. Reset Customer Loyalty & Balances (Derived from order history)
UPDATE customers 
SET loyalty_points = 0, 
    loyalty_balance = 0,
    loyalty_points_expires_at = NULL,
    loyalty_points_updated_at = NULL
WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40';
