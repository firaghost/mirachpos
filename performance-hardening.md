---
description: Performance hardening plan for MirachPOS (indexes, caching, report optimization, gzip, CDN)
---

## Goal
Improve API performance and static asset delivery per checklist.

## Scope
- Add missing DB indexes based on report/lookup queries.
- Add Redis-backed cache for report endpoints (mixed cache scope).
- Optimize report queries to use pre-aggregates where possible.
- Enable gzip compression on API responses.
- Add CDN support for uploads/public assets via Cloudflare.

## Plan
1. **Indexes**
   - Identify hot queries in reports and uploads.
   - Add composite indexes via new migration (safe `IF NOT EXISTS`).
   - Verify by checking query patterns in report services.

2. **Caching (Redis, mixed scope)**
   - Introduce cache helpers (get/set + JSON + TTL).
   - Cache report endpoints (daily/hourly/products/staff/category) and settings lookups.
   - Use cache keys scoped by tenant/branch/date range.

3. **Report Query Optimization**
   - Ensure report endpoints read from pre-aggregated tables only.
   - Add guard to short-circuit empty date ranges.

4. **Gzip Compression**
   - Add `compression` middleware in API app.
   - Configure minimal thresholds for JSON payloads.

5. **CDN (Cloudflare)**
   - Add config for CDN base URL.
   - Return CDN URLs for uploads and public assets when set.

## Verification
- Run API and hit report endpoints; confirm faster responses and cache hits.
- Confirm gzip response headers for JSON routes.
- Upload image and verify CDN URL in response when configured.
- Run migration for new indexes successfully.
