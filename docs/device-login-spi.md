# Keycloak device login (Dashboard-only verification)

RFC 8628 device authorization with verification URLs pointing at the Dashboard. Users sign in on the Dashboard (mock auth in dev); the clearinghouse control plane provisions Keycloak users and mints user access tokens server-side. Device codes are approved via RFC 8693 token exchange (`urn:pmth:device_code:` resource). The browser never opens the Keycloak login UI.

## Flow

```text
CLI → POST device authorization (app_demo) at clearinghouse
CLI prints verification_uri_complete → http://localhost:3001/login/device?user_code=XXXX
User → Dashboard /login/device (mock sign-in if needed)
Dashboard → POST /api/clearinghouse/apps/me/users (M2M upsert)
Dashboard → POST /api/clearinghouse/apps/me/users/{id}/token (M2M mint)
Dashboard → RFC 8693 device approval (m2m_demo, subject_token=user JWT)
CLI poll → device access token (azp=app_demo)
SDK → POST /api/signer/device/exchange (M2M → signer JWT)
```

## Two clients (pymthouse pattern)

| Role | client_id | Secret? | Used for |
|------|-----------|---------|----------|
| **Public** | `app_*` (e.g. `app_demo`) | No | Device grant; `subject_token` must be issued to this client (`azp`) |
| **M2M** | `m2m_*` (e.g. `m2m_demo`) | Yes | User upsert/mint, device approval, signer audience exchange |

Link: M2M attribute `linked.public.client.id` = public `app_*` id.

## App M2M API (control plane)

Authenticated with the app’s M2M Basic credentials (`m2m_demo` for dev).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/clearinghouse/apps/me/users` | Upsert Keycloak user + DB row (`users:write` on M2M in Keycloak) |
| `POST` | `/api/clearinghouse/apps/me/users/{externalUserId}/token` | Mint user access token (`users:token`) |

Mint uses server-side resource-owner password grant against Keycloak (public client `directAccessGrantsEnabled`). Per-user passwords are stored encrypted in Postgres (`CLEARINGHOUSE_CREDENTIAL_ENCRYPTION_KEY`).

## Keycloak configuration

| Setting | Where | Purpose |
|---------|--------|---------|
| `shortVerificationUri` | Realm attribute | `verification_uri_complete` → Dashboard |
| `oauth2.device.authorization.grant.enabled` | Public `app_*` | RFC 8628 for CLI |
| `directAccessGrantsEnabled` | Public `app_*` | Server-side programmatic mint |
| `device:approve`, `users:token`, `users:write` | M2M `m2m_*` | Device approval + user APIs |

After import:

```bash
bash scripts/apply-keycloak-device-flow.sh
```

## Dashboard routes

| Route | Role |
|-------|------|
| `GET /login/device?user_code=` | Device verification UI + approve button |
| `POST /api/auth/session` | httpOnly session cookie after mock login |
| `POST /api/auth/device/approve` | Upsert, mint, `completeDeviceApproval`, JSON redirect |
| `POST /api/signer/device/exchange` | Facade for signer JWT |

## Env

| Variable | Example |
|----------|---------|
| `CLEARINGHOUSE_OIDC_ISSUER_URL` | `https://localhost:8080/realms/clearinghouse` |
| `CLEARINGHOUSE_CREDENTIAL_ENCRYPTION_KEY` | 64-char hex (control plane) |
| `CLEARINGHOUSE_M2M_CLIENT_ID` / `SECRET` | `m2m_demo` / `m2m-demo-dev-secret` |
| `DASHBOARD_DEVICE_M2M_*` | Same M2M for device approval handler |
| `LP_DASHBOARD_SESSION_SECRET` | Signs Dashboard session cookie |

## SPI module

`keycloak-spi/` — `DeviceApprovalTokenExchangeProvider`, `SignerAudienceTokenExchangeProvider`.

Build and reload Keycloak:

```bash
bash scripts/build-keycloak-spi.sh
docker compose restart keycloak
```
