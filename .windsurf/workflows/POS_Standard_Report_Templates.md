# POS Standard Report Templates & CSV Formats

**Version**: 1.0
**Created**: January 10, 2026

---

## Overview

This document defines standard CSV export templates for the POS reporting system. These templates ensure consistent data structure, proper formatting, and easy integration with Excel/analytics tools.

---

## 1. Daily Sales Summary Report

### Purpose
Quick overview of daily sales performance across all locations

### CSV Template
```
Date,Location,Total Transactions,Total Items Sold,Gross Revenue,Discounts,Tax,Net Sales,Payment Methods,Average Check,Peak Hour,Top Product
2026-01-10,Downtown Store,245,892,$3425.50,$125.00,$285.25,$3185.25,Cash:45% Card:55%,$13.88,12 PM,Burger
2026-01-10,Mall Location,198,756,$2845.75,$95.50,$237.50,$2552.75,Cash:30% Card:70%,$14.41,1 PM,Pasta
2026-01-10,Airport,156,489,$2125.00,$50.00,$177.50,$2052.50,Card:90% Mobile:10%,$13.63,6 PM,Salad
```

### Schema
```sql
CREATE TABLE report_daily_sales (
  report_date DATE,
  location_name VARCHAR(255),
  transaction_count INT,
  items_sold INT,
  gross_revenue DECIMAL(10,2),
  discounts DECIMAL(10,2),
  tax DECIMAL(10,2),
  net_sales DECIMAL(10,2),
  payment_methods_breakdown VARCHAR(255),
  average_check_value DECIMAL(10,2),
  peak_sales_hour VARCHAR(10),
  top_selling_item VARCHAR(255)
);
```

### SQL Query for Export
```sql
SELECT
    DATE(t.created_at) as Date,
    l.location_name,
    COUNT(DISTINCT t.id) as Total_Transactions,
    SUM(oi.quantity) as Total_Items_Sold,
    SUM(oi.price * oi.quantity) as Gross_Revenue,
    SUM(COALESCE(o.discount_amount, 0)) as Discounts,
    SUM(t.tax_amount) as Tax,
    SUM((oi.price * oi.quantity) - COALESCE(o.discount_amount, 0) - COALESCE(t.tax_amount, 0)) as Net_Sales,
    STRING_AGG(DISTINCT pm.payment_method, '; ') as Payment_Methods,
    AVG((oi.price * oi.quantity)) as Average_Check,
    (SELECT EXTRACT(HOUR FROM created_at)::INT FROM transactions 
     WHERE DATE(created_at) = DATE(t.created_at) 
     GROUP BY EXTRACT(HOUR FROM created_at) 
     ORDER BY COUNT(*) DESC LIMIT 1) as Peak_Hour,
    (SELECT mi.name FROM order_items oi2 
     JOIN menu_items mi ON oi2.menu_item_id = mi.id 
     WHERE DATE(oi2.created_at) = DATE(t.created_at) 
     GROUP BY mi.name ORDER BY SUM(oi2.quantity) DESC LIMIT 1) as Top_Product
FROM transactions t
JOIN orders o ON t.order_id = o.id
JOIN order_items oi ON o.id = oi.order_id
JOIN locations l ON t.location_id = l.id
LEFT JOIN payments p ON t.payment_id = p.id
LEFT JOIN payment_methods pm ON p.payment_method_id = pm.id
WHERE DATE(t.created_at) = %1$s
GROUP BY DATE(t.created_at), l.location_name
ORDER BY l.location_name;
```

---

## 2. Hourly Sales Trend Report

### Purpose
Track sales patterns throughout the day for staffing and inventory decisions

### CSV Template
```
Date,Hour,Transactions,Items,Revenue,Average Check,Busy Level,Top Item,Customers Served
2026-01-10,06:00,5,18,$87.50,$17.50,Low,Coffee,8
2026-01-10,07:00,28,156,$892.50,$31.88,Medium,Breakfast Combo,45
2026-01-10,08:00,98,342,$1245.50,$12.71,High,Burger,156
2026-01-10,09:00,156,567,$2156.25,$13.83,Very High,Lunch Combo,234
2026-01-10,10:00,142,498,$1987.50,$14.00,High,Salad,210
```

