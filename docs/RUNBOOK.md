# MirachPOS Runbook

**Version:** 1.0.0  
**Last Updated:** 2026-02-04  
**For:** DevOps, Support Engineers, System Admins

---

## Severity Levels

| Level | Response | Examples |
|-------|----------|----------|
| **P1** | Immediate (< 15 min) | System down, payments failing, data loss |
| **P2** | 1 hour | Login broken, major feature unavailable |
| **P3** | 4 hours | Performance issues, partial functionality |
| **P4** | 24 hours | Minor bugs, cosmetic issues |

---

## P1 - Critical Issues

### Issue: API Server Down

**Symptoms:**
- `curl https://api.mirachpos.com/health` returns error
- All users reporting "Cannot connect"
- Uptime monitoring alerts firing

**Diagnosis:**
```bash
# Check process
ps aux | grep node

# Check logs
pm2 logs mirachpos-api
tail -f /var/log/mirachpos/api.log

# Check port binding
netstat -tlnp | grep 3001
```

**Resolution:**
```bash
# Restart via PM2
pm2 restart mirachpos-api

# Or direct restart
cd /path/to/api && npm start

# Verify
pm2 status
curl https://api.mirachpos.com/health
```

---

### Issue: Database Connection Failure

**Symptoms:**
- Health check shows `"db": "down"`
- Error: "Database connection failed"
- All DB queries timing out

**Diagnosis:**
```bash
# Check MySQL status
systemctl status mysql

# Test connection
mysql -u mirachpos_user -p -e "SELECT 1"

# Check connection limits
mysql -e "SHOW PROCESSLIST;" | wc -l
mysql -e "SHOW VARIABLES LIKE 'max_connections';"
```

**Resolution:**
```bash
# Restart MySQL
sudo systemctl restart mysql

# Kill stuck connections
mysql -e "SHOW PROCESSLIST;" | grep Sleep | awk '{print $1}' | xargs -I {} mysql -e "KILL {};"

# Increase connection limit (temporarily)
mysql -e "SET GLOBAL max_connections = 200;"
```

**Prevention:**
- Add connection pooling config to Knex
- Monitor connection count in APM

---

### Issue: JWT_SECRET Missing

**Symptoms:**
- All authenticated requests return 500
- Error: `"server_misconfigured", "JWT_SECRET is required"`
- Login attempts fail

**Diagnosis:**
```bash
# Check env var
echo $JWT_SECRET

# Check .env file
grep JWT_SECRET /path/to/api/.env
```

**Resolution:**
```bash
# Generate new secret
export JWT_SECRET=$(openssl rand -hex 32)

# Add to .env
echo "JWT_SECRET=$JWT_SECRET" >> /path/to/api/.env

# Restart API
pm2 restart mirachpos-api
```

**Impact:** All existing tokens invalidated - users must re-login.

---

### Issue: Payment Webhooks Failing

**Symptoms:**
- Payments stuck in "pending"
- Chapa/Telebirr callbacks not processed
- Orders paid but status not updated

**Diagnosis:**
```bash
# Check webhook logs
tail -f /var/log/mirachpos/api.log | grep webhook

# Verify endpoint reachable
curl -X POST https://api.mirachpos.com/api/webhooks/chapa \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

**Resolution:**
```bash
# Check webhook signature verification
grep -i "signature" /path/to/api/src/routes/webhook.js

# Verify SSL certificate
openssl s_client -connect api.mirachpos.com:443

# Restart if needed
pm2 restart mirachpos-api
```

**Manual Fix:**
Force update order status via database:
```sql
UPDATE orders SET status = 'Paid', paid_at = NOW() WHERE id = 'ord_xxx';
```

---

## P2 - High Issues

### Issue: Rate Limiting Legitimate Users

**Symptoms:**
- Users getting `429 Too Many Requests`
- Normal usage triggering limits
- `error: "too_many_login_attempts"`

**Diagnosis:**
```bash
# Check rate limit hits in logs
grep "rate_limited" /var/log/mirachpos/api.log

