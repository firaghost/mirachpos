---
description: Phase 3 — Growth (10+ Customers) execution plan
---

# Phase 3 — Growth (10+ Customers)

## Goal
Increase reliability and operational scalability for 10+ customers by improving performance, adding controlled rollouts, strengthening support tooling, formalizing automated test coverage, and separating background work from the web process.

## Milestones (recommended order)

### Milestone 1 — Automated testing pipeline (CI)
**Outcome**: Every PR/main commit runs tests and blocks regressions.

**Acceptance criteria**
- API unit/integration tests run in CI
- Frontend build/typecheck runs in CI
- Test report output is visible in CI logs

**Scope**
- Add GitHub Actions workflow(s)
- Ensure tests run deterministically with existing DB mocks

### Milestone 2 — Performance optimization (profiling + caching policy)
**Outcome**: Reports/dashboard endpoints meet baseline latency targets and stay stable as data grows.

**Acceptance criteria**
- Identify top slow endpoints/queries
- Add/adjust indexes only where measured
- Confirm caching TTLs and add cache key namespacing

**Scope**
- Measure using logs + metrics
- Tune cache TTLs and invalidation rules for reports/settings

### Milestone 3 — Feature flags (controlled rollout)
**Outcome**: Ability to roll out features per tenant/branch safely.

**Acceptance criteria**
- Server-side feature flag reads are cached
- Clear pattern for checking flags in routes/services
- Admin path to enable/disable flags exists (if not already)

### Milestone 4 — Customer support tools
**Outcome**: Faster issue investigation and response.

**Acceptance criteria**
- Stronger audit trail discovery (filters + pagination stability)
- Support-relevant diagnostics (requestId, key events, job failures)

### Milestone 5 — Worker processes (background jobs)
**Outcome**: Web server and background workers can scale independently on cPanel.

**Acceptance criteria**
- A separate worker entrypoint runs job worker + scheduler without HTTP
- Web entrypoint can disable background services via env
- Documented run commands and env vars for cPanel

## Defaults / Constraints
- cPanel shared hosting compatible
- Opt-in behavior via env vars (no breaking changes)
- Prefer smallest possible changes with test coverage