### CSV Headers
```
Date, Hour, Transactions, Items, Revenue, Average_Check, Busy_Level, Top_Item, Customers_Served
```

### SQL Query
```sql
SELECT
    DATE(t.created_at) as Date,
    LPAD(EXTRACT(HOUR FROM t.created_at)::TEXT, 2, '0') || ':00' as Hour,
    COUNT(DISTINCT t.id) as Transactions,
    SUM(oi.quantity) as Items,
    SUM(oi.price * oi.quantity) as Revenue,
    AVG(oi.price * oi.quantity) as Average_Check,
    CASE 
        WHEN COUNT(DISTINCT t.id) < 20 THEN 'Low'
        WHEN COUNT(DISTINCT t.id) < 50 THEN 'Medium'
        WHEN COUNT(DISTINCT t.id) < 100 THEN 'High'
        ELSE 'Very High'
    END as Busy_Level,
    (SELECT mi.name FROM order_items oi2 
     WHERE EXTRACT(HOUR FROM oi2.created_at) = EXTRACT(HOUR FROM t.created_at)
     GROUP BY mi.name ORDER BY SUM(oi2.quantity) DESC LIMIT 1) as Top_Item,
    COUNT(DISTINCT t.customer_id) as Customers_Served
FROM transactions t
JOIN order_items oi ON t.order_id = oi.order_id
WHERE DATE(t.created_at) = %1$s
GROUP BY DATE(t.created_at), EXTRACT(HOUR FROM t.created_at)
ORDER BY EXTRACT(HOUR FROM t.created_at);
```

---

## 3. Product Performance Report

### Purpose
Analyze which menu items are selling well and profitability

### CSV Template
```
Product Name,Category,Units Sold,Revenue,Cost,Profit,Profit Margin %,Rank,Trend,Recommendation
Burger,Main Course,156,$892.50,$312.00,$580.50,65.1%,1,Up,Keep in menu
Fries,Sides,234,$117.00,$46.80,$70.20,60.0%,2,Up,High demand
Salad,Main Course,89,$445.00,$133.50,$311.50,70.0%,3,Stable,Consider raising price
Pasta,Main Course,45,$337.50,$112.50,$225.00,66.7%,4,Down,Promote more
Soup,Starters,23,$69.00,$20.70,$48.30,70.0%,10,Down,Low performer
```

### CSV Headers
```
Product_Name, Category, Units_Sold, Revenue, Cost, Profit, Profit_Margin_Percent, Rank, Trend, Recommendation
```

### SQL Query
```sql
SELECT
    mi.name as Product_Name,
    c.category_name as Category,
    SUM(oi.quantity) as Units_Sold,
    SUM(oi.price * oi.quantity) as Revenue,
    SUM(mi.cost_price * oi.quantity) as Cost,
    SUM((oi.price - mi.cost_price) * oi.quantity) as Profit,
    ROUND(100 * (SUM(oi.price * oi.quantity) - SUM(mi.cost_price * oi.quantity)) 
          / SUM(oi.price * oi.quantity), 1) as Profit_Margin_Percent,
    ROW_NUMBER() OVER (ORDER BY SUM(oi.quantity) DESC) as Rank,
    CASE 
        WHEN SUM(oi.quantity) > LAG(SUM(oi.quantity)) OVER (PARTITION BY mi.id ORDER BY DATE(oi.created_at)) 
            THEN 'Up'
        WHEN SUM(oi.quantity) < LAG(SUM(oi.quantity)) OVER (PARTITION BY mi.id ORDER BY DATE(oi.created_at)) 
            THEN 'Down'
        ELSE 'Stable'
    END as Trend,
    CASE
        WHEN ROUND(100 * (SUM(oi.price * oi.quantity) - SUM(mi.cost_price * oi.quantity)) 
             / SUM(oi.price * oi.quantity), 1) < 50 THEN 'Review pricing'
        WHEN SUM(oi.quantity) < 10 THEN 'Consider removing'
        WHEN SUM(oi.quantity) > 100 AND ROUND(100 * (SUM(oi.price * oi.quantity) - SUM(mi.cost_price * oi.quantity)) 
             / SUM(oi.price * oi.quantity), 1) > 70 THEN 'Promote more'
        ELSE 'Keep in menu'
    END as Recommendation
FROM order_items oi
JOIN menu_items mi ON oi.menu_item_id = mi.id
JOIN categories c ON mi.category_id = c.id
WHERE DATE(oi.created_at) BETWEEN %1$s AND %2$s
GROUP BY mi.id, mi.name, c.category_name
ORDER BY Units_Sold DESC;
```

