# Clearinghouse Stack

Self-contained payment clearinghouse: Keycloak, control plane, Apache DMZ, remote signer, Kafka, and Postgres.

## Sibling repos

Check out these repositories next to `lpclearinghouse` (same parent directory):

| Repo | Purpose |
|------|---------|
| [builder-sdk](https://github.com/pymthouse/builder-sdk) | `@pymthouse/builder-sdk` — control plane signer/OIDC helpers |
| [go-livepeer](https://github.com/livepeer/go-livepeer) | Remote signer image (`scripts/build-remote-signer.sh`) |
| [pymthouse](https://github.com/pymthouse/pymthouse) | Default `SIGNER_DATA_DIR` keystore (`../pymthouse/data`) |
| [dashboard](https://github.com/livepeer/dashboard) | Device exchange facade (`/api/signer/device/exchange`) |

## Roles

| Role | Auth | Capabilities |
|------|------|----------------|
| **Administrator** | `CLEARINGHOUSE_ADMIN_CLIENT_ID` + secret | Register apps, issue grants, disable apps, rotate M2M secrets |
| **Application owner** | Per-app `m2m_*` client + secret | Bootstrap signer JWTs, read own balance |
| **Application user** | Public `app_*` client login / device flow | Supplies `subjectToken` to app M2M bootstrap |

## Local dev

**1. Build the remote signer image** (once; go-livepeer `mainnet,experimental` tags for Arbitrum):

```bash
cd lpclearinghouse
bash scripts/build-remote-signer.sh
```

**2. Build Keycloak SPI** (after Java changes):

```bash
bash scripts/build-keycloak-spi.sh
```

**3. Dev TLS** (self-signed DMZ cert):

```bash
bash scripts/generate-dev-tls.sh
```

**4. Start the stack:**

```bash
cp .env.example .env   # edit ETH_RPC_URL, SIGNER_DATA_DIR as needed
export CLEARINGHOUSE_ADMIN_CLIENT_SECRET=<redacted-admin-secret>
docker compose up --build -d
```

Control plane + Keycloak start without the `hot-path` profile. **Python/SDK streaming needs hot path** — without it, Apache returns **404** on `POST /sign-orchestrator-info`.

```bash
docker compose --profile hot-path up -d
```

**5. Apply device-flow realm settings** (after Keycloak is up; idempotent):

```bash
bash scripts/apply-keycloak-device-flow.sh
```

Verify:

```bash
bash scripts/verify-compose.sh
docker compose ps remote-signer
docker logs lpclearinghouse-remote-signer-1 2>&1 | tail -5
```

- DMZ: `https://127.0.0.1:8080` (TLS; use `LIVEPEER_ALLOW_INSECURE_TLS=1` in the SDK)
- Admin API: `https://localhost:8080/api/clearinghouse/admin/*` — see [docs/admin-api.md](docs/admin-api.md)
- Dev realm: `keycloak/realm-clearinghouse.json` (`demo-user` / `app_demo`)
- Production baseline: `realm-clearinghouse.base.json` via `CLEARINGHOUSE_REALM_IMPORT=realm-clearinghouse.base.json`

### Control plane (host, without Docker)

```bash
cd control-plane
pnpm install
export CLEARINGHOUSE_DATABASE_URL=postgres://signer:signer_dev_password@127.0.0.1:5432/signer
export CLEARINGHOUSE_ADMIN_CLIENT_SECRET=<redacted-admin-secret>
pnpm serve
```

## Dashboard integration

Dashboard uses M2M credentials only (no direct Postgres access):

```env
CLEARINGHOUSE_API_URL=https://localhost:8080
CLEARINGHOUSE_M2M_CLIENT_ID=m2m_...
CLEARINGHOUSE_M2M_CLIENT_SECRET=...
```

Seed on startup when `CLEARINGHOUSE_SEED_DASHBOARD_APP=true` logs the generated M2M secret once.

## Docs

- [Device login SPI](docs/device-login-spi.md)
- [Admin API](docs/admin-api.md)
