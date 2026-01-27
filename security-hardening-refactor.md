# Security Hardening + Maintainability Refactor Plan

## Goals
- Improve backend security posture for cPanel-hosted API used by Vercel frontend.
- Reduce high-risk misconfiguration footguns (JWT/CORS/env).
- Improve maintainability of large/duplicated modules without changing runtime behavior.

## Scope
- Backend: `api/src/**`
- Frontend: root React app (`App.tsx`) refactor only (no UX changes)
- CI: `.github/workflows/ci.yml` (add API tests + TS typecheck)

## Milestones
1. **Backend auth hardening**
   - Remove JWT secret fallback (require `JWT_SECRET` in all envs except explicit local dev override)
   - Apply `authLimiter` to login endpoints
   - Tighten CORS defaults in production

2. **Public endpoints abuse protection**
   - Apply targeted rate limiting for signup/payment/public link flows
   - Add minimal security event logging (login failures, rate-limit triggers)

3. **Backend maintainability refactors**
   - Extract inline HTML templates from `api/src/app.js` into a module (no behavior change)
   - Centralize duplicated helpers (`safeJsonParse`, mail transporter)

4. **Production startup validation**
   - Fail fast on missing critical env vars (JWT/DB; Turnstile if signup enabled)

5. **CI hardening**
   - Run API tests in CI
   - Run TypeScript typecheck for frontend

6. **Frontend refactor (safe)**
   - Split `App.tsx` into small hooks/components (session sync, POS idle timeout, screen rendering)

## Verification
- `npm run build`
- `npm --prefix api test`
- `npx tsc -p tsconfig.json --noEmit`

## Rollback Strategy
- Each milestone should be small and revertible.
- If any production behavior changes are detected, revert that milestone only.
