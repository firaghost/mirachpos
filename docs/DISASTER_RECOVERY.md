# Disaster Recovery (DR) Plan

**Last Updated:** 2026-02-05

## Targets
- **RPO (data loss window):** 24 hours
- **RTO (service restore):** 4 hours

## Systems in Scope
- API server (Node/Express)
- MySQL database (cPanel shared)
- File uploads directory
- Redis (optional)

## Recovery Steps (High Level)
1. **Assess outage**
   - Check health endpoint and logs
   - Identify DB vs API vs DNS issue

2. **Restore Database**
   - Use most recent backup from `BACKUP_DIR`
   - Restore into MySQL

3. **Restore Uploads**
   - Restore uploads directory from cPanel backup snapshot

4. **Restart Services**
   - Restart Node/PM2
   - Verify health endpoint

5. **Validate**
   - Run smoke test (login, fetch orders, submit order)

## Detailed Restore Commands
```bash
# Restore database
zcat /home/<cpanel-user>/backups/mirachpos/<file>.sql.gz | \
  mysql -u <user> -p <database>

# Restart API (if PM2 used)
pm2 restart mirachpos-api
```

## DR Roles
- **Primary:** DevOps / Platform Lead
- **Secondary:** Backend Lead

## Verification Checklist
- [ ] `/health` is OK
- [ ] Login succeeds
- [ ] New order can be created
- [ ] Reports load

## Post-Incident
- Write incident summary
- Identify root cause
- Update runbook
