# MirachPOS Service Level Agreement (SLA)

**Version:** 1.0.0  
**Effective Date:** 2026-02-04  
**Applies To:** Growth and Pro Customers  

---

## 1. Service Tiers

| Plan | Price (ETB/month) | Branches | Staff | SLA Applies |
|------|-------------------|----------|-------|-------------|
| Trial | 0 | 1 | 5 | No |
| Starter | 1,500 | 1 | 25 | No |
| Growth | 3,500 | 3 | 100 | Yes |
| Pro | 7,000 | Unlimited | Unlimited | Yes |

---

## 2. Uptime Commitment

| Plan | Monthly Uptime | Max Downtime |
|------|---------------|--------------|
| Growth | 99.5% | 3.6 hours |
| Pro | 99.9% | 43.8 minutes |

**Uptime Calculation:**
```
Uptime % = (Total Minutes - Downtime) / Total Minutes × 100
```

**Excluded from Downtime:**
- Scheduled maintenance (7+ days notice)
- Emergency maintenance (security patches)
- Third-party payment provider outages (Chapa/Telebirr)
- Customer's internet connection issues
- Force majeure events

---

## 3. Service Credits

If uptime falls below commitment:

| Uptime Level | Credit |
|--------------|--------|
| < 99.9% but ≥ 99.0% | 10% of monthly fee |
| < 99.0% but ≥ 95.0% | 25% of monthly fee |
| < 95.0% | 50% of monthly fee |

**Claim Process:**
1. Email billing@mirachpos.com within 30 days
2. Credits applied to next invoice
3. Max credit: 100% of monthly fee

---

## 4. Support Response Times

| Severity | Growth | Pro |
|----------|--------|-----|
| **P1 - Critical** (System down) | 4 hours | 1 hour |
| **P2 - High** (Major feature broken) | 24 hours | 4 hours |
| **P3 - Medium** (Partial issue) | 72 hours | 24 hours |
| **P4 - Low** (Questions/minor) | 5 days | 48 hours |

**Business Hours:**
- Monday-Friday: 08:00 - 18:00 EAT
- Saturday: 09:00 - 13:00 EAT
- Sunday: Closed

**Pro Plan Extended Hours:**
- Monday-Sunday: 06:00 - 22:00 EAT

---

## 5. Support Channels

| Channel | Growth | Pro |
|---------|--------|-----|
| Email (support@mirachpos.com) | ✅ | ✅ |
| In-app chat | ✅ (Business hours) | ✅ (Extended) |
| Phone support | ❌ | ✅ |
| Dedicated account manager | ❌ | ✅ |

---

## 6. Performance Commitments

| Metric | Target |
|--------|--------|
| API Response Time (p95) | < 500ms |
| Login Response | < 2 seconds |
| Order Creation | < 1 second |
| Report Generation (30 days) | < 10 seconds |
| Payment Processing | < 5 seconds |

---

## 7. Data & Backups

| Feature | Growth | Pro |
|---------|--------|-----|
| Daily backups | ✅ | ✅ |
| Backup retention | 30 days | 90 days |
| Data export (JSON/CSV) | ✅ | ✅ |
| Priority data recovery | ❌ | ✅ |

---

## 8. Maintenance Windows

**Scheduled Maintenance:**
- Frequency: Max 1 per week
- Duration: Max 4 hours
- Notice: Min 7 days
- Window: Sunday 02:00-06:00 EAT

**Emergency Maintenance:**
- For critical security patches
- Notice ASAP (may be retroactive for 0-days)
- Excluded from uptime calculation

---

## 9. Subscription Status Handling

**Trial Expired:**
- Grace period: 3 days
- Access: Read-only
- Upgrade required for full access

**Payment Past Due:**
- Grace period: 7 days
- Day 1-7: Full access with warnings
- Day 8+: Suspended (read-only)
- Day 30+: Account deletion scheduled

**From Code (subscription.js):**
```javascript
if (status === 'past_due') {
  // Grace period logic
  const graceEndsAt = new Date(sub.grace_ends_at);
  if (Date.now() < graceEndsAt) {
    // Allow access with warning
  }
}
```

---

## 10. API Limits

| Plan | Rate Limit |
|------|------------|
| Growth | 100 req/min |
| Pro | 500 req/min |

Limits enforced per IP with standard rate limit headers.

---

## 11. Escalation

If response time not met:

| Overdue By | Action |
|------------|--------|
| 50% of target | Auto-escalate to senior support |
| 100% of target | Notify support manager |
| 200% of target | Executive notification |

---

## 12. Contact

| Purpose | Email |
|---------|-------|
| Support | support@mirachpos.com |
| Billing | billing@mirachpos.com |
| SLA Claims | sla@mirachpos.com |
| Emergency (Pro only) | +251-xxx-xxxx |

---

## 13. Changes

- 30 days notice for material changes
- Continued use = acceptance
- Termination allowed without penalty for detrimental changes

---

*Last updated: 2026-02-04*