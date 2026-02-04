# MirachPOS Security Policy

**Version:** 1.0.0  
**Effective Date:** 2026-02-04  
**Owner:** Security Team  

---

## 1. Data Classification

### Classification Levels

| Level | Description | Examples | Handling |
|-------|-------------|----------|----------|
| **Critical** | Data that could cause severe harm if exposed | Password hashes, PIN hashes, JWT secrets, payment tokens | Encrypted at rest, strict access controls, audit logging |
| **Confidential** | Sensitive business and personal data | Staff records, sales data, customer info, invoices | Encrypted at rest, role-based access |
| **Internal** | Business data not for public | System configs, audit logs, support tickets | Authentication required |
| **Public** | Approved for public release | Marketing content, API docs | No restrictions |

### What We Store (from schema)

**User Authentication:**
- `password_hash` - bcrypt hashed
- `pin_hash` - bcrypt hashed (for staff PIN login)
- `refresh_tokens.token_hash` - hashed tokens

**We DO NOT Store:**
- Raw passwords
- Full credit card numbers
- CVV codes
- Unhashed PINs

---

## 2. Authentication & Access

### JWT Implementation

**Token Structure:**
- Algorithm: HS256
- Secret: `JWT_SECRET` env var (32-byte hex minimum)
- Access token expiry: 24 hours
- Refresh token expiry: 7 days

**Security Controls:**
```javascript
// From auth.js - strict mode in production
const strict = String(process.env.STRICT_JWT_SECRET || '') === '1' || 
               String(process.env.NODE_ENV || '') === 'production';
const secret = hasConfiguredSecret ? config.jwtSecret : strict ? '' : 'dev-secret';
```

**Rate Limiting on Auth:**
- 5 login attempts per 15 minutes per IP
- Skip successful requests from limit

### Role-Based Access Control (RBAC)

**Roles (from database):**
| Role | Scope | Typical Permissions |
|------|-------|---------------------|
| `Cafe Owner` | Tenant-wide | Full access |
| `Manager` | Branch or Tenant | orders.manage, staff.manage, reports.view |
| `Cashier` | Branch | pos.operate, orders.create |
| `Waiter` | Branch | orders.create, tables.view |

**Permission System:**
Permissions stored as JSON array in `roles.permissions`:
```json
["orders.manage", "staff.manage", "settings.view"]
```

---

## 3. Rate Limiting & DDoS Protection

**Implemented Limits:**

| Endpoint | Limit | Window |
|----------|-------|--------|
| Global API | 100 req | 1 minute |
| Login | 5 attempts | 15 minutes |
| Strict ops | 10 req | 1 minute |
| Payment init | 3 attempts | 1 minute |
| Payment verify | 30 attempts | 1 minute |

**Response when limited:**
```json
{
  "error": "too_many_requests",
  "message": "Too many requests from this IP",
  "retryAfter": 60
}
```

**Security Headers (Helmet.js):**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`

---

## 4. Data Protection

### Encryption at Rest

**Database:** MySQL with transparent encryption (if enabled by host)

**Application-Level:**
- Passwords: bcrypt (10+ rounds)
- PINs: bcrypt (10+ rounds)
- API keys: Environment variables only

### Encryption in Transit

- TLS 1.2+ required
- HSTS enabled
- No HTTP allowed in production

### File Uploads

**Restrictions (Multer):**
- Max size: 10MB
- Allowed: `.jpg`, `.jpeg`, `.png`, `.pdf`, `.gif`, `.webp`
- Storage: `uploads/payment_proofs/`

---

## 5. Payment Security

### PCI-DSS Compliance

**Scope: SAQ-A (Card-not-present, fully outsourced)**

We never handle raw card data:
- Payments processed by Chapa and Telebirr
- We store only:
  - Transaction reference IDs
  - Last 4 digits (if provided)
  - Payment method type
  - Amount and status

**Webhook Security:**
- Signature verification on Chapa webhooks
- Idempotency key handling
- IP filtering (if supported by provider)

---

## 6. Incident Response

### Severity Levels

| Level | Definition | Examples | Response |
|-------|------------|----------|----------|
| **Critical** | Active breach/data exposure | DB compromised, JWT secret leaked, unauthorized admin access | Immediate - page on-call |
| **High** | Potential security incident | Suspicious login patterns, possible injection attempt | 1 hour |
| **Medium** | Policy violation | Unencrypted data found, weak password policy | 24 hours |
| **Low** | Security hygiene | Expired cert, missing header | 7 days |

### Response Procedure

**1. Detect (0-15 min)**
- Monitor logs for `security_event` type
- Alert on: `jwt_secret_missing`, `rate_limited`, `auth_token_invalid`

**2. Contain (15-60 min)**
- Revoke tokens if JWT secret compromised
- Block IPs if attack detected
- Disable affected accounts

**3. Investigate (1-4 hours)**
- Review audit logs (`audit_log` table)
- Check access patterns
- Identify data accessed

**4. Recover (4-24 hours)**
- Rotate secrets
- Patch vulnerabilities
- Restore from clean backups if needed

**5. Post-Incident (24+ hours)**
- Write incident report
- Update security measures
- Notify affected users if required

### Breach Notification

| Jurisdiction | Timeline | To Notify |
|--------------|----------|-----------|
| Ethiopia | As soon as practicable | Data Protection Authority |
| EU (GDPR) | 72 hours | Supervisory authority |
| Customers | 72 hours | If personal data affected |

---

## 7. Vulnerability Management

### Security Scanning

**Dependencies:**
```bash
npm audit
```

**Code Quality:**
- Zod validation on all inputs
- No SQL injection (Knex parameterized queries)
- No XSS (no user HTML rendered without sanitization)

### Bug Bounty

**Scope:** api.mirachpos.com, app.mirachpos.com  
**Contact:** security@mirachpos.com  
**Safe Harbor:** Yes, for good-faith research

---

## 8. Compliance

### Data Retention

| Data | Retention | Reason |
|------|-----------|--------|
| Orders | 7 years | Tax/accounting |
| Audit logs | 1 year | Security |
| Refresh tokens | Duration + 30 days | Session mgmt |
| Failed logins | 90 days | Security analysis |
| Support tickets | 3 years | Customer service |

### User Rights (GDPR/Ethiopia)

| Right | How to Exercise | Timeline |
|-------|-----------------|----------|
| Access | Email privacy@mirachpos.com | 30 days |
| Deletion | Account settings or email | 30 days |
| Portability | Email request | 30 days |
| Rectification | Update in profile | Immediate |

---

## 9. Security Checklist

### For Developers

- [ ] All inputs validated with Zod
- [ ] All DB queries use parameterized statements
- [ ] Auth middleware applied to sensitive routes
- [ ] Rate limiting configured for new endpoints
- [ ] No secrets in code (use env vars)
- [ ] Audit logging for sensitive operations

### For DevOps

- [ ] TLS certificates valid and auto-renew
- [ ] Database backups encrypted
- [ ] Server logs retained for 90 days
- [ ] SSH key-based auth only
- [ ] Firewall rules restrict DB access
- [ ] JWT_SECRET >= 32 bytes random

---

## 10. Contact

| Purpose | Email |
|---------|-------|
| Security incidents | security@mirachpos.com |
| Vulnerability reports | security@mirachpos.com |
| Privacy questions | privacy@mirachpos.com |
| Compliance | compliance@mirachpos.com |

---

*Last updated: 2026-02-04*