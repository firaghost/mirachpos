# Backups (cPanel MySQL)

**Last Updated:** 2026-02-05

## Overview
Daily MySQL dumps via cron, stored in cPanel backups directory with retention.

## Backup Script
Location: `scripts/backup_mysql.sh`

### Required Env Vars
- `MYSQL_USER`
- `MYSQL_PASSWORD` (optional if using `.my.cnf`)
- `MYSQL_DATABASE`

### Optional Env Vars
- `MYSQL_HOST` (default: `localhost`)
- `MYSQL_PORT` (default: `3306`)
- `BACKUP_DIR` (default: `~/backups/mirachpos`)
- `BACKUP_RETENTION_DAYS` (default: `14`)

## cPanel Cron (Daily 2:15 AM)
```
15 2 * * * MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=... BACKUP_DIR=/home/<cpanel-user>/backups/mirachpos /bin/bash /home/<cpanel-user>/mirachpos/scripts/backup_mysql.sh >> /home/<cpanel-user>/backups/mirachpos/backup.log 2>&1
```

## Restore (Manual)
```
# Pick the newest file
ls -t /home/<cpanel-user>/backups/mirachpos/*.sql.gz | head -n 1

# Restore
zcat /home/<cpanel-user>/backups/mirachpos/<file>.sql.gz | \
  mysql -u <user> -p <database>
```

## Verification
- Confirm daily file exists in `BACKUP_DIR`
- Verify size is reasonable (not zero)
- Test restore on staging monthly

| Approach                                   | Possible? | Risk Level              | Best For                   |
| ------------------------------------------ | --------- | ----------------------- | -------------------------- |
| Browser Automation (Playwright/Puppeteer)  | Yes       | HIGH - Account bans     | Data scraping, not posting |
| Official APIs                              | Partially | LOW - Platform approved | LinkedIn, Facebook         |
| Third-party schedulers (Buffer, Hootsuite) | YES       | LOW - Designed for this | All platforms              |
| Zapier/Make integration                    | YES       | LOW                     | Automation workflows       |
