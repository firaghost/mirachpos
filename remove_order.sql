-- Check if order exists (case insensitive, partial match)
SELECT id, display_number, status, table_id, shift_id, tenant_id, branch_id
FROM orders 
WHERE display_number LIKE '%C1A297%'
   OR display_number LIKE '%c1a297%';

-- Or search by just the number part
SELECT id, display_number, status, table_id, shift_id
FROM orders 
WHERE display_number LIKE '%1297%';

-- Check all open orders (not paid/voided/refunded) for this shift
SELECT id, display_number, status, table_id, shift_id, total
FROM orders 
WHERE status NOT IN ('Paid', 'Voided', 'Refunded')
ORDER BY created_at DESC
LIMIT 20;