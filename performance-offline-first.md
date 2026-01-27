# Performance + Offline-First + Update UX

## Goal
Make order placement, list refresh, inventory, reports, and dashboards feel instant on web + Electron, with offline-first behavior and a clear update download/install UX.

## Tasks
- [ ] Map critical endpoints + screens (orders, inventory, reports, dashboards) → Verify: list of endpoints/screens captured
- [ ] Add timing instrumentation (API + frontend) for key fetch/post calls → Verify: timings visible in logs
- [ ] Optimize backend queries/response payloads for top endpoints → Verify: reduced response times and payload sizes
- [ ] Add frontend caching/batching/optimistic updates where safe → Verify: reduced UI latency
- [ ] Implement Electron offline-first sync + update badge/restart flow → Verify: offline mode works; update UI shown
- [ ] Validate improvements on web + Electron → Verify: user flows feel instant

## Done When
- [ ] Order placement + list refresh < 200ms perceived latency
- [ ] Inventory, reports, dashboards faster and stable
- [ ] Electron works offline and shows update download/install + restart button
