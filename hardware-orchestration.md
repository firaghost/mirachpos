---
description: Hardware orchestration module for POS devices (registry, heartbeat health, print routing, queue monitoring)
---

# Hardware Orchestration Module

## Goals

- Provide a canonical device registry for POS hardware (printers, KDS displays, customer display, etc.).
- Track device health via heartbeat → `online` / `degraded` / `offline` with clear SLAs.
- Dispatch print jobs through a robust queue with retry + dead-letter handling.
- Route jobs to primary/fallback devices based on assignment policy and job type.
- Expose operational UIs for fleet management and print queue monitoring.

## Non-goals (for v1)

- Auto-discovery of LAN devices.
- Full remote device management (firmware updates, remote commands).

## Existing code to reuse

- `api/migrations/052_print_queue.js`, `053_print_queue_retry.js`
- `api/src/routes/pos/printQueue.js` (retry endpoint + status updates)
- Existing `sendTcp()` transport used for printing

## Data model (v1)

### 1) `pos_devices`

- `id` (pk)
- `tenant_id`, `branch_id`
- `type` enum: `printer`, `kds`, `display`, `cash_drawer`, `scanner`, `other`
- `name`
- `transport` enum: `tcp`, `usb`, `http`, `none`
- `host`, `port` (tcp)
- `capabilities_json` (supported job types, formats)
- `status_override` nullable enum: `online|degraded|offline` (manual override)
- `last_seen_at`, `last_heartbeat_at`
- `health_state` enum: `online|degraded|offline`
- `health_meta_json` (last error, latency p95, etc.)
- `created_at`, `updated_at`

Indexes:
- `(tenant_id, branch_id, type)`
- `(tenant_id, branch_id, health_state)`

### 2) `pos_device_assignments`

Assignment policy by branch + job type.

- `id` (pk)
- `tenant_id`, `branch_id`
- `job_type` enum: `receipt`, `kitchen`, `kds`, `label`, `report`, `other`
- `primary_device_id`
- `fallback_device_id` nullable
- `policy_json` (retry policy override, prefer same vendor, etc.)
- `created_at`, `updated_at`

Unique:
- `(tenant_id, branch_id, job_type)`

### 3) `pos_device_heartbeats`

Append-only heartbeat ingest for observability.

- `id` (pk)
- `tenant_id`, `branch_id`, `device_id`
- `received_at`
- `reported_state` (optional)
- `payload_json`

Indexes:
- `(tenant_id, branch_id, device_id, received_at)`

### 4) `print_queue` extensions

Reuse existing table, add:

- `job_type` (receipt/kitchen/etc.)
- `dead_lettered_at`
- `dead_letter_reason`

## Backend API (v1)

### Device CRUD

- `GET /api/pos/devices?branchId=`
- `POST /api/pos/devices`
- `PATCH /api/pos/devices/:id`
- `DELETE /api/pos/devices/:id` (soft delete recommended)

### Policy

- `GET /api/pos/device-policies?branchId=`
- `PUT /api/pos/device-policies/:jobType`

### Heartbeat

- `POST /api/pos/devices/:id/heartbeat`

### Print

- `POST /api/pos/print/jobs` (enqueue)
- `POST /api/pos/print/dispatch/next` (worker/cron endpoint)
- `GET /api/pos/print/queue?branchId=&status=` (monitor)
- `POST /api/pos/print/queue/:id/retry` (reuse existing)
- `POST /api/pos/print/queue/:id/dead-letter` (manual DL)

## Print dispatch service

- Reads next pending job.
- Resolves routing by `job_type` → assignment.
- Checks device health; if primary not usable, tries fallback.
- Performs `sendTcp` (v1) and records structured errors.

## Error taxonomy (v1)

- `print.transport.timeout`
- `print.transport.connection_refused`
- `print.device.offline`
- `print.payload.invalid`
- `print.unknown`

Each error includes:
- `code`
- `message`
- `retryable` boolean
- `category`: `transport|device|payload|unknown`

## Frontend pages (v1)

- **DeviceFleetManager**
  - list devices, health badges, last seen, edit transport, manual override
- **PrintQueueMonitor**
  - filters: pending/printed/failed/dead-letter
  - actions: retry, dead-letter, view payload/error
- **DevicePolicyEditor**
  - per job type: select primary/fallback from device list

## Tests

- **Failover**: primary offline → fallback used.
- **Retry policy**: attempts increment, next_attempt_at scheduled, moves to failed/dead-letter.
- **Dead-letter visibility**: monitor endpoint returns DL rows with reason.
