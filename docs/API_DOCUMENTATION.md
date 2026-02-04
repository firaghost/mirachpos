# MirachPOS API Documentation

**Base URL:** `https://api.mirachpos.com`  
**Version:** 0.1.0  
**Last Updated:** 2026-02-04

---

## Authentication

MirachPOS uses JWT Bearer tokens for authentication.

### Login
**POST** `/api/login` or `/api/auth/login`

**Request:**
```json
{
  "email": "owner@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr_xxx",
    "email": "owner@example.com",
    "name": "Cafe Owner",
    "role": "Cafe Owner",
    "tenantId": "ten_xxx",
    "branchId": "brn_xxx"
  }
}
```

### PIN Login (Staff)
**POST** `/api/login-pin` or `/api/auth/login-pin`

**Request:**
```json
{
  "code": "1234",
  "branchId": "brn_xxx"
}
```

### Using the Token
Include in all authenticated requests:
```
Authorization: Bearer <token>
```

---

## Rate Limits

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Global API | 100 requests | 1 minute |
| Login/Auth | 5 attempts | 15 minutes |
| Strict operations | 10 requests | 1 minute |
| Payment init | 3 attempts | 1 minute |
| Payment verify | 30 attempts | 1 minute |

Rate limit headers included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1643971200
```

---

## Error Responses

### Standard Error Format
```json
{
  "error": "validation_error",
  "message": "Invalid input data",
  "requestId": "req_abc123"
}
```

### Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `unauthorized` | 401 | Missing or invalid token |
| `forbidden` | 403 | Insufficient permissions |
| `not_found` | 404 | Resource not found |
| `validation_error` | 400 | Invalid input data |
| `conflict` | 409 | Resource conflict |
| `payment_required` | 402 | Subscription/trial expired |
| `rate_limit_exceeded` | 429 | Too many requests |
| `server_error` | 500 | Internal server error |
| `server_misconfigured` | 500 | JWT_SECRET missing |

---

## Core Endpoints

### Health Check
**GET** `/health`

```json
{
  "ok": true,
  "timestamp": "2026-02-04T12:00:00Z",
  "uptime": 12345,
  "db": "up"
}
```

---

## Auth Routes

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/login` | Email/password login | No |
| POST | `/api/auth/login` | Alternative login path | No |
| POST | `/api/login-pin` | Staff PIN login | No |
| POST | `/api/auth/refresh` | Refresh JWT token | No |
| POST | `/api/auth/logout` | Invalidate token | Yes |
| POST | `/api/auth/forgot-password` | Request password reset | No |
| POST | `/api/auth/reset-password` | Reset with OTP | No |
| GET | `/api/auth/me` | Get current user | Yes |

---

## Owner Routes (Cafe Owner)

**Base:** `/api/owner/*`  
**Required Role:** `Cafe Owner`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/owner/dashboard` | Dashboard stats |
| GET | `/api/owner/staff` | List staff |
| POST | `/api/owner/staff` | Create staff |
| PUT | `/api/owner/staff/:id` | Update staff |
| DELETE | `/api/owner/staff/:id` | Remove staff |
| GET | `/api/owner/branches` | List branches |
| POST | `/api/owner/branches` | Create branch |
| PUT | `/api/owner/branches/:id` | Update branch |
| GET | `/api/owner/settings` | Get settings |
| PUT | `/api/owner/settings` | Update settings |
| GET | `/api/owner/subscription` | Get subscription |
| POST | `/api/owner/subscription/upgrade` | Upgrade plan |
| GET | `/api/owner/invoices` | List invoices |
| GET | `/api/owner/invoices/:id` | Invoice details |
| POST | `/api/owner/invoices/:id/pay` | Pay invoice |

---

## Manager Routes

**Base:** `/api/manager/*`  
**Required Role:** `Manager` or `Cafe Owner`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/manager/dashboard` | Manager dashboard |
| GET | `/api/manager/orders` | List orders |
| GET | `/api/manager/orders/:id` | Order details |
| PUT | `/api/manager/orders/:id` | Update order |
| GET | `/api/manager/inventory` | Inventory list |
| POST | `/api/manager/inventory` | Add inventory item |
| PUT | `/api/manager/inventory/:id` | Update inventory |
| GET | `/api/manager/menu` | Menu items |
| POST | `/api/manager/menu` | Create menu item |
| PUT | `/api/manager/menu/:id` | Update menu item |
| GET | `/api/manager/reports/sales` | Sales reports |
| GET | `/api/manager/reports/staff` | Staff reports |
| GET | `/api/manager/shifts` | Shift logs |
| POST | `/api/manager/shifts/clock-in` | Clock in staff |
| POST | `/api/manager/shifts/clock-out` | Clock out staff |

---

## POS Routes (Cashier/Waiter)

**Base:** `/api/pos/*`  
**Required Roles:** `Cashier`, `Waiter`, `Manager`, `Cafe Owner`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pos/tables` | List tables |
| GET | `/api/pos/tables/:id` | Table details |
| POST | `/api/pos/orders` | Create order |
| GET | `/api/pos/orders` | List active orders |
| GET | `/api/pos/orders/:id` | Get order |
| PUT | `/api/pos/orders/:id` | Update order |
| POST | `/api/pos/orders/:id/pay` | Process payment |
| POST | `/api/pos/orders/:id/void` | Void order |
| GET | `/api/pos/menu` | Active menu |
| POST | `/api/pos/print/receipt` | Print receipt |
| POST | `/api/pos/print/kitchen` | Print kitchen ticket |

### Create Order
**POST** `/api/pos/orders`

```json
{
  "tableId": "tbl_xxx",
  "items": [
    {
      "menuItemId": "mnu_xxx",
      "quantity": 2,
      "notes": "No onions"
    }
  ],
  "discount": 10,
  "discountType": "percentage"
}
```

### Process Payment
**POST** `/api/pos/orders/:id/pay`

```json
{
  "method": "cash|telebirr|chapa|card",
  "amount": 1250.00,
  "phoneNumber": "+251911234567"
}
```

---

## Inventory Routes

**Base:** `/api/inventory/*`  
**Required Permission:** `inventory.manage`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inventory` | List items |
| POST | `/api/inventory` | Create item |
| GET | `/api/inventory/:id` | Get item |
| PUT | `/api/inventory/:id` | Update item |
| DELETE | `/api/inventory/:id` | Delete item |
| POST | `/api/inventory/:id/adjust` | Adjust stock |
| GET | `/api/inventory/low-stock` | Low stock alerts |
| GET | `/api/inventory/suppliers` | List suppliers |
| POST | `/api/inventory/suppliers` | Add supplier |

### Adjust Stock
**POST** `/api/inventory/:id/adjust`

```json
{
  "quantity": 50,
  "reason": "restock",
  "notes": "Weekly delivery"
}
```

---

## Staff Routes

**Base:** `/api/staff/*`  
**Required Permission:** `staff.manage`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/staff` | List staff |
| POST | `/api/staff` | Create staff |
| GET | `/api/staff/:id` | Get staff |
| PUT | `/api/staff/:id` | Update staff |
| DELETE | `/api/staff/:id` | Remove staff |
| GET | `/api/staff/:id/shifts` | Shift history |
| GET | `/api/staff/schedule` | Weekly schedule |
| POST | `/api/staff/schedule` | Update schedule |

---

## Subscription & Billing

**Base:** `/api/owner/subscription`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/owner/subscription` | Current subscription |
| GET | `/api/owner/addons` | Available addons |
| GET | `/api/owner/addons/subscriptions` | Active addons |
| POST | `/api/owner/addons/subscribe` | Subscribe to addon |
| GET | `/api/owner/invoices` | Invoice history |
| GET | `/api/owner/invoices/:id` | Invoice details |
| POST | `/api/owner/invoices/:id/pay` | Pay invoice |
| POST | `/api/owner/invoices/:id/upload-proof` | Upload payment proof |

---

## Public Routes (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/public/signup` | Create tenant account |
| GET | `/api/public/pos-links/:token` | Public order page |
| POST | `/api/public/pos-links/:token/initiate-chapa` | Initiate Chapa payment |
| POST | `/api/public/pos-links/:token/verify-chapa` | Verify Chapa payment |
| GET | `/p/:token` | Checkout page (HTML) |
| GET | `/r/:token` | Receipt page (HTML) |

---

## Super Admin Routes

**Base:** `/api/superadmin/*`  
**Required:** Super admin JWT

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/superadmin/login` | Super admin login |
| GET | `/api/superadmin/tenants` | List all tenants |
| GET | `/api/superadmin/tenants/:id` | Tenant details |
| PUT | `/api/superadmin/tenants/:id` | Update tenant |
| GET | `/api/superadmin/invoices` | All invoices |
| GET | `/api/superadmin/metrics` | Platform metrics |
| GET | `/api/superadmin/support-tickets` | All tickets |
| PUT | `/api/superadmin/support-tickets/:id` | Update ticket |

---

## Support Routes

**Base:** `/api/support/*`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/support/tickets` | Create ticket | Yes |
| GET | `/api/support/tickets` | List my tickets | Yes |
| GET | `/api/support/tickets/:id` | Ticket details | Yes |
| POST | `/api/support/tickets/:id/reply` | Reply to ticket | Yes |

---

## Sync Routes (Offline-First)

**Base:** `/api/sync/*`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sync/changes` | Get changes since cursor |
| POST | `/api/sync/push` | Push local changes |
| GET | `/api/sync/cursor` | Get current cursor |

### Get Changes
**GET** `/api/sync/changes?since=cursor_xxx&tables=orders,menu`

```json
{
  "cursor": "cursor_yyy",
  "changes": [
    {
      "table": "orders",
      "op": "insert",
      "data": { ... }
    }
  ]
}
```

---

## Webhooks

MirachPOS receives webhooks from payment providers:

### Chapa Webhook
**POST** `/api/webhooks/chapa`

Headers:
```
X-Chapa-Signature: <signature>
```

### Telebirr Webhook
**POST** `/api/webhooks/telebirr`

---

## Data Models

### Tenant
```json
{
  "id": "ten_xxx",
  "slug": "my-cafe",
  "name": "My Cafe",
  "status": "trial|active|suspended",
  "trialEndsAt": "2026-03-04T00:00:00Z",
  "plan": "starter|growth|pro",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

### Staff
```json
{
  "id": "usr_xxx",
  "tenantId": "ten_xxx",
  "branchId": "brn_xxx",
  "name": "Abebe Kebede",
  "email": "abebe@example.com",
  "role": "Cashier|Manager|Cafe Owner",
  "code": "1234",
  "status": "Active|On Leave|Suspended",
  "lastLoginAt": "2026-02-04T10:00:00Z"
}
```

### Order
```json
{
  "id": "ord_xxx",
  "tenantId": "ten_xxx",
  "branchId": "brn_xxx",
  "tableId": "tbl_xxx",
  "status": "Pending|Cooking|Ready|Served|Paid|Voided",
  "total": 1250.00,
  "tax": 187.50,
  "discount": 0,
  "items": [...],
  "createdAt": "2026-02-04T10:30:00Z",
  "paidAt": "2026-02-04T10:45:00Z"
}
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Secret for JWT signing |
| `PROVISION_KEY` | Yes | Key for admin routes |
| `MAIL_HOST` | Yes | SMTP host |
| `MAIL_PORT` | No | SMTP port (default: 587) |
| `MAIL_USERNAME` | Yes | SMTP username |
| `MAIL_PASSWORD` | Yes | SMTP password |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
| `APP_URL` | No | Frontend URL |
| `API_PUBLIC_URL` | No | Public API URL |

---

## SDKs

Coming soon:
- JavaScript/TypeScript SDK
- Flutter SDK
- Python SDK

---

## Support

- Email: support@mirachpos.com
- API Issues: api@mirachpos.com