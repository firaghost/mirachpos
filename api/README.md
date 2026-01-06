# MirachPOS Hosted API (cPanel)

This folder is a separate Node.js API intended to be hosted on cPanel Node.js App at `https://api.mirach.com`.

## Multi-tenant (Option A)
- Frontend served on `https://<tenantSlug>.mirach.com`
- Frontend sends `X-Tenant: <tenantSlug>` on every API request

## Setup
1) Create MySQL database + user in cPanel.
2) Set environment variables in cPanel Node.js App:
   - DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
   - JWT_SECRET
   - CORS_ORIGINS
   - PROVISION_KEY
3) Run migrations (via SSH or cPanel terminal):
   - `npm install`
   - `npm run migrate`

## Manual tenant provisioning
Create a tenant (trial by default):
- POST `/admin/provision`
- Header: `X-Provision-Key: <PROVISION_KEY>`
- Body: `{ "slug": "cafe1", "name": "Cafe 1", "trialDays": 4 }`

## Trial expiry / suspension
Call daily via cPanel Cron:
- POST `/admin/cron/daily`
- Header: `X-Provision-Key: <PROVISION_KEY>`

## Notes
- Auth is currently a skeleton (password check is placeholder). Next step is bcrypt/argon2 + refresh tokens.
- Business endpoints are not implemented yet; we will port your existing routes next.