---

## 4. Staff Performance Report

### Purpose
Track employee sales, productivity, and service metrics

### CSV Template
```
Staff Name,Position,Shift,Transactions,Total Sales,Average Sale,Items Sold,Customer Satisfaction,Tips Received,Performance Score
John Smith,Cashier,Morning,45,$678.50,$15.08,156,4.6/5,$125.00,92%
Maria Garcia,Server,Evening,38,$892.50,$23.49,134,4.8/5,$156.00,96%
James Wilson,Manager,All Day,125,$2145.75,$17.17,456,4.7/5,$245.00,94%
```

### CSV Headers
```
Staff_Name, Position, Shift, Transactions, Total_Sales, Average_Sale, Items_Sold, Customer_Satisfaction, Tips_Received, Performance_Score
```

### SQL Query
```sql
SELECT
    s.name as Staff_Name,
    s.position as Position,
    CASE 
        WHEN EXTRACT(HOUR FROM t.created_at) < 12 THEN 'Morning'
        WHEN EXTRACT(HOUR FROM t.created_at) < 18 THEN 'Afternoon'
        ELSE 'Evening'
    END as Shift,
    COUNT(DISTINCT t.id) as Transactions,
    SUM(oi.price * oi.quantity) as Total_Sales,
    AVG(oi.price * oi.quantity) as Average_Sale,
    SUM(oi.quantity) as Items_Sold,
    ROUND(AVG(COALESCE(r.rating, 4.5)), 1) as Customer_Satisfaction,
    SUM(COALESCE(t.tip_amount, 0)) as Tips_Received,
    ROUND(
        (COUNT(DISTINCT t.id)::NUMERIC / 100) * 25 +
        (SUM(oi.price * oi.quantity)::NUMERIC / 1000) * 25 +
        (AVG(COALESCE(r.rating, 4.5)) / 5.0) * 25 +
        (SUM(COALESCE(t.tip_amount, 0))::NUMERIC / 500) * 25
    , 0)::INT as Performance_Score
FROM transactions t
JOIN staff s ON t.staff_id = s.id
JOIN order_items oi ON t.order_id = oi.order_id
LEFT JOIN reviews r ON t.id = r.transaction_id
WHERE DATE(t.created_at) BETWEEN %1$s AND %2$s
GROUP BY s.id, s.name, s.position
ORDER BY Total_Sales DESC;
```

---

## 5. Inventory Movement Report

### Purpose
Track stock levels and identify slow/fast moving items

### CSV Template
```
Product,Beginning Stock,Purchases,Units Sold,Returns,Waste,Ending Stock,Stock Turnover,Days Supply,Status
Burger Buns,50,25,45,2,0,28,1.61,0.6,Good
Beef Patties,40,30,35,1,2,32,1.09,0.9,Good
Lettuce,30,20,20,0,3,27,0.74,1.4,Watch
Tomatoes,35,25,15,0,8,37,0.43,2.5,Low Turnover
Cheese,25,20,32,0,1,12,2.67,0.4,Critical - Reorder
```

### CSV Headers
```
Product, Beginning_Stock, Purchases, Units_Sold, Returns, Waste, Ending_Stock, Stock_Turnover, Days_Supply, Status
```

