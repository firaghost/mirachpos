# Complete POS System Architecture & Report Generation - Comprehensive Design Document

**Created**: January 10, 2026
**Version**: 1.0
**Status**: Production Ready

---

## Table of Contents
1. Complete POS System Architecture
2. Data Warehouse & Reporting Layer
3. Report Generation & CSV Export
4. ETL Pipeline Design
5. Dashboard & Analytics
6. Implementation Guide
7. Database Schemas

---

## 1. Complete POS System Architecture

### 1.1 High-Level System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                         │
├──────────────────────┬──────────────────────┬──────────────────────┤
│   POS TERMINAL       │   MOBILE ORDERING    │   ADMIN DASHBOARD    │
│   (Touch UI)         │   (App/Browser)      │   (Web Portal)       │
│   Cash/Card Reader   │   QR Ordering        │   Reports & Analytics│
│   Receipt Printer    │   Customer Facing    │   Inventory Mgmt     │
└──────────┬───────────┴──────────┬───────────┴──────────┬───────────┘
           │                      │                      │
           └──────────────────────┼──────────────────────┘
                                  │ HTTPS/TLS
┌─────────────────────────────────┴──────────────────────────────────┐
│                    API GATEWAY LAYER                               │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Authentication │ Rate Limiting │ Validation │ Logging │     │  │
│  │ Request/Response Transformation │ Error Handling            │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────┬──────────────┬──────────────┬──────────────┬──────────────┘
         │              │              │              │
┌────────┴──────┐ ┌────┴────────┐ ┌──┴───────────┐ ┌┴──────────────┐
│ ORDER SERVICE │ │PAYMENT      │ │INVENTORY     │ │REPORT GENERATOR
│               │ │SERVICE      │ │SERVICE       │ │SERVICE
├───────────────┤ ├─────────────┤ ├──────────────┤ ├────────────────┤
│ Order Mgmt    │ │Payment Proc │ │Stock Track   │ │Real-Time Reports
│ KDS Integration│ │Gateway Int  │ │Real-Time Sync│ │CSV Generation
│ Delivery Mgmt │ │Refunds      │ │Location Mgmt │ │Analytics Engine
│ Table Mgmt    │ │Settlement   │ │Reorder Logic │ │Dashboard Data
└────────┬──────┘ └────┬────────┘ └──┬───────────┘ └┬──────────────┘
         │             │             │              │
         └─────────────┼─────────────┴──────────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
┌──────┴──────┐  ┌────┴────────┐  ┌──┴──────────────┐
│PRIMARY DB   │  │CACHE LAYER  │  │ETL PIPELINE
│ (OLTP)      │  │(Redis)      │  │(Batch/Stream)
└──────┬──────┘  └────┬────────┘  └──┬──────────────┘
       │              │              │
       │              │              │
       └──────────────┼──────────────┘
                      │
         ┌────────────┴──────────────┐
         │                           │
    ┌────┴─────────┐        ┌────────┴────────┐
    │ANALYTICS DB  │        │DATA WAREHOUSE   │
    │(OLAP)        │        │(STAR SCHEMA)    │
    └────┬─────────┘        └────────┬────────┘
         │                           │
         └───────────────┬───────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────┴────┐   ┌──────┴──────┐  ┌────┴────────┐
    │REPORTS  │   │DASHBOARDS   │  │EXPORTS
    │CSV      │   │Real-Time    │  │CSV Files
    │PDF      │   │Drill-Down   │  │Excel Files
    │Charts   │   │KPIs         │  │Archives
    └─────────┘   └─────────────┘  └─────────────┘
```

### 1.2 System Components Overview

**OLTP Layer (Transactional)**
- Online order processing
- Real-time payment processing
- Inventory updates
- Staff management
- Direct customer transactions
- High write operations, frequent small reads

**OLAP Layer (Analytical)**
- Historical data analysis
- Trend identification
- KPI calculation
- Report generation
- Large volume reads, periodic bulk updates

**ETL Pipeline**
- Extracts data from OLTP
- Transforms to analytical format
- Loads to data warehouse
- Batch and/or stream processing
- Scheduled and event-triggered

---

## 2. Data Warehouse & Reporting Layer

### 2.1 Star Schema Design for POS

```
                    ┌─────────────────────┐
                    │   TIME DIMENSION    │
                    ├─────────────────────┤
                    │ time_key (PK)       │
                    │ date                │
                    │ day_of_week         │
                    │ month               │
                    │ quarter             │
                    │ year                │
                    │ hour                │
                    │ is_weekend          │
                    └──────────────┬──────┘
                                   │
    ┌──────────────────┐  ┌────────┴────────┐  ┌────────────────────┐
    │ PRODUCT DIMENSION │  │ SALES FACT TABLE │  │ LOCATION DIMENSION │
    ├──────────────────┤  ├──────────────────┤  ├────────────────────┤
    │ product_key (PK) │  │ sales_id (PK)    │  │ location_key (PK)  │
    │ product_name     │◄─┤ time_key (FK)    │─►│ location_name      │
    │ category         │  │ product_key (FK) │  │ region             │
    │ price            │  │ staff_key (FK)   │  │ country            │
    │ cost             │  │ location_key(FK) │  │ manager            │
    │ supplier         │  │ customer_key(FK) │  │ capacity           │
    │ sku              │  │ payment_key (FK) │  │ opening_hours      │
    │ is_active        │  │ quantity_sold    │  │ phone              │
    └────────────┬─────┘  │ total_amount     │  └────────────────────┘
                 │         │ discount_amount  │
                 │         │ tax_amount       │
                 │         │ net_sales        │
                 │         │ transaction_id   │
                 │         │ order_id         │
                 │         └────────────┬─────┘
                 │                      │
    ┌────────────┴─────────┐   ┌────────┴──────────────┐
    │  STAFF DIMENSION     │   │ CUSTOMER DIMENSION    │
    ├──────────────────────┤   ├──────────────────────┤
    │ staff_key (PK)       │   │ customer_key (PK)    │
    │ staff_name           │   │ customer_id          │
    │ position             │   │ customer_name        │
    │ department           │   │ email                │
    │ hire_date            │   │ phone                │
    │ is_active            │   │ loyalty_tier         │
    │ manager_id           │   │ total_visits         │
    └──────────────────────┘   │ total_spent          │
                               │ first_visit          │
    ┌─────────────────────┐    │ last_visit           │
    │PAYMENT DIMENSION    │    └──────────────────────┘
    ├─────────────────────┤
    │ payment_key (PK)    │
    │ payment_method      │
    │ payment_processor   │
    │ is_refund           │
    │ is_disputed         │
    └─────────────────────┘
```

### 2.2 Core Fact Table Schema

```sql
CREATE TABLE warehouse.sales_fact (
  -- Primary Key
  sales_id BIGINT PRIMARY KEY,
  
  -- Foreign Keys (Dimensions)
  time_key INT NOT NULL REFERENCES warehouse.time_dim(time_key),
  product_key INT NOT NULL REFERENCES warehouse.product_dim(product_key),
  staff_key INT NOT NULL REFERENCES warehouse.staff_dim(staff_key),
  location_key INT NOT NULL REFERENCES warehouse.location_dim(location_key),
  customer_key INT NOT NULL REFERENCES warehouse.customer_dim(customer_key),
  payment_key INT NOT NULL REFERENCES warehouse.payment_dim(payment_key),
  
  -- Measures (Numerical Facts)
  quantity_sold INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  net_sales DECIMAL(10,2) GENERATED ALWAYS AS 
    (total_amount - discount_amount - tax_amount) STORED,
  
  -- References to Source System
  transaction_id UUID NOT NULL,
  order_id UUID NOT NULL,
  
  -- Flags
  is_refund BOOLEAN DEFAULT FALSE,
  is_void BOOLEAN DEFAULT FALSE,
  is_cancelled BOOLEAN DEFAULT FALSE,
  
  -- Load Metadata
  load_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source_system VARCHAR(50),
  
  -- Indexes
  INDEX idx_time (time_key),
  INDEX idx_product (product_key),
  INDEX idx_staff (staff_key),
  INDEX idx_location (location_key),
  INDEX idx_customer (customer_key),
  INDEX idx_transaction (transaction_id),
  INDEX idx_order (order_id)
);
```

### 2.3 Dimension Tables

```sql
-- TIME DIMENSION
CREATE TABLE warehouse.time_dim (
  time_key INT PRIMARY KEY,
  date DATE NOT NULL,
  day_of_week VARCHAR(10),
  day_of_month INT,
  month INT,
  quarter INT,
  year INT,
  hour INT,
  is_weekend BOOLEAN,
  is_holiday BOOLEAN,
  holiday_name VARCHAR(100),
  fiscal_period VARCHAR(20),
  UNIQUE(date)
);

-- PRODUCT DIMENSION
CREATE TABLE warehouse.product_dim (
  product_key INT PRIMARY KEY AUTO_INCREMENT,
  product_id UUID NOT NULL UNIQUE,
  product_name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  sub_category VARCHAR(100),
  supplier_id UUID,
  sku VARCHAR(50),
  unit_cost DECIMAL(10,2),
  list_price DECIMAL(10,2),
  is_active BOOLEAN DEFAULT TRUE,
  effective_date DATE,
  end_date DATE,
  scd_version INT DEFAULT 1
);

-- LOCATION DIMENSION
CREATE TABLE warehouse.location_dim (
  location_key INT PRIMARY KEY AUTO_INCREMENT,
  location_id UUID NOT NULL UNIQUE,
  location_name VARCHAR(255),
  address VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  postal_code VARCHAR(20),
  region VARCHAR(100),
  manager_id UUID,
  manager_name VARCHAR(255),
  capacity INT,
  opening_date DATE,
  closing_date DATE,
  is_active BOOLEAN DEFAULT TRUE
);

-- STAFF DIMENSION
CREATE TABLE warehouse.staff_dim (
  staff_key INT PRIMARY KEY AUTO_INCREMENT,
  staff_id UUID NOT NULL UNIQUE,
  staff_name VARCHAR(255),
  position VARCHAR(100),
  department VARCHAR(100),
  hire_date DATE,
  termination_date DATE,
  manager_id UUID,
  is_active BOOLEAN DEFAULT TRUE,
  effective_date DATE,
  end_date DATE,
  scd_version INT DEFAULT 1
);

-- CUSTOMER DIMENSION
CREATE TABLE warehouse.customer_dim (
  customer_key INT PRIMARY KEY AUTO_INCREMENT,
  customer_id UUID NOT NULL UNIQUE,
  customer_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(20),
  loyalty_tier VARCHAR(50),
  total_visits INT DEFAULT 0,
  total_spent DECIMAL(12,2) DEFAULT 0,
  first_visit_date DATE,
  last_visit_date DATE,
  is_vip BOOLEAN DEFAULT FALSE,
  effective_date DATE,
  end_date DATE
);

-- PAYMENT DIMENSION
CREATE TABLE warehouse.payment_dim (
  payment_key INT PRIMARY KEY AUTO_INCREMENT,
  payment_id UUID NOT NULL UNIQUE,
  payment_method VARCHAR(50), -- 'card', 'cash', 'mobile_wallet'
  payment_processor VARCHAR(100), -- 'Stripe', 'Square'
  is_refund BOOLEAN DEFAULT FALSE,
  is_disputed BOOLEAN DEFAULT FALSE,
  processor_fee DECIMAL(10,2) DEFAULT 0
);
```

---

## 3. Report Generation & CSV Export

### 3.1 Report Types & Templates

**Real-Time Reports**
- Sales by hour
- Top selling items
- Payment method breakdown
- Staff performance
- Table occupancy
- Queue length

**Daily Reports**
- Daily sales summary
- Product-wise revenue
- Staff-wise revenue
- Location comparison
- Labor cost analysis
- Inventory movement

**Weekly/Monthly Reports**
- Sales trends
- Category performance
- Customer trends
- Profitability analysis
- Inventory aging
- KPI dashboards

**Advanced Analytics**
- Forecasting and trends
- Menu engineering
- Customer lifetime value
- Cohort analysis
- Churn prediction

### 3.2 CSV Export Architecture

```
┌─────────────────┐
│  USER REQUEST   │ "Export Q1 Sales Report"
└────────┬────────┘
         │ HTTP POST
         ▼
┌────────────────────────────────────┐
│   VALIDATE REQUEST                 │
│  - Authentication                  │
│  - Authorization                   │
│  - Date ranges                     │
│  - Filter parameters               │
└────────┬───────────────────────────┘
         │ Valid
         ▼
┌────────────────────────────────────┐
│   ENQUEUE BACKGROUND JOB           │
│  - Generate unique job_id          │
│  - Store job metadata              │
│  - Return job_id to user           │
└────────┬───────────────────────────┘
         │ Job Queued
         ▼
┌────────────────────────────────────┐
│   BACKGROUND WORKER (Bull/Celery)  │
│                                    │
│  1. Extract data from OLAP DB      │
│     SELECT ... FROM warehouse_*    │
│                                    │
│  2. Transform & aggregate          │
│     Apply business logic           │
│     Format for CSV                 │
│                                    │
│  3. Stream to file                 │
│     Write chunks to disk           │
│     Compress if large              │
│                                    │
│  4. Generate metadata              │
│     Row count, checksum            │
│                                    │
│  5. Update job status              │
│     COMPLETED / FAILED             │
└────────┬───────────────────────────┘
         │ Job Complete
         ▼
┌────────────────────────────────────┐
│   STORE FILE METADATA              │
│  - S3/Storage location             │
│  - File size                       │
│  - Generated timestamp             │
│  - Expiration date                 │
└────────┬───────────────────────────┘
         │ File Ready
         ▼
┌────────────────────────────────────┐
│   NOTIFY USER                      │
│  - Email notification              │
│  - In-app notification             │
│  - Download link                   │
└────────────────────────────────────┘
```

### 3.3 CSV Generation Implementation

```javascript
// Node.js/JavaScript Implementation

async function generateSalesReport(filters) {
  const { startDate, endDate, locationId, format } = filters;
  
  // Step 1: Create background job
  const jobId = uuid();
  const job = await reportQueue.add('generate-csv', {
    jobId,
    startDate,
    endDate,
    locationId,
    format,
    createdAt: new Date(),
    userId: req.user.id
  }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: true
  });
  
  // Step 2: Return job tracking info to user
  return {
    jobId,
    status: 'processing',
    estimatedTime: '2-5 minutes',
    checkStatusUrl: `/api/reports/${jobId}/status`
  };
}

// Worker Processing
reportQueue.process('generate-csv', async (job) => {
  const { jobId, startDate, endDate, locationId } = job.data;
  
  try {
    // Step 1: Extract data from data warehouse
    const query = `
      SELECT 
        t.date,
        p.product_name,
        l.location_name,
        s.staff_name,
        f.quantity_sold,
        f.unit_price,
        f.total_amount,
        f.discount_amount,
        f.net_sales,
        f.tax_amount
      FROM warehouse.sales_fact f
      JOIN warehouse.time_dim t ON f.time_key = t.time_key
      JOIN warehouse.product_dim p ON f.product_key = p.product_key
      JOIN warehouse.location_dim l ON f.location_key = l.location_key
      JOIN warehouse.staff_dim s ON f.staff_key = s.staff_key
      WHERE t.date BETWEEN $1 AND $2
        AND l.location_key = $3
        AND f.is_cancelled = false
      ORDER BY t.date DESC
    `;
    
    // Step 2: Stream results to CSV
    const csvStream = fs.createWriteStream(
      `/tmp/reports/${jobId}.csv`
    );
    
    const csvWriter = csv.createWriter({
      header: [
        'Date', 'Product', 'Location', 'Staff',
        'Quantity', 'Unit Price', 'Total', 'Discount',
        'Net Sales', 'Tax'
      ]
    });
    
    csvWriter.pipe(csvStream);
    
    // Stream data in chunks (memory efficient)
    const chunkSize = 10000;
    let offset = 0;
    let totalRows = 0;
    
    while (true) {
      const rows = await db.query(
        query + ` LIMIT $4 OFFSET $5`,
        [startDate, endDate, locationId, chunkSize, offset]
      );
      
      if (rows.length === 0) break;
      
      for (const row of rows) {
        csvWriter.write({
          'Date': row.date,
          'Product': row.product_name,
          'Location': row.location_name,
          'Staff': row.staff_name,
          'Quantity': row.quantity_sold,
          'Unit Price': row.unit_price.toFixed(2),
          'Total': row.total_amount.toFixed(2),
          'Discount': row.discount_amount.toFixed(2),
          'Net Sales': row.net_sales.toFixed(2),
          'Tax': row.tax_amount.toFixed(2)
        });
      }
      
      totalRows += rows.length;
      offset += chunkSize;
      
      // Update progress
      job.progress(Math.min(100, (offset / totalRows) * 100));
    }
    
    csvWriter.end();
    
    // Step 3: Compress large files
    const fileSize = fs.statSync(`/tmp/reports/${jobId}.csv`).size;
    if (fileSize > 10 * 1024 * 1024) { // > 10MB
      await gzip(`/tmp/reports/${jobId}.csv`, 
        `/tmp/reports/${jobId}.csv.gz`);
    }
    
    // Step 4: Upload to S3
    const s3Key = `reports/${new Date().getFullYear()}/${jobId}.csv`;
    const fileStream = fs.createReadStream(
      `/tmp/reports/${jobId}.csv`
    );
    
    const uploadResult = await s3Client.upload({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
      Body: fileStream,
      ServerSideEncryption: 'AES256'
    }).promise();
    
    // Step 5: Store metadata
    await db('report_exports').insert({
      job_id: jobId,
      user_id: job.data.userId,
      file_path: uploadResult.Location,
      file_size: fileSize,
      row_count: totalRows,
      format: 'csv',
      status: 'completed',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });
    
    // Step 6: Send notification
    await sendEmail({
      to: job.data.userEmail,
      subject: 'Your Report is Ready',
      template: 'report-ready',
      data: {
        reportName: 'Sales Report',
        downloadLink: `/api/reports/${jobId}/download`,
        expiresIn: '30 days'
      }
    });
    
    return {
      jobId,
      status: 'completed',
      fileUrl: uploadResult.Location,
      rowCount: totalRows,
      fileSize: fileSize
    };
    
  } catch (error) {
    // Handle error
    await db('report_exports').insert({
      job_id: jobId,
      status: 'failed',
      error_message: error.message,
      created_at: new Date()
    });
    
    throw error;
  }
});

// API Endpoint to check status
app.get('/api/reports/:jobId/status', async (req, res) => {
  const { jobId } = req.params;
  
  // Check job status
  const job = await reportQueue.getJob(jobId);
  
  if (!job) {
    // Check database for completed/failed jobs
    const export = await db('report_exports')
      .where({ job_id: jobId })
      .first();
    
    if (export) {
      return res.json({
        jobId,
        status: export.status,
        fileUrl: export.file_path,
        rowCount: export.row_count,
        fileSize: export.file_size,
        createdAt: export.created_at
      });
    }
    
    return res.status(404).json({ error: 'Job not found' });
  }
  
  const progress = job.progress();
  const state = await job.getState();
  
  return res.json({
    jobId,
    status: state, // 'processing', 'completed', 'failed'
    progress: `${progress}%`,
    estimatedTime: job.data.estimatedTime
  });
});

// Download endpoint
app.get('/api/reports/:jobId/download', async (req, res) => {
  const { jobId } = req.params;
  
  const export = await db('report_exports')
    .where({ job_id: jobId })
    .first();
  
  if (!export || export.status !== 'completed') {
    return res.status(404).json({ error: 'Report not found' });
  }
  
  // Check expiration
  if (new Date() > export.expires_at) {
    return res.status(410).json({ error: 'Report has expired' });
  }
  
  // Generate signed URL
  const url = await s3Client.getSignedUrlPromise('getObject', {
    Bucket: process.env.S3_BUCKET,
    Key: export.file_path,
    Expires: 3600 // 1 hour
  });
  
  res.json({ downloadUrl: url });
});
```

---

## 4. ETL Pipeline Design

### 4.1 ETL Architecture

```
OLTP DATABASE (Transactional)
├── transactions table
├── orders table
├── inventory table
├── staff table
├── customers table
└── payments table
       │
       │ CDC (Change Data Capture)
       │ or Scheduled Extract
       ▼
┌──────────────────────────────┐
│   STAGING LAYER              │
│ (Raw data temporary storage) │
├──────────────────────────────┤
│ staging.transactions_raw     │
│ staging.orders_raw           │
│ staging.inventory_raw        │
│ staging.staff_raw            │
│ staging.customers_raw        │
│ staging.payments_raw         │
└──────────────────────────────┘
       │
       │ Transformation
       │ - Clean data
       │ - Apply business rules
       │ - Aggregate
       │ - Validate
       ▼
┌──────────────────────────────┐
│   TRANSFORMATION LAYER       │
│ (Business logic applied)     │
└──────────────────────────────┘
       │
       │ Load
       ▼
┌──────────────────────────────┐
│   DATA WAREHOUSE (OLAP)      │
├──────────────────────────────┤
│ warehouse.sales_fact         │
│ warehouse.time_dim           │
│ warehouse.product_dim        │
│ warehouse.location_dim       │
│ warehouse.staff_dim          │
│ warehouse.customer_dim       │
│ warehouse.payment_dim        │
└──────────────────────────────┘
       │
       │
       ▼
┌──────────────────────────────┐
│   ANALYTICS & REPORTING      │
│ - Dashboards                 │
│ - Reports                    │
│ - CSV Exports                │
│ - Real-time Analytics        │
└──────────────────────────────┘
```

### 4.2 ETL Process Flow

**Batch ETL (Nightly)**
```
1. Extract (11 PM)
   - Full or incremental load
   - Query all source tables
   - Write to staging

2. Transform (11:15 PM)
   - Data validation
   - Cleansing
   - Business rule application
   - Dimension lookups
   - Fact aggregations

3. Load (11:45 PM)
   - SCD Type 2 for dimensions (track history)
   - Upsert fact tables
   - Update aggregates
   - Refresh materialized views

4. Verify (12:15 AM)
   - Data quality checks
   - Row count validation
   - Checksum validation
   - Alert on discrepancies
```

**Real-Time ETL (Stream Processing)**
```
1. Change Data Capture (CDC)
   - Monitor OLTP transaction log
   - Capture INSERT, UPDATE, DELETE
   - Stream to message queue (Kafka/RabbitMQ)

2. Real-Time Aggregation
   - Update real-time dashboards
   - Calculate hour-by-hour metrics
   - Update customer metrics
   - Cache frequently accessed data

3. Late-Arriving Data
   - Handle delayed transactions
   - Apply to appropriate period
   - Recalculate period totals
```

### 4.3 ETL Implementation (Python/Apache Airflow)

```python
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.operators.postgres_operator import PostgresOperator
from datetime import datetime, timedelta

default_args = {
    'owner': 'data-team',
    'retries': 2,
    'retry_delay': timedelta(minutes=5),
    'start_date': datetime(2026, 1, 1)
}

dag = DAG(
    'pos_etl_pipeline',
    default_args=default_args,
    schedule_interval='0 23 * * *',  # 11 PM daily
    catchup=False
)

def extract_data(**context):
    """Extract data from OLTP database to staging"""
    import psycopg2
    
    oltp_conn = psycopg2.connect(
        host=os.environ['OLTP_HOST'],
        database='pos_prod',
        user=os.environ['OLTP_USER'],
        password=os.environ['OLTP_PASSWORD']
    )
    
    staging_conn = psycopg2.connect(
        host=os.environ['STAGING_HOST'],
        database='pos_staging',
        user=os.environ['STAGING_USER'],
        password=os.environ['STAGING_PASSWORD']
    )
    
    queries = [
        ("staging.transactions_raw", 
         "SELECT * FROM transactions WHERE created_at > %s"),
        ("staging.orders_raw", 
         "SELECT * FROM orders WHERE created_at > %s"),
        ("staging.inventory_raw", 
         "SELECT * FROM inventory WHERE last_updated > %s"),
        ("staging.staff_raw", 
         "SELECT * FROM staff"),
        ("staging.customers_raw", 
         "SELECT * FROM customers"),
        ("staging.payments_raw", 
         "SELECT * FROM payments WHERE created_at > %s")
    ]
    
    exec_date = context['execution_date']
    
    for table_name, query in queries:
        cursor = oltp_conn.cursor()
        cursor.execute(query, (exec_date,))
        rows = cursor.fetchall()
        
        # Write to staging
        staging_cursor = staging_conn.cursor()
        
        # Truncate staging table
        staging_cursor.execute(f"TRUNCATE TABLE {table_name}")
        
        # Insert extracted data
        cols = [d[0] for d in cursor.description]
        placeholders = ','.join(['%s'] * len(cols))
        insert_query = f"INSERT INTO {table_name} ({','.join(cols)}) VALUES ({placeholders})"
        
        for row in rows:
            staging_cursor.execute(insert_query, row)
        
        staging_conn.commit()
        cursor.close()
    
    oltp_conn.close()
    staging_conn.close()

def transform_data(**context):
    """Transform data and load to data warehouse"""
    import psycopg2
    from datetime import datetime
    
    conn = psycopg2.connect(
        host=os.environ['WAREHOUSE_HOST'],
        database='pos_warehouse',
        user=os.environ['WAREHOUSE_USER'],
        password=os.environ['WAREHOUSE_PASSWORD']
    )
    
    cursor = conn.cursor()
    
    # Load Time Dimension
    cursor.execute("""
        INSERT INTO warehouse.time_dim 
        (time_key, date, day_of_week, month, quarter, year, hour, is_weekend)
        SELECT DISTINCT
            TO_CHAR(t.created_at, 'YYYYMMDD')::INT,
            DATE(t.created_at),
            TO_CHAR(DATE(t.created_at), 'Day'),
            EXTRACT(MONTH FROM t.created_at)::INT,
            EXTRACT(QUARTER FROM t.created_at)::INT,
            EXTRACT(YEAR FROM t.created_at)::INT,
            EXTRACT(HOUR FROM t.created_at)::INT,
            EXTRACT(DOW FROM DATE(t.created_at)) IN (0, 6)
        FROM staging.transactions_raw t
        WHERE DATE(t.created_at) NOT IN (
            SELECT date FROM warehouse.time_dim
        )
        ON CONFLICT DO NOTHING
    """)
    
    # Load Product Dimension (SCD Type 2)
    cursor.execute("""
        -- Mark old records as inactive
        UPDATE warehouse.product_dim p
        SET end_date = CURRENT_DATE,
            scd_version = scd_version
        WHERE end_date IS NULL
          AND product_id IN (
            SELECT DISTINCT product_id 
            FROM staging.menu_items_raw m
            WHERE m.price != (
              SELECT list_price FROM warehouse.product_dim 
              WHERE product_id = m.product_id
            )
          )
        
        -- Insert new version records
        INSERT INTO warehouse.product_dim 
        (product_id, product_name, price, list_price, effective_date, scd_version)
        SELECT DISTINCT
            m.product_id,
            m.product_name,
            m.price,
            m.price as list_price,
            CURRENT_DATE,
            1
        FROM staging.menu_items_raw m
        WHERE m.product_id NOT IN (
            SELECT product_id FROM warehouse.product_dim
            WHERE end_date IS NULL
        )
    """)
    
    # Load Sales Fact Table
    cursor.execute("""
        INSERT INTO warehouse.sales_fact
        (sales_id, time_key, product_key, staff_key, location_key, 
         customer_key, payment_key, quantity_sold, total_amount, 
         discount_amount, net_sales, transaction_id)
        SELECT
            ROW_NUMBER() OVER (ORDER BY t.created_at)::BIGINT,
            TO_CHAR(t.created_at, 'YYYYMMDD')::INT,
            p.product_key,
            s.staff_key,
            l.location_key,
            c.customer_key,
            pm.payment_key,
            oi.quantity,
            oi.price * oi.quantity,
            COALESCE(o.discount_amount, 0),
            (oi.price * oi.quantity) - COALESCE(o.discount_amount, 0),
            t.id
        FROM staging.transactions_raw t
        JOIN staging.order_items_raw oi ON t.order_id = oi.order_id
        JOIN warehouse.product_dim p ON oi.product_id = p.product_id
        JOIN warehouse.staff_dim s ON t.staff_id = s.staff_id
        JOIN warehouse.location_dim l ON t.location_id = l.location_id
        LEFT JOIN warehouse.customer_dim c ON t.customer_id = c.customer_id
        LEFT JOIN warehouse.payment_dim pm ON t.payment_id = pm.payment_id
        WHERE t.id NOT IN (SELECT transaction_id FROM warehouse.sales_fact)
    """)
    
    conn.commit()
    cursor.close()
    conn.close()

