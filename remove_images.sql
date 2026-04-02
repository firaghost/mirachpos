-- Remove Unsplash images from menu products
-- Run this in phpMyAdmin (XAMPP)
-- Target: tenant tnt_a0b1013cf894f_19ba90bcc40, image containing photo-1541167760496

UPDATE menu_products 
SET 
    product_json = JSON_REMOVE(product_json, '$.image'),
    updated_at = NOW()
WHERE 
    tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40'
    AND JSON_UNQUOTE(JSON_EXTRACT(product_json, '$.image')) LIKE '%photo-1541167760496-1628856ab772%';

-- Check what was updated
SELECT id, name, category, product_json 
FROM menu_products 
WHERE tenant_id = 'tnt_a0b1013cf894f_19ba90bcc40'
  AND JSON_UNQUOTE(JSON_EXTRACT(product_json, '$.image')) LIKE '%photo-1541167760496-1628856ab772%';