### SQL Query
```sql
WITH inventory_movement AS (
    SELECT
        mi.name as Product,
        i.quantity_on_hand as Beginning_Stock,
        COALESCE((SELECT SUM(quantity) FROM inventory_transactions 
                  WHERE menu_item_id = mi.id 
                  AND transaction_type = 'PURCHASE'
                  AND DATE(created_at) BETWEEN %1$s AND %2$s), 0) as Purchases,
        COALESCE(SUM(oi.quantity), 0) as Units_Sold,
        COALESCE((SELECT SUM(quantity) FROM inventory_transactions 
                  WHERE menu_item_id = mi.id 
                  AND transaction_type = 'RETURN'
                  AND DATE(created_at) BETWEEN %1$s AND %2$s), 0) as Returns,
        COALESCE((SELECT SUM(quantity) FROM inventory_transactions 
                  WHERE menu_item_id = mi.id 
                  AND transaction_type = 'WASTE'
                  AND DATE(created_at) BETWEEN %1$s AND %2$s), 0) as Waste,
        i.quantity_on_hand - COALESCE(SUM(oi.quantity), 0) as Ending_Stock
    FROM menu_items mi
    JOIN inventory i ON mi.id = i.menu_item_id
    LEFT JOIN order_items oi ON mi.id = oi.menu_item_id
        AND DATE(oi.created_at) BETWEEN %1$s AND %2$s
    GROUP BY mi.id, mi.name, i.quantity_on_hand
)
SELECT
    Product,
    Beginning_Stock,
    Purchases,
    Units_Sold,
    Returns,
    Waste,
    Ending_Stock,
    ROUND(Units_Sold::NUMERIC / NULLIF(Beginning_Stock + Purchases, 0), 2) as Stock_Turnover,
    ROUND(Ending_Stock::NUMERIC / NULLIF(Units_Sold, 0), 1) as Days_Supply,
    CASE
        WHEN Ending_Stock < 10 THEN 'Critical - Reorder'
        WHEN Units_Sold < (Beginning_Stock * 0.3) THEN 'Low Turnover'
        WHEN Units_Sold > (Beginning_Stock * 2) THEN 'Fast Moving'
        ELSE 'Good'
    END as Status
FROM inventory_movement
ORDER BY Status DESC, Units_Sold DESC;
```

---

## 6. Financial Summary Report

### Purpose
High-level P&L and financial metrics

### CSV Template
```
Period,Location,Gross Sales,Discounts,Tax,Net Sales,Cost of Goods,Gross Profit,Labor Cost,Operating Profit,Profit Margin %
Q1 2026,All Locations,$125450.00,$5250.00,$10450.00,$109750.00,$39945.00,$69805.00,$28950.00,$40855.00,37.2%
Q1 2026,Downtown,$45300.00,$1950.00,$3775.00,$39575.00,$14250.00,$25325.00,$10500.00,$14825.00,37.4%
Q1 2026,Mall,$38200.00,$1650.00,$3185.00,$33365.00,$12565.00,$20800.00,$8950.00,$11850.00,35.5%
```

### CSV Headers
```
Period, Location, Gross_Sales, Discounts, Tax, Net_Sales, Cost_of_Goods, Gross_Profit, Labor_Cost, Operating_Profit, Profit_Margin_Percent
```

### SQL Query
```sql
SELECT
    CONCAT(TO_CHAR(DATE_TRUNC('quarter', t.created_at), 'YYYY-Q1'),
           ' ', EXTRACT(YEAR FROM t.created_at)::TEXT) as Period,
    COALESCE(l.location_name, 'All Locations') as Location,
    SUM(oi.price * oi.quantity) as Gross_Sales,
    SUM(COALESCE(o.discount_amount, 0)) as Discounts,
    SUM(t.tax_amount) as Tax,
    SUM((oi.price * oi.quantity) - COALESCE(o.discount_amount, 0)) as Net_Sales,
    SUM(mi.cost_price * oi.quantity) as Cost_of_Goods,
    SUM((oi.price - mi.cost_price) * oi.quantity) as Gross_Profit,
    SUM(s.salary / (365 / COUNT(DISTINCT DATE(t.created_at)))) as Labor_Cost,
    SUM((oi.price - mi.cost_price) * oi.quantity) - SUM(s.salary / (365 / COUNT(DISTINCT DATE(t.created_at)))) as Operating_Profit,
    ROUND(100 * (SUM((oi.price - mi.cost_price) * oi.quantity) - SUM(s.salary / (365 / COUNT(DISTINCT DATE(t.created_at)))))
          / SUM(oi.price * oi.quantity), 1) as Profit_Margin_Percent
FROM transactions t
JOIN orders o ON t.order_id = o.id
JOIN order_items oi ON o.id = oi.order_id
JOIN menu_items mi ON oi.menu_item_id = mi.id
JOIN staff s ON t.staff_id = s.id
LEFT JOIN locations l ON t.location_id = l.id
WHERE DATE_TRUNC('quarter', t.created_at) = DATE_TRUNC('quarter', %1$s::DATE)
GROUP BY ROLLUP(DATE_TRUNC('quarter', t.created_at), l.location_id, l.location_name)
ORDER BY Period, Location;
```

---

## 7. Customer Analytics Report

### Purpose
Understand customer behavior, loyalty, and spending patterns

### CSV Template
```
Customer,Email,Total Visits,Total Spent,Average Check,Last Visit,Member Since,Loyalty Tier,Repeat Frequency,LTV
John Doe,john@example.com,25,$687.50,$27.50,2026-01-09,2024-03-15,Gold,$27.50/week,3.2
Jane Smith,jane@example.com,12,$425.00,$35.42,2026-01-08,2025-06-20,Silver,$35.42/week,1.8
Bob Johnson,bob@example.com,45,$1125.00,$25.00,2026-01-10,2023-12-01,Platinum,$25.00/week,4.5
```

### CSV Headers
```
Customer, Email, Total_Visits, Total_Spent, Average_Check, Last_Visit, Member_Since, Loyalty_Tier, Repeat_Frequency, LTV
```

### SQL Query
```sql
SELECT
    c.name as Customer,
    c.email,
    COUNT(DISTINCT t.id) as Total_Visits,
    SUM(oi.price * oi.quantity) as Total_Spent,
    ROUND(AVG(oi.price * oi.quantity), 2) as Average_Check,
    MAX(t.created_at)::DATE as Last_Visit,
    c.created_at::DATE as Member_Since,
    c.loyalty_tier as Loyalty_Tier,
    CONCAT(ROUND(COUNT(DISTINCT DATE(t.created_at))::NUMERIC / 
        NULLIF(DATE_PART('day', MAX(t.created_at) - c.created_at), 0), 1)::TEXT, 
           ' visits/week') as Repeat_Frequency,
    ROUND(SUM(oi.price * oi.quantity) / NULLIF(DATE_PART('day', MAX(t.created_at) - c.created_at), 0) * 365, 2) as LTV
FROM customers c
LEFT JOIN transactions t ON c.id = t.customer_id
LEFT JOIN order_items oi ON t.order_id = oi.order_id
WHERE c.is_active = true
GROUP BY c.id, c.name, c.email, c.created_at, c.loyalty_tier
HAVING COUNT(DISTINCT t.id) > 0
ORDER BY Total_Spent DESC;
```

---

## 8. Payment Method Analysis Report

### Purpose
Track payment trends and payment-related metrics

### CSV Template
```
Payment Method,Transactions,Transaction %,Total Revenue,Revenue %,Average Transaction,Declined Transactions,Decline Rate,Processing Fee
Cash,125,51%,$1875.00,48%,$15.00,0,0%,$0.00
Card,95,39%,$1705.00,44%,$17.95,3,3.1%,$52.96
Mobile Wallet,24,10%,$475.00,12%,$19.79,1,4.0%,$12.25
```

### CSV Headers
```
Payment_Method, Transactions, Transaction_Percent, Total_Revenue, Revenue_Percent, Average_Transaction, Declined_Transactions, Decline_Rate, Processing_Fee
```