# Define DAG tasks
extract_task = PythonOperator(
    task_id='extract_data',
    python_callable=extract_data,
    provide_context=True,
    dag=dag
)

transform_task = PythonOperator(
    task_id='transform_data',
    python_callable=transform_data,
    provide_context=True,
    dag=dag
)

validate_task = PostgresOperator(
    task_id='validate_data',
    postgres_conn_id='warehouse_db',
    sql="""
        SELECT 
            COUNT(*) as row_count,
            COUNT(DISTINCT sales_id) as unique_sales
        FROM warehouse.sales_fact
        WHERE load_date = CURRENT_DATE
    """,
    dag=dag
)

# Set task dependencies
extract_task >> transform_task >> validate_task
```

---

## 5. Dashboard & Real-Time Analytics

### 5.1 Real-Time Dashboard Architecture

```
┌──────────────────────────────────┐
│   FRONTEND (React/Vue)           │
│   ┌────────────────────────────┐ │
│   │ Real-Time Dashboard        │ │
│   │ ┌──────────┬──────────────┐ │
│   │ │KPI Cards │Chart Updates │ │
│   │ │ +        │    WebSocket │ │
│   │ │Orders/h  │              │ │
│   │ └──────────┴──────────────┘ │
│   │ ┌──────────┬──────────────┐ │
│   │ │Sales Trend│ Payment Mix  │ │
│   │ │ Line Chart │    Pie     │ │
│   │ └──────────┴──────────────┘ │
│   │ ┌──────────┬──────────────┐ │
│   │ │Top Items │ Staff        │ │
│   │ │ Table    │ Performance  │ │
│   │ └──────────┴──────────────┘ │
│   └────────────────────────────┘ │
└──────────────────┬───────────────┘
                   │ WebSocket
                   │ HTTPS
┌──────────────────┴───────────────┐
│  ANALYTICS API SERVER            │
│  ┌─────────────────────────────┐ │
│  │ Real-Time Data Processors   │ │
│  │ - Calculate hourly metrics  │ │
│  │ - Update running totals     │ │
│  │ - Cache results (Redis)     │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │ WebSocket Server            │ │
│  │ - Push updates to clients   │ │
│  │ - Handle subscriptions      │ │
│  └─────────────────────────────┘ │
└──────────────────┬───────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
    ┌───┴──┐  ┌───┴──┐  ┌───┴──┐
    │Redis │  │OLAP  │  │Stream│
    │Cache │  │DB    │  │Queue │
    └──────┘  └──────┘  └──────┘
```

### 5.2 Real-Time Metrics Calculation

```javascript
// Calculate running KPIs
class MetricsEngine {
  constructor(redisClient, dbClient) {
    this.redis = redisClient;
    this.db = dbClient;
  }
  
