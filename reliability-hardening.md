# Reliability Hardening

## Goal
Implement staged reliability improvements: health+timeouts, DB retry, structured logging + SMTP alerting, and Redis-backed circuit breakers.

## Tasks
- [ ] Add request timeouts middleware and extend health checks (include DB + external gateway probes) → Verify: `/health` returns ok with db status and gateway checks
- [ ] Implement DB connection retry/backoff on startup and on first use → Verify: app retries when DB is down and recovers without crash
- [ ] Wire structured JSON logging consistently and add SMTP alerting for critical errors → Verify: error triggers email and logs include request IDs
- [ ] Add Redis-backed circuit breakers for Telebirr/Chapa outbound calls → Verify: simulated failures open breaker and return fast errors
- [ ] Update MIRACHPOS_ANALYSIS.md reliability checklist and run smoke tests → Verify: checklist updated + basic API calls succeed

## Done When
- [ ] Reliability checklist items above are completed and verified

## Notes
- Use Redis (cpanel) for shared breaker state.
- SMTP config required for alerting.
