---
description: Operations hardening (backups, DR, runbook, monitoring, log aggregation, feature flags)
---

# Operations Hardening Plan

## Scope
- Environment: MySQL on cPanel (shared)
- Backups: Daily automated DB dumps stored in cPanel backups
- Monitoring: UptimeRobot (free) + Grafana Faro (frontend)
- Feature flags: DB-driven per-tenant
- Log aggregation: Better Stack (Logtail)

## Tasks
1. **Backups (cPanel)**
   - Add a cron-based MySQL dump script
   - Store dumps in cPanel backup directory
   - Add retention policy (e.g., 7–14 days)
   - Document restore steps

2. **Disaster Recovery (DR) Doc**
   - Define RPO/RTO targets
   - Document restore workflow and verification
   - Identify responsible roles

3. **Runbook**
   - Common issues + first-response steps
   - Database connectivity checks
   - Cache/Redis checks (if enabled)

4. **Monitoring Dashboard (Free)**
   - Choose provider (UptimeRobot / Better Stack / Grafana Cloud free)
   - Add uptime checks for API and public endpoints
   - Document alert channels

5. **Log Aggregation**
   - Choose provider and ingestion method
   - Configure log shipping (agent or HTTP)
   - Document query patterns and retention

6. **Feature Flags (DB-driven)**
   - Design table schema (tenant-scoped flags)
   - CRUD endpoints for admin/owner
   - Cache and evaluation helper
   - Document usage pattern

## Dependencies / Open Questions
- cPanel cron access confirmed (yes/no)

## Validation
- Backup job produces dump file
- Restore steps verified on staging
- Monitoring checks alert on outage
- Feature flags read/write verified