# Check IP distribution
awk '/rate_limited/ {print $NF}' /var/log/mirachpos/api.log | sort | uniq -c | sort -rn
```

**Resolution:**
If behind CDN/proxy, fix IP detection:
```javascript
// In rateLimiter.js, ensure this works with your proxy
const getClientIp = (req, res) => {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.ip;
};
```

Temporary whitelist:
```bash
# Add IP to whitelist in nginx
iptables -I INPUT -s <IP> -j ACCEPT
```

---

### Issue: Email Not Sending

**Symptoms:**
- Password reset emails not delivered
- "Failed to send email" errors
- Nodemailer connection errors

**Diagnosis:**
```bash
# Test SMTP connection
curl -v telnet://smtp.gmail.com:587

# Check email config
grep -E "MAIL_|CONTACT_" /path/to/api/.env

# Check logs
grep -i "email\|nodemailer\|smtp" /var/log/mirachpos/api.log
```

**Common Causes:**
| Issue | Fix |
|-------|-----|
| cPanel port 587 blocked | Use port 465 with `MAIL_SECURE=true` |
| Authentication failed | Regenerate email password/app password |
| Rate limited | Wait 1 hour; check cPanel email limits |
| SPF/DKIM missing | Add DNS records |

**Test:**
```bash
cd /path/to/api
node -e "
const { createMailTransporter } = require('./src/utils/mail');
const transporter = createMailTransporter();
transporter.sendMail({
  to: 'test@example.com',
  subject: 'Test',
  text: 'Test email'
}).then(console.log).catch(console.error);
"
```

---

### Issue: Trial Not Enforced

**Symptoms:**
- Expired trial tenants can still use system
- `trial_ends_at` past but status still "trial"
- No subscription check middleware firing

**Diagnosis:**
```sql
-- Find expired trials still active
SELECT id, slug, trial_ends_at, status 
FROM tenants 
WHERE status = 'trial' 
  AND trial_ends_at < NOW();
```

**Resolution:**
Check subscription enforcement migration:
```bash
# Verify migration ran
knex migrate:status

# Check middleware
grep -n "subscription\|trial" /path/to/api/src/middleware/*.js
```

Manual enforcement:
```sql
-- Suspend expired trials
UPDATE tenants 
SET status = 'suspended' 
WHERE status = 'trial' 
  AND trial_ends_at < NOW();
```

---

## P3 - Medium Issues

### Issue: Slow Queries / Performance

**Symptoms:**
- API response time > 2 seconds
- MySQL CPU usage high
- `SHOW PROCESSLIST` shows long-running queries

**Diagnosis:**
```sql
-- Find slow queries
SELECT * FROM mysql.slow_log 
WHERE start_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)
ORDER BY query_time DESC;

-- Check table sizes
SELECT 
  table_name,
  ROUND(data_length / 1024 / 1024, 2) AS size_mb
FROM information_schema.tables 
WHERE table_schema = 'mirachpos'
ORDER BY data_length DESC;
```

**Common Fixes:**
```sql
-- Add indexes for common queries
CREATE INDEX idx_orders_tenant_created ON orders(tenant_id, created_at);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_staff_tenant ON staff(tenant_id);
```

**Check missing indexes:**
```sql
SELECT 
  TABLE_NAME, 
  COLUMN_NAME, 
  CARDINALITY 
FROM information_schema.STATISTICS 
WHERE TABLE_SCHEMA = 'mirachpos';
```

---

### Issue: File Upload Failures

**Symptoms:**
- "Invalid file type" errors
- Uploads directory permission errors
- 413 Payload Too Large

**Diagnosis:**
```bash
# Check uploads directory
ls -la /path/to/api/uploads/
df -h /path/to/api/uploads/

# Check permissions
stat /path/to/api/uploads/payment_proofs
```

**Resolution:**
```bash
# Fix permissions
chown -R www-data:www-data /path/to/api/uploads
chmod -R 755 /path/to/api/uploads

# Create directory if missing
mkdir -p /path/to/api/uploads/payment_proofs
```

---

### Issue: Sync Conflicts (Offline Mode)

**Symptoms:**
- Data inconsistent between devices
- "Sync conflict" errors
- Duplicate orders appearing

**Diagnosis:**
```sql
-- Check for conflicts
SELECT * FROM sync_conflicts WHERE resolved = 0;

-- Check sync cursors
SELECT tenant_id, device_id, cursor FROM sync_cursors 
ORDER BY updated_at DESC LIMIT 20;
```

**Resolution:**
Force full sync for affected device:
```sql
-- Reset cursor to force full sync
UPDATE sync_cursors 
SET cursor = '0', updated_at = NOW() 
WHERE device_id = 'device_xxx';
```

---

## P4 - Low Issues

### Issue: Certificate Expiry

**Diagnosis:**
```bash
# Check cert expiry
echo | openssl s_client -connect api.mirachpos.com:443 2>/dev/null | openssl x509 -noout -dates
```

**Resolution:**
Renew via cPanel or certbot:
```bash
# Certbot renewal
certbot renew --force-renewal

# Reload nginx
systemctl reload nginx
```

---

### Issue: Disk Space Low

**Diagnosis:**
```bash
# Check disk usage
df -h

# Find large files
find /var/log -type f -size +100M
find /path/to/api/uploads -type f -size +10M
```

**Resolution:**
```bash
# Rotate logs
logrotate -f /etc/logrotate.conf

# Clean old uploads (careful!)
find /path/to/api/uploads/payment_proofs -type f -mtime +90 -delete

# Clean temp files
rm -rf /tmp/mirachpos-*
```

---

## Diagnostic Commands

### API Health Check
```bash
curl -s https://api.mirachpos.com/health | jq .
```

### Monitoring (UptimeRobot)
- API: `https://apa.mirachpos.com/health`
- Frontend: `https://mirachpos.com/`

### Log Aggregation (Better Stack / Logtail)
- Verify logs arriving in Better Stack dashboard
- Check for error spikes after deployments

### Database Health
```bash
# Connection test
mysql -e "SELECT 1"

# Table counts
mysql mirachpos -e "SELECT COUNT(*) FROM tenants;"
mysql mirachpos -e "SELECT COUNT(*) FROM staff;"
mysql mirachpos -e "SELECT COUNT(*) FROM orders WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR);"
```

### Log Analysis
```bash
# Recent errors
tail -n 1000 /var/log/mirachpos/api.log | grep ERROR

# Error frequency
awk '/ERROR/ {print $1}' /var/log/mirachpos/api.log | sort | uniq -c

# Specific endpoint errors
grep "/api/pos/orders" /var/log/mirachpos/api.log | grep -i error
```

### PM2 Management
```bash
# Status
pm2 status
pm2 monit

# Logs
pm2 logs mirachpos-api
pm2 logs mirachpos-api --lines 100

# Restart
pm2 restart mirachpos-api
pm2 reload mirachpos-api  # Zero-downtime

# Memory/CPU
pm2 show mirachpos-api
```

---

## Escalation

| Issue | Escalate To | When |
|-------|-------------|------|
| Database corruption | DBA / Senior Dev | Immediately |
| Security breach | Security Team | Immediately |
| Payment fraud | Finance + Legal | Within 1 hour |
| Provider outage (Chapa/Telebirr) | Account Manager | After confirming |
| Performance degradation | Platform Team | After diagnosis |

---

## Contact Info

| Role | Contact |
|------|---------|
| On-Call Engineer | oncall@mirachpos.com |
| Platform Lead | platform@mirachpos.com |
| Security | security@mirachpos.com |
| Chapa Support | support@chapa.co |
| Telebirr Support | support@telebirr.com |