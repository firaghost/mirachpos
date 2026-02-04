---
description: Implement waiter onboarding auth flow (email first, then PIN setup, then PIN/biometric)
---

# Goal
Implement the waiter authentication flow for the Flutter mobile app:

- First-time waiter login uses **email + password**.
- Immediately after first login, waiter must **set a PIN**.
- Subsequent logins use **PIN keypad** (and optionally biometric later).

# Current State (as of Feb 2026)
- Mobile has:
  - `ManagerLoginScreen` (email/password) -> calls `POST /api/auth/login`.
  - `PinLoginScreen` (code + PIN keypad) -> calls `POST /api/auth/login-pin`.
- Backend:
  - `loginWithEmailPassword` returns token/role/staffId/staffName but **does not return staff code**.
  - `loginWithCodePin` requires `{code, pin}` and enforces role `Waiter`.
  - PIN can be set via `PUT /api/staff/account` (auth required): `{ newPin }` (currentPin optional if no existing pin).

# Decisions
- **Minimal backend change:** extend email login response to include:
  - `staffCode` (string)
  - `hasPin` (boolean)

This allows the mobile app to:
- Save `staffCode` for later PIN logins.
- Decide whether to force PIN setup.

- **Mobile onboarding screens:**
  - Add a waiter email login screen (reuse existing manager login UI with different label).
  - Add a set-pin screen (4-digit keypad, confirm).
  - After setting PIN, navigate back to root and allow PIN login.

# Acceptance Criteria
- Waiter can login with email/password using local API in debug (`http://10.0.2.2:3001`) and see API requests hit backend logs.
- After email login (if `hasPin == false`), the app forces PIN setup.
- After PIN setup, waiter can logout and login via PIN keypad without manually entering staff code.
- Existing manager login remains unchanged.
- `flutter test` passes.

# Out of Scope (for now)
- Biometric enrollment/verification (requires platform APIs + secure enclave/keychain flow).

# Verification
- Run:
  - `flutter test`
  - Manual:
    - `npm run dev:api`
    - `flutter run -d emulator-5554 --dart-define=MIRACHPOS_TENANT=<tenant>`
    - Email login as waiter -> set PIN -> logout -> PIN login.
