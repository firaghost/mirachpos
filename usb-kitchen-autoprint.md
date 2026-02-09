# USB kitchen auto-print

## Overview
Enable printing **kitchen tickets** to a **USB printer on the Windows POS PC (Electron)**.

Requirements:
- Auto-print is **default ON**.
- Print on **order create**.
- On **order edits**, print a **changes ticket** (delta).
- **One** kitchen printer.
- If printing fails (USB disconnected/offline), **queue + retry** until success.
- Manual reprint must be available.

## Current state (as-is)
- API has `POST /api/pos/print/kitchen/:id` that builds ESC/POS payload (`makeKitchenTicketPayload`) and sends via TCP **LAN-only**.
- API already queues failed kitchen prints into `print_queue` for retry.
- UI already has `printerPrefs.autoPrintKitchenTickets` and triggers `/api/pos/print/kitchen/:id` when order is sent to kitchen.
- Electron currently exposes DB/outbox IPC only (no printer IPC).

## Proposed approach
### 1) Add USB printer support via Electron (Windows spooler)
- Add Electron IPC endpoints:
  - `mirachpos.printers.list` (optional)
  - `mirachpos.printers.printRaw` (send ESC/POS buffer to a named Windows printer)
- Implementation choices:
  - Prefer Node-based raw printing via a small library (if available/compatible) OR
  - Use Windows `print`/PowerShell/`rundll32` fallbacks only if raw printing is not possible.

### 2) Extend device model to support USB
- Devices currently have `connection: 'LAN'` and IP/port.
- Add support for `connection: 'USB'` with a `printerName` (Windows printer name) or similar identifier.
- Update Branch Settings UI validations accordingly.

### 3) Update API print endpoints to handle USB
- Modify `POST /api/pos/print/kitchen/:id`:
  - If device connection is `LAN`: current behavior.
  - If `USB`: forward print job to Electron (local POS) through a safe local channel.
- Ensure the same **queue + retry** path works for both LAN and USB.

### 4) Auto-print on create + changes on edit
- On order create (send to kitchen): print full ticket.
- On order update after being sent:
  - Compute delta lines (added qty, removed qty, changed notes)
  - Print a "CHANGES" ticket containing only deltas.
- Ensure idempotency:
  - Avoid duplicate prints on refresh/retries by storing a `kitchen_print_revision` / `last_kitchen_print_hash` in order payload or a dedicated table.

### 5) Manual print/reprint
- Add UI action on order details: `Print Kitchen Ticket` and `Print Changes Ticket` (if changes exist).

## Files likely to change
- `api/src/routes/pos.js` (kitchen print endpoint, delta ticket support)
- `api/migrations/*` (if adding table/fields for print revision or USB config)
- `screens/manager/BranchSettings.tsx` (USB device fields)
- `PosContext.tsx` and/or POS screen(s) (manual print buttons; auto-print on edit)
- `electron/main.mjs` + `electron/preload.cjs` (printer IPC)

## Verification (Definition of Done)
- Create order -> kitchen ticket prints automatically to USB printer.
- Edit order (add/remove items) -> changes ticket prints automatically.
- If printer is disconnected -> job is queued and auto-retried until it prints.
- Manual print works even when auto-print is off.
- Tests:
  - Unit: delta computation produces correct change lines.
  - Integration: print endpoint enqueues on failure and retry updates status.

## Rollback plan
- Feature flag `printerPrefs.autoPrintKitchenTickets` can disable auto-print.
- USB support can be disabled by leaving device connection as `LAN` only.
