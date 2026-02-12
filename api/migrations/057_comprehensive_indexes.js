/**
 * Migration: Comprehensive Index Optimization for All Tables
 * 
 * Adds performance-critical indexes for:
 * - High-frequency lookup tables (orders, products, inventory, customers)
 * - Reporting tables (sales summaries, audit logs)
 * - Auth/billing tables (subscriptions, invoices, payments)
 * - POS operations (payment gateway, print queue, loyalty)
 * - Inventory/Purchasing (purchase orders, stock movements)
 * - Restaurant features (tables, bookings)
 */

const indexExists = async (knex, { table, index }) => {
  try {
    const rows = await knex('information_schema.statistics')
      .select(['index_name'])
      .whereRaw('table_schema = DATABASE()')
      .andWhere({ table_name: table, index_name: index })
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
};

const createIndexIfMissing = async (knex, { table, index, columns }) => {
  if (!table || !index || !columns) return;
  const exists = await indexExists(knex, { table, index });
  if (exists) return;

  try {
    await knex.schema.raw(`CREATE INDEX ${index} ON ${table} (${columns})`);
  } catch {
    // ignore - may already exist or naming conflict
  }
};

const dropIndexIfExists = async (knex, { table, index }) => {
  if (!table || !index) return;
  const exists = await indexExists(knex, { table, index });
  if (!exists) return;

  try {
    await knex.schema.raw(`DROP INDEX ${index} ON ${table}`);
  } catch {
    // ignore
  }
};

exports.up = async (knex) => {
  // ============================================================================
  // CORE POS TABLES
  // ============================================================================

  // order_items - product lookup for reporting
  await createIndexIfMissing(knex, {
    table: 'order_items',
    index: 'idx_order_items_tenant_product',
    columns: 'tenant_id, product_id',
  });

  // order_items - product + time for sales reports
  await createIndexIfMissing(knex, {
    table: 'order_items',
    index: 'idx_order_items_tenant_product_created',
    columns: 'tenant_id, product_id, created_at',
  });

  // order_payments - status lookups
  await createIndexIfMissing(knex, {
    table: 'order_payments',
    index: 'idx_order_payments_status',
    columns: 'status',
  });

  // order_payments - method lookups for reporting
  await createIndexIfMissing(knex, {
    table: 'order_payments',
    index: 'idx_order_payments_method',
    columns: 'method',
  });

  // order_splits - status for active splits
  await createIndexIfMissing(knex, {
    table: 'order_splits',
    index: 'idx_order_splits_status',
    columns: 'status',
  });

  // ============================================================================
  // INVENTORY & PURCHASING
  // ============================================================================

  // inventory_items - category lookups
  await createIndexIfMissing(knex, {
    table: 'inventory_items',
    index: 'idx_inventory_items_category',
    columns: 'category',
  });

  // inventory_items - tenant + status for active items
  await createIndexIfMissing(knex, {
    table: 'inventory_items',
    index: 'idx_inventory_items_tenant_status',
    columns: 'tenant_id, status',
  });

  // inventory_stock - item lookup (critical for stock checks)
  await createIndexIfMissing(knex, {
    table: 'inventory_stock',
    index: 'idx_inventory_stock_item',
    columns: 'item_id',
  });

  // inventory_stock - tenant + item composite
  await createIndexIfMissing(knex, {
    table: 'inventory_stock',
    index: 'idx_inventory_stock_tenant_item',
    columns: 'tenant_id, item_id',
  });

  // inventory_movements - item + time for stock history
  await createIndexIfMissing(knex, {
    table: 'inventory_movements',
    index: 'idx_inventory_movements_item_created',
    columns: 'item_id, created_at',
  });

  // purchase_orders - status for active POs
  await createIndexIfMissing(knex, {
    table: 'purchase_orders',
    index: 'idx_purchase_orders_status',
    columns: 'status',
  });

  // purchase_orders - tenant + status composite
  await createIndexIfMissing(knex, {
    table: 'purchase_orders',
    index: 'idx_purchase_orders_tenant_status',
    columns: 'tenant_id, status',
  });

  // purchase_orders - supplier lookups
  await createIndexIfMissing(knex, {
    table: 'purchase_orders',
    index: 'idx_purchase_orders_supplier',
    columns: 'supplier_id',
  });

  // purchase_order_items - PO lookup
  await createIndexIfMissing(knex, {
    table: 'purchase_order_items',
    index: 'idx_poi_purchase_order',
    columns: 'purchase_order_id',
  });

  // purchase_order_items - inventory item lookup
  await createIndexIfMissing(knex, {
    table: 'purchase_order_items',
    index: 'idx_poi_inventory_item',
    columns: 'inventory_item_id',
  });

  // suppliers - tenant lookup
  await createIndexIfMissing(knex, {
    table: 'suppliers',
    index: 'idx_suppliers_tenant',
    columns: 'tenant_id',
  });

  // suppliers - status for active suppliers
  await createIndexIfMissing(knex, {
    table: 'suppliers',
    index: 'idx_suppliers_status',
    columns: 'status',
  });

  // ============================================================================
  // MENU & PRODUCTS
  // ============================================================================

  // menu_products - category lookups
  await createIndexIfMissing(knex, {
    table: 'menu_products',
    index: 'idx_menu_products_category',
    columns: 'category',
  });

  // menu_products - tenant + category composite
  await createIndexIfMissing(knex, {
    table: 'menu_products',
    index: 'idx_menu_products_tenant_category',
    columns: 'tenant_id, category',
  });

  // menu_products - status for active products
  await createIndexIfMissing(knex, {
    table: 'menu_products',
    index: 'idx_menu_products_status',
    columns: 'status',
  });

  // menu_recipes - product lookup (critical for cost calculations)
  await createIndexIfMissing(knex, {
    table: 'menu_recipes',
    index: 'idx_menu_recipes_product',
    columns: 'product_id',
  });

  // menu_recipes - tenant + product composite
  await createIndexIfMissing(knex, {
    table: 'menu_recipes',
    index: 'idx_menu_recipes_tenant_product',
    columns: 'tenant_id, product_id',
  });

  // ============================================================================
  // CUSTOMERS & LOYALTY
  // ============================================================================

  // customers - tenant lookup
  await createIndexIfMissing(knex, {
    table: 'customers',
    index: 'idx_customers_tenant',
    columns: 'tenant_id',
  });

  // customers - phone lookup (frequent searches)
  await createIndexIfMissing(knex, {
    table: 'customers',
    index: 'idx_customers_phone',
    columns: 'phone',
  });

  // customers - tenant + phone composite
  await createIndexIfMissing(knex, {
    table: 'customers',
    index: 'idx_customers_tenant_phone',
    columns: 'tenant_id, phone',
  });

  // loyalty_points - customer lookup
  await createIndexIfMissing(knex, {
    table: 'loyalty_points',
    index: 'idx_loyalty_points_customer',
    columns: 'customer_id',
  });

  // loyalty_points - tenant + customer composite
  await createIndexIfMissing(knex, {
    table: 'loyalty_points',
    index: 'idx_loyalty_points_tenant_customer',
    columns: 'tenant_id, customer_id',
  });

  // loyalty_transactions - customer + time
  await createIndexIfMissing(knex, {
    table: 'loyalty_transactions',
    index: 'idx_loyalty_tx_customer_created',
    columns: 'customer_id, created_at',
  });

  // loyalty_transactions - tenant lookup
  await createIndexIfMissing(knex, {
    table: 'loyalty_transactions',
    index: 'idx_loyalty_tx_tenant',
    columns: 'tenant_id',
  });

  // loyalty_transactions - order lookup
  await createIndexIfMissing(knex, {
    table: 'loyalty_transactions',
    index: 'idx_loyalty_tx_order',
    columns: 'order_id',
  });

  // ============================================================================
  // STAFF & AUTH
  // ============================================================================

  // staff - status for active staff counts
  await createIndexIfMissing(knex, {
    table: 'staff',
    index: 'idx_staff_status',
    columns: 'status',
  });

  // staff - tenant + status composite (common query)
  await createIndexIfMissing(knex, {
    table: 'staff',
    index: 'idx_staff_tenant_status',
    columns: 'tenant_id, status',
  });

  // staff - code lookup (for PIN login)
  await createIndexIfMissing(knex, {
    table: 'staff',
    index: 'idx_staff_code',
    columns: 'code',
  });

  // staff - role lookup
  await createIndexIfMissing(knex, {
    table: 'staff',
    index: 'idx_staff_role',
    columns: 'role_id',
  });

  // refresh_tokens - token hash lookup
  await createIndexIfMissing(knex, {
    table: 'refresh_tokens',
    index: 'idx_refresh_tokens_hash',
    columns: 'token_hash',
  });

  // refresh_tokens - expires_at for cleanup
  await createIndexIfMissing(knex, {
    table: 'refresh_tokens',
    index: 'idx_refresh_tokens_expires',
    columns: 'expires_at',
  });

  // roles - tenant lookup
  await createIndexIfMissing(knex, {
    table: 'roles',
    index: 'idx_roles_tenant',
    columns: 'tenant_id',
  });

  // ============================================================================
  // RESTAURANT FEATURES
  // ============================================================================

  // tables - tenant + branch for restaurant tables
  await createIndexIfMissing(knex, {
    table: 'tables',
    index: 'idx_tables_tenant_branch',
    columns: 'tenant_id, branch_id',
  });

  // tables - status for available tables
  await createIndexIfMissing(knex, {
    table: 'tables',
    index: 'idx_tables_status',
    columns: 'status',
  });

  // bookings/reservations - time-based lookups
  await createIndexIfMissing(knex, {
    table: 'bookings',
    index: 'idx_bookings_start_time',
    columns: 'start_time',
  });

  // bookings - table lookup
  await createIndexIfMissing(knex, {
    table: 'bookings',
    index: 'idx_bookings_table',
    columns: 'table_id',
  });

  // bookings - tenant + status
  await createIndexIfMissing(knex, {
    table: 'bookings',
    index: 'idx_bookings_tenant_status',
    columns: 'tenant_id, status',
  });

  // guests - table lookup
  await createIndexIfMissing(knex, {
    table: 'guests',
    index: 'idx_guests_table',
    columns: 'table_id',
  });

  // guests - tenant lookup
  await createIndexIfMissing(knex, {
    table: 'guests',
    index: 'idx_guests_tenant',
    columns: 'tenant_id',
  });

  // ============================================================================
  // PRINTING & OPERATIONS
  // ============================================================================

  // print_queue - status for pending prints
  await createIndexIfMissing(knex, {
    table: 'print_queue',
    index: 'idx_print_queue_status',
    columns: 'status',
  });

  // print_queue - tenant + status composite
  await createIndexIfMissing(knex, {
    table: 'print_queue',
    index: 'idx_print_queue_tenant_status',
    columns: 'tenant_id, status',
  });

  // print_queue - order lookup
  await createIndexIfMissing(knex, {
    table: 'print_queue',
    index: 'idx_print_queue_order',
    columns: 'order_id',
  });

  // print_queue - created_at for cleanup
  await createIndexIfMissing(knex, {
    table: 'print_queue',
    index: 'idx_print_queue_created',
    columns: 'created_at',
  });

  // pos_state - already has unique index on tenant+branch

  // ============================================================================
  // AUDIT & LOGGING
  // ============================================================================

  // audit_log - type lookups
  await createIndexIfMissing(knex, {
    table: 'audit_log',
    index: 'idx_audit_log_type',
    columns: 'type',
  });

  // audit_log - entity lookups
  await createIndexIfMissing(knex, {
    table: 'audit_log',
    index: 'idx_audit_log_entity',
    columns: 'entity_type, entity_id',
  });

  // events - tenant + type
  await createIndexIfMissing(knex, {
    table: 'events',
    index: 'idx_events_tenant_type',
    columns: 'tenant_id, type',
  });

  // void_refund_log - tenant + time
  await createIndexIfMissing(knex, {
    table: 'void_refund_log',
    index: 'idx_void_refund_tenant_occurred',
    columns: 'tenant_id, occurred_at',
  });

  // void_refund_log - order lookup
  await createIndexIfMissing(knex, {
    table: 'void_refund_log',
    index: 'idx_void_refund_order',
    columns: 'order_id',
  });

  // void_refund_log - type filtering
  await createIndexIfMissing(knex, {
    table: 'void_refund_log',
    index: 'idx_void_refund_type',
    columns: 'type',
  });

  // ============================================================================
  // BILLING & PAYMENTS (Additional to previous migration)
  // ============================================================================

  // payments - invoice lookup
  await createIndexIfMissing(knex, {
    table: 'payments',
    index: 'idx_payments_invoice',
    columns: 'invoice_id',
  });

  // payments - status for pending verifications
  await createIndexIfMissing(knex, {
    table: 'payments',
    index: 'idx_payments_status',
    columns: 'status',
  });

  // payments - method lookups
  await createIndexIfMissing(knex, {
    table: 'payments',
    index: 'idx_payments_method',
    columns: 'method',
  });

  // payments - gateway_tx_id for webhook matching
  await createIndexIfMissing(knex, {
    table: 'payments',
    index: 'idx_payments_gateway_tx',
    columns: 'gateway_tx_id',
  });

  // subscription_history - tenant + time
  await createIndexIfMissing(knex, {
    table: 'subscription_history',
    index: 'idx_sub_history_tenant_created',
    columns: 'tenant_id, created_at',
  });

  // billing_notifications - status for pending sends
  await createIndexIfMissing(knex, {
    table: 'billing_notifications',
    index: 'idx_billing_notif_status',
    columns: 'status',
  });

  // ============================================================================
  // SCHEDULING & SHIFT MANAGEMENT
  // ============================================================================

  // schedules_by_week - already has unique on tenant+branch+week_start

  // shift_logs - staff lookup
  await createIndexIfMissing(knex, {
    table: 'shift_logs',
    index: 'idx_shift_logs_staff',
    columns: 'staff_id',
  });

  // shift_logs - tenant + staff composite
  await createIndexIfMissing(knex, {
    table: 'shift_logs',
    index: 'idx_shift_logs_tenant_staff',
    columns: 'tenant_id, staff_id',
  });

  // shift_reports - staff lookup
  await createIndexIfMissing(knex, {
    table: 'shift_reports',
    index: 'idx_shift_reports_staff',
    columns: 'staff_id',
  });

  // shift_reports - status filtering
  await createIndexIfMissing(knex, {
    table: 'shift_reports',
    index: 'idx_shift_reports_status',
    columns: 'status',
  });

  // ============================================================================
  // INTEGRATIONS
  // ============================================================================

  // tenant_integrations - integration lookup
  await createIndexIfMissing(knex, {
    table: 'tenant_integrations',
    index: 'idx_tenant_integrations_integration',
    columns: 'integration_id',
  });

  // integration_events - event type
  await createIndexIfMissing(knex, {
    table: 'integration_events',
    index: 'idx_integration_events_type',
    columns: 'type',
  });

  // tenant_pos_payment_gateways - gateway lookup
  await createIndexIfMissing(knex, {
    table: 'tenant_pos_payment_gateways',
    index: 'idx_tenant_pos_pg_gateway',
    columns: 'gateway',
  });

  // ============================================================================
  // NOTIFICATIONS & MESSAGING
  // ============================================================================

  // notifications - tenant + read status
  await createIndexIfMissing(knex, {
    table: 'notifications',
    index: 'idx_notifications_tenant_read',
    columns: 'tenant_id, is_read',
  });

  // notifications - recipient lookup
  await createIndexIfMissing(knex, {
    table: 'notifications',
    index: 'idx_notifications_recipient',
    columns: 'recipient_type, recipient_id',
  });

  // notification_reads - notification lookup
  await createIndexIfMissing(knex, {
    table: 'notification_reads',
    index: 'idx_notif_reads_notification',
    columns: 'notification_id',
  });

  // ============================================================================
  // PLATFORM & ADMIN
  // ============================================================================

  // superadmins - email lookup
  await createIndexIfMissing(knex, {
    table: 'superadmins',
    index: 'idx_superadmins_email',
    columns: 'email',
  });

  // demo_requests - status for processing
  await createIndexIfMissing(knex, {
    table: 'demo_requests',
    index: 'idx_demo_requests_status',
    columns: 'status',
  });

  // support_tickets - status for open tickets
  await createIndexIfMissing(knex, {
    table: 'support_tickets',
    index: 'idx_support_tickets_status',
    columns: 'status',
  });

  // support_tickets - tenant lookup
  await createIndexIfMissing(knex, {
    table: 'support_tickets',
    index: 'idx_support_tickets_tenant',
    columns: 'tenant_id',
  });

  // support_ticket_replies - ticket lookup
  await createIndexIfMissing(knex, {
    table: 'support_ticket_replies',
    index: 'idx_ticket_replies_ticket',
    columns: 'ticket_id',
  });

  // tenant_entitlements_snapshots - tenant lookup
  await createIndexIfMissing(knex, {
    table: 'tenant_entitlements_snapshots',
    index: 'idx_tes_tenant',
    columns: 'tenant_id',
  });

  // jobs - type filtering
  await createIndexIfMissing(knex, {
    table: 'jobs',
    index: 'idx_jobs_type',
    columns: 'type',
  });

  // idempotency_keys - key lookup (already has index but ensure it exists)
  await createIndexIfMissing(knex, {
    table: 'idempotency_keys',
    index: 'idx_idempotency_keys_key',
    columns: 'key',
  });

  // password_reset_otps - code lookup
  await createIndexIfMissing(knex, {
    table: 'password_reset_otps',
    index: 'idx_password_reset_code',
    columns: 'code',
  });

  // password_reset_otps - expires_at for cleanup
  await createIndexIfMissing(knex, {
    table: 'password_reset_otps',
    index: 'idx_password_reset_expires',
    columns: 'expires_at',
  });

  console.log('[057] Comprehensive index optimization completed');
};

exports.down = async (knex) => {
  // Core POS
  await dropIndexIfExists(knex, { table: 'order_items', index: 'idx_order_items_tenant_product' });
  await dropIndexIfExists(knex, { table: 'order_items', index: 'idx_order_items_tenant_product_created' });
  await dropIndexIfExists(knex, { table: 'order_payments', index: 'idx_order_payments_status' });
  await dropIndexIfExists(knex, { table: 'order_payments', index: 'idx_order_payments_method' });
  await dropIndexIfExists(knex, { table: 'order_splits', index: 'idx_order_splits_status' });

  // Inventory
  await dropIndexIfExists(knex, { table: 'inventory_items', index: 'idx_inventory_items_category' });
  await dropIndexIfExists(knex, { table: 'inventory_items', index: 'idx_inventory_items_tenant_status' });
  await dropIndexIfExists(knex, { table: 'inventory_stock', index: 'idx_inventory_stock_item' });
  await dropIndexIfExists(knex, { table: 'inventory_stock', index: 'idx_inventory_stock_tenant_item' });
  await dropIndexIfExists(knex, { table: 'inventory_movements', index: 'idx_inventory_movements_item_created' });
  await dropIndexIfExists(knex, { table: 'purchase_orders', index: 'idx_purchase_orders_status' });
  await dropIndexIfExists(knex, { table: 'purchase_orders', index: 'idx_purchase_orders_tenant_status' });
  await dropIndexIfExists(knex, { table: 'purchase_orders', index: 'idx_purchase_orders_supplier' });
  await dropIndexIfExists(knex, { table: 'purchase_order_items', index: 'idx_poi_purchase_order' });
  await dropIndexIfExists(knex, { table: 'purchase_order_items', index: 'idx_poi_inventory_item' });
  await dropIndexIfExists(knex, { table: 'suppliers', index: 'idx_suppliers_tenant' });
  await dropIndexIfExists(knex, { table: 'suppliers', index: 'idx_suppliers_status' });

  // Menu
  await dropIndexIfExists(knex, { table: 'menu_products', index: 'idx_menu_products_category' });
  await dropIndexIfExists(knex, { table: 'menu_products', index: 'idx_menu_products_tenant_category' });
  await dropIndexIfExists(knex, { table: 'menu_products', index: 'idx_menu_products_status' });
  await dropIndexIfExists(knex, { table: 'menu_recipes', index: 'idx_menu_recipes_product' });
  await dropIndexIfExists(knex, { table: 'menu_recipes', index: 'idx_menu_recipes_tenant_product' });

  // Customers
  await dropIndexIfExists(knex, { table: 'customers', index: 'idx_customers_tenant' });
  await dropIndexIfExists(knex, { table: 'customers', index: 'idx_customers_phone' });
  await dropIndexIfExists(knex, { table: 'customers', index: 'idx_customers_tenant_phone' });
  await dropIndexIfExists(knex, { table: 'loyalty_points', index: 'idx_loyalty_points_customer' });
  await dropIndexIfExists(knex, { table: 'loyalty_points', index: 'idx_loyalty_points_tenant_customer' });
  await dropIndexIfExists(knex, { table: 'loyalty_transactions', index: 'idx_loyalty_tx_customer_created' });
  await dropIndexIfExists(knex, { table: 'loyalty_transactions', index: 'idx_loyalty_tx_tenant' });
  await dropIndexIfExists(knex, { table: 'loyalty_transactions', index: 'idx_loyalty_tx_order' });

  // Staff
  await dropIndexIfExists(knex, { table: 'staff', index: 'idx_staff_status' });
  await dropIndexIfExists(knex, { table: 'staff', index: 'idx_staff_tenant_status' });
  await dropIndexIfExists(knex, { table: 'staff', index: 'idx_staff_code' });
  await dropIndexIfExists(knex, { table: 'staff', index: 'idx_staff_role' });
  await dropIndexIfExists(knex, { table: 'refresh_tokens', index: 'idx_refresh_tokens_hash' });
  await dropIndexIfExists(knex, { table: 'refresh_tokens', index: 'idx_refresh_tokens_expires' });
  await dropIndexIfExists(knex, { table: 'roles', index: 'idx_roles_tenant' });

  // Restaurant
  await dropIndexIfExists(knex, { table: 'tables', index: 'idx_tables_tenant_branch' });
  await dropIndexIfExists(knex, { table: 'tables', index: 'idx_tables_status' });
  await dropIndexIfExists(knex, { table: 'bookings', index: 'idx_bookings_start_time' });
  await dropIndexIfExists(knex, { table: 'bookings', index: 'idx_bookings_table' });
  await dropIndexIfExists(knex, { table: 'bookings', index: 'idx_bookings_tenant_status' });
  await dropIndexIfExists(knex, { table: 'guests', index: 'idx_guests_table' });
  await dropIndexIfExists(knex, { table: 'guests', index: 'idx_guests_tenant' });

  // Print
  await dropIndexIfExists(knex, { table: 'print_queue', index: 'idx_print_queue_status' });
  await dropIndexIfExists(knex, { table: 'print_queue', index: 'idx_print_queue_tenant_status' });
  await dropIndexIfExists(knex, { table: 'print_queue', index: 'idx_print_queue_order' });
  await dropIndexIfExists(knex, { table: 'print_queue', index: 'idx_print_queue_created' });

  // Audit
  await dropIndexIfExists(knex, { table: 'audit_log', index: 'idx_audit_log_type' });
  await dropIndexIfExists(knex, { table: 'audit_log', index: 'idx_audit_log_entity' });
  await dropIndexIfExists(knex, { table: 'events', index: 'idx_events_tenant_type' });
  await dropIndexIfExists(knex, { table: 'void_refund_log', index: 'idx_void_refund_tenant_occurred' });
  await dropIndexIfExists(knex, { table: 'void_refund_log', index: 'idx_void_refund_order' });
  await dropIndexIfExists(knex, { table: 'void_refund_log', index: 'idx_void_refund_type' });

  // Billing
  await dropIndexIfExists(knex, { table: 'payments', index: 'idx_payments_invoice' });
  await dropIndexIfExists(knex, { table: 'payments', index: 'idx_payments_status' });
  await dropIndexIfExists(knex, { table: 'payments', index: 'idx_payments_method' });
  await dropIndexIfExists(knex, { table: 'payments', index: 'idx_payments_gateway_tx' });
  await dropIndexIfExists(knex, { table: 'subscription_history', index: 'idx_sub_history_tenant_created' });
  await dropIndexIfExists(knex, { table: 'billing_notifications', index: 'idx_billing_notif_status' });

  // Scheduling
  await dropIndexIfExists(knex, { table: 'shift_logs', index: 'idx_shift_logs_staff' });
  await dropIndexIfExists(knex, { table: 'shift_logs', index: 'idx_shift_logs_tenant_staff' });
  await dropIndexIfExists(knex, { table: 'shift_reports', index: 'idx_shift_reports_staff' });
  await dropIndexIfExists(knex, { table: 'shift_reports', index: 'idx_shift_reports_status' });

  // Integrations
  await dropIndexIfExists(knex, { table: 'tenant_integrations', index: 'idx_tenant_integrations_integration' });
  await dropIndexIfExists(knex, { table: 'integration_events', index: 'idx_integration_events_type' });
  await dropIndexIfExists(knex, { table: 'tenant_pos_payment_gateways', index: 'idx_tenant_pos_pg_gateway' });

  // Notifications
  await dropIndexIfExists(knex, { table: 'notifications', index: 'idx_notifications_tenant_read' });
  await dropIndexIfExists(knex, { table: 'notifications', index: 'idx_notifications_recipient' });
  await dropIndexIfExists(knex, { table: 'notification_reads', index: 'idx_notif_reads_notification' });

  // Platform
  await dropIndexIfExists(knex, { table: 'superadmins', index: 'idx_superadmins_email' });
  await dropIndexIfExists(knex, { table: 'demo_requests', index: 'idx_demo_requests_status' });
  await dropIndexIfExists(knex, { table: 'support_tickets', index: 'idx_support_tickets_status' });
  await dropIndexIfExists(knex, { table: 'support_tickets', index: 'idx_support_tickets_tenant' });
  await dropIndexIfExists(knex, { table: 'support_ticket_replies', index: 'idx_ticket_replies_ticket' });
  await dropIndexIfExists(knex, { table: 'tenant_entitlements_snapshots', index: 'idx_tes_tenant' });
  await dropIndexIfExists(knex, { table: 'jobs', index: 'idx_jobs_type' });
  await dropIndexIfExists(knex, { table: 'idempotency_keys', index: 'idx_idempotency_keys_key' });
  await dropIndexIfExists(knex, { table: 'password_reset_otps', index: 'idx_password_reset_code' });
  await dropIndexIfExists(knex, { table: 'password_reset_otps', index: 'idx_password_reset_expires' });
};