### SQL Query
```sql
WITH payment_stats AS (
    SELECT
        pm.payment_method,
        COUNT(DISTINCT t.id) as Transactions,
        SUM(oi.price * oi.quantity) as Total_Revenue,
        COUNT(CASE WHEN p.status = 'failed' THEN 1 END) as Declined_Transactions
    FROM transactions t
    JOIN orders o ON t.order_id = o.id
    JOIN order_items oi ON o.id = oi.order_id
    JOIN payments p ON t.payment_id = p.id
    JOIN payment_methods pm ON p.payment_method_id = pm.id
    WHERE DATE(t.created_at) BETWEEN %1$s AND %2$s
    GROUP BY pm.payment_method
)
SELECT
    payment_method,
    Transactions,
    CONCAT(ROUND(100.0 * Transactions / SUM(Transactions) OVER (), 0)::TEXT, '%') as Transaction_Percent,
    ROUND(Total_Revenue, 2) as Total_Revenue,
    CONCAT(ROUND(100.0 * Total_Revenue / SUM(Total_Revenue) OVER (), 0)::TEXT, '%') as Revenue_Percent,
    ROUND(Total_Revenue / NULLIF(Transactions, 0), 2) as Average_Transaction,
    Declined_Transactions,
    CONCAT(ROUND(100.0 * Declined_Transactions / NULLIF(Transactions, 0), 1)::TEXT, '%') as Decline_Rate,
    ROUND(Total_Revenue * 0.025, 2) as Processing_Fee  -- Assuming 2.5% fee
FROM payment_stats
ORDER BY Total_Revenue DESC;
```

---

## CSV Generation Best Practices

### 1. Column Formatting
- **Currency**: Always use DECIMAL format with 2 decimal places
- **Percentages**: Include % symbol or separate percentage column
- **Dates**: Use ISO 8601 format (YYYY-MM-DD)
- **Times**: Use 24-hour format (HH:MM:SS)
- **Large Numbers**: Use comma separators for readability

### 2. Data Validation
- Ensure column headers match exactly
- Validate numeric fields for null handling
- Check date ranges are correct
- Verify totals sum correctly
- Validate row counts match expectations

### 3. File Naming Convention
```
{report_type}_{location}_{start_date}_{end_date}.csv
```

Examples:
- `sales_all_2026-01-01_2026-01-31.csv`
- `product_performance_downtown_2026-Q1.csv`
- `staff_performance_mall_2026-01-10.csv`

### 4. Compression
- Gzip compress files > 10 MB
- Name compressed file with `.csv.gz` extension
- Include compression info in file metadata

### 5. Error Handling
```javascript
try {
  const csvData = await generateCSV(query);
  if (csvData.rows < expectedRowCount * 0.9) {
    throw new Error('Data validation failed: Row count mismatch');
  }
  await uploadToStorage(csvData);
} catch (error) {
  await notifyAdmin(error);
  await logIncident(error);
  return { status: 'failed', error: error.message };
}
```

---

## Report Distribution

### Email Delivery
```javascript
const reportSchedule = {
  'daily_sales': '06:00 UTC', // Sent every morning
  'weekly_summary': 'Monday 08:00 UTC',
  'monthly_financial': 'First day of month 09:00 UTC'
};
```

### Self-Service Portal
- Web-based report builder
- Custom date ranges
- Filter by location, product, staff
- On-demand export
- Scheduled report delivery

### Data Warehouse Access
- Direct SQL query access for analysts
- Materialized views for common reports
- Role-based access control
- Query performance monitoring

---

## Performance Metrics

**CSV Export Performance Targets:**
- Small reports (< 1000 rows): < 5 seconds
- Medium reports (1000-100k rows): < 30 seconds
- Large reports (100k-1M rows): < 2 minutes
- Very large reports (> 1M rows): Async processing required

**Query Performance Targets:**
- Dimension table queries: < 100ms
- Fact table queries: < 500ms
- Complex aggregations: < 2000ms

---

## Maintenance Schedule

- **Daily**: Monitor report generation times
- **Weekly**: Validate data quality in warehouse
- **Monthly**: Archive old reports, review usage patterns
- **Quarterly**: Optimize slow-running queries
- **Annually**: Review and update report templates

---

This comprehensive set of report templates provides the foundation for your POS analytics and reporting system.

