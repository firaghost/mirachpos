# Stitch Flows Buildout (Mobile)

## Goal
Implement the remaining mobile screens/flows from Stitch project `projects/7949065797857476374` in the Flutter app, keeping UI aligned with Stitch and using backend APIs (no hardcoded data).

## Project Type
Mobile (Flutter) — cross-platform (iOS + Android).

## Stitch Screens → Flutter Mapping (Initial)

### Waiter / POS Flow (mobile app core)
- Table Management Grid (screen `7111fffe9f9344eb93468ebcfa5c79d6` + `6f0ef394db1e40a28021f666f7900521`)
  - Likely Flutter mapping:
    - Existing: `WaiterFloorScreen` (`mobile/lib/src/ui/screens/waiter_floor_screen.dart`) (table grid)
    - Gap: align visuals/components to Stitch (cards, filters, actions)

- Active Order Entry (screen `0d9c1c823835479db9392498f76d448b`)
  - Existing: `OrderEntryScreen` (`mobile/lib/src/ui/screens/order_entry_screen.dart`)
  - Gap: align visuals + ensure real data (already API-based)

- Product Customization (screen `26519249304f48e7bf3a3f25776ed82a`)
  - Missing Flutter screen:
    - New: `ProductCustomizationScreen`
  - Backend dependency:
    - Need to confirm if API supports modifiers/addons/notes.
    - If not available, implement UI + capture notes locally as part of order draft (no hardcoded product options).

- Table Action Selection (screen `487dd10b0364435c80c52bca51dc7649`)
  - Existing-ish: `TableDetailScreen` (`mobile/lib/src/ui/screens/table_detail_screen.dart`)
  - Gap: align visuals and actions to Stitch.

### Payment Flow
- Select Payment Method (screen `dc8489c4f1f34e3e8525144aa7fe4e5f`)
  - Partially existing: `PaymentScreen` (currently cash-focused)
  - Gap: convert to "select method" hub screen.

- Telebirr QR Payment (screen `59fb0ca07de54a3db17b42a5a86669b6`)
  - Missing Flutter screen:
    - New: `TelebirrQrPaymentScreen`
  - Backend dependency:
    - Need API for QR initiation/status OR treat as placeholder until POS/payment endpoint exists.

- Transaction Complete (screen `a487f1ddaf604d56b7a027a1fd952805`)
  - Existing-ish: `ReceiptPreviewScreen` exists
  - Gap: decide whether to keep receipt preview as “complete” or add a dedicated success screen.

### Shift / Staff Flow
- Shift Commencement (screen `2cc023aedff243a981f5dd5cce6d4d9d`)
- Staff & Shift Control (screen `8ed11dc6340249569d175ffb1e8a6229`)
  - Likely missing for mobile app.
  - Backend dependency: need endpoints for shifts.

### Manager / Owner / Analytics (might be out-of-scope for waiter mobile)
- Secure System Login (screen `3d3500aa0c1a4afc8dd2e19ecc522f1a`)
- Owner Global Dashboard (screen `64db573e09494bf6ad170731df23b189`)
- Live Branch Operations (screen `d9ac2d29245a442ead9db974a804a693`)
- Branch Performance List (screen `215e7b68b6964b6cac7d5c40acaa0c79`)
- Daily Branch Report (screen `49ad81c2c2464a208b251bc4068d9b39`)
- Global Revenue Analytics (screen `e6e75152fefa4b6c8b45eb231a71b087`)
- Business Alerts System (screen `74549af9cf9d4cbfb6dbe733e61d680c`)
- Cash Audit & Reconciliation (screen `8a4b8d3b5cb34cb18967c981bf717670`)
- Manager Branch Command (screen `fa70b07de01945098cbbc8a651aab5ae`)
  - Risk: these require APIs not currently implemented in the Flutter app.

## Open Questions / Blockers
- Are we building **waiter-only** flows first, or also manager/owner analytics screens?
- For payments:
  - Are we implementing **cash only** now (already partially done) or wiring QR (Telebirr) now?
- For product customization:
  - Do we have backend support for modifiers/addons/notes? If not, we can implement notes-only and keep modifiers gated.

## Tasks (High-Level)
- [ ] Confirm scope (waiter-only vs include manager/owner) and payment requirements
  - Verify: you confirm priorities in chat.
- [ ] Implement missing waiter screens from Stitch (customization, payment method selection, QR, complete)
  - Verify: manual navigation through flows without crashes.
- [ ] Align existing waiter screens to Stitch visuals (floor/table/order entry/payment/receipt)
  - Verify: UI matches Stitch palette/components (light-neutral + orange accent) and no hardcoded data.
- [ ] Add/adjust tests and run verification
  - Verify: `flutter test` passes; optionally `flutter build apk --debug` succeeds.