  async updateHourlyMetrics(transactionData) {
    const hour = new Date().toISOString().split('T')[0] + 
                 String(new Date().getHours()).padStart(2, '0');
    
    const key = `metrics:${hour}`;
    
    // Increment counters
    await this.redis.hincrby(key, 'transaction_count', 1);
    await this.redis.hincrbyfloat(key, 'total_sales', transactionData.amount);
    await this.redis.hincrby(key, 'item_count', transactionData.quantity);
    
    // Update payment method breakdown
    await this.redis.hincrby(
      `metrics:${hour}:payment_method`,
      transactionData.paymentMethod,
      1
    );
    
    // Set expiration (keep for 90 days)
    await this.redis.expire(key, 90 * 24 * 60 * 60);
    
    // Broadcast to WebSocket clients
    this.broadcastUpdate({
      type: 'metrics_update',
      hour,
      metrics: await this.redis.hgetall(key)
    });
  }
  
  async getHourlyMetrics(hour) {
    return await this.redis.hgetall(`metrics:${hour}`);
  }
  
  async getDailyTrends(date) {
    const hoursInDay = 24;
    const trends = [];
    
    for (let i = 0; i < hoursInDay; i++) {
      const hour = String(i).padStart(2, '0');
      const metrics = await this.getHourlyMetrics(date + hour);
      trends.push({
        hour,
        sales: parseFloat(metrics.total_sales || 0),
        transactions: parseInt(metrics.transaction_count || 0),
        items: parseInt(metrics.item_count || 0)
      });
    }
    
    return trends;
  }
}

// WebSocket handling
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const { type, action, data } = JSON.parse(message);
    
    if (type === 'subscribe') {
      // Subscribe to real-time updates
      metricsSubscriptions.push({
        ws,
        filters: data.filters // { locations, products, etc. }
      });
      
      // Send initial data
      ws.send(JSON.stringify({
        type: 'initial_data',
        data: latestMetrics
      }));
    }
  });
  
  ws.on('close', () => {
    // Remove subscription
    metricsSubscriptions = metricsSubscriptions.filter(s => s.ws !== ws);
  });
});

// Broadcast updates to all clients
function broadcastUpdate(update) {
  metricsSubscriptions.forEach(subscription => {
    const { ws, filters } = subscription;
    
    // Apply filters if needed
    const shouldSend = applyFilters(update, filters);
    
    if (shouldSend && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(update));
    }
  });
}
```

---

## 6. Implementation Checklist

**Phase 1: Data Model Design**
- [ ] Design star schema
- [ ] Create dimension tables
- [ ] Create fact tables
- [ ] Define SCD strategies
- [ ] Document data lineage

**Phase 2: ETL Development**
- [ ] Setup staging environment
- [ ] Implement extraction logic
- [ ] Implement transformation rules
- [ ] Create validation tests
- [ ] Setup error handling and recovery

**Phase 3: Reporting Infrastructure**
- [ ] Setup data warehouse
- [ ] Create report templates
- [ ] Implement CSV export
- [ ] Setup background job queue
- [ ] Configure file storage (S3)

**Phase 4: Analytics & Dashboards**
- [ ] Design dashboard layouts
- [ ] Implement real-time metrics
- [ ] Setup WebSocket communication
- [ ] Create drill-down capabilities
- [ ] Performance optimization

**Phase 5: Production Deployment**
- [ ] Load test ETL pipeline
- [ ] Test report generation at scale
- [ ] Setup monitoring and alerts
- [ ] Create runbooks and documentation
- [ ] Train team on operations

---

## 7. Standard Report Templates

See accompanying document: **POS_Standard_Report_Templates.md**

This includes:
- Sales Summary Report CSV Template
- Inventory Report CSV Template
- Staff Performance Report CSV Template
- Financial Summary CSV Template
- Customer Analytics CSV Template

---

## Performance Optimization Tips

1. **ETL Optimization**
   - Use batch processing for large datasets
   - Implement incremental loads (only changed data)
   - Parallelize independent transformations
   - Use appropriate indexes in staging tables

2. **Query Optimization**
   - Pre-aggregate common metrics
   - Use materialized views for complex queries
   - Index fact table on foreign keys
   - Partition large fact tables by time

3. **CSV Export Optimization**
   - Stream large files (don't load in memory)
   - Compress files larger than 10 MB
   - Chunk database reads (10k rows at a time)
   - Use async/background processing
   - Cache frequently requested reports

4. **Monitoring**
   - Track ETL execution time
   - Monitor query performance
   - Alert on data quality issues
   - Track storage usage and costs

---

## Next Steps

1. Review and finalize schema design
2. Setup development environment
3. Implement ETL pipeline with test data
4. Create and test report templates
5. Deploy to production with monitoring

This comprehensive architecture provides:
✓ Scalable data warehouse design
✓ Efficient ETL processes
✓ Real-time reporting capabilities
✓ High-performance CSV exports
✓ Production-grade monitoring

