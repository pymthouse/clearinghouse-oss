#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${ROOT}/docker-compose.yml"

export SIGNER_OIDC_METADATA_URL="${SIGNER_OIDC_METADATA_URL:-http://keycloak:8080/realms/clearinghouse/.well-known/openid-configuration}"
export SIGNER_OIDC_CLIENT_ID="${SIGNER_OIDC_CLIENT_ID:-dashboard-signer-bootstrap}"
export SIGNER_OIDC_CLIENT_SECRET="${SIGNER_OIDC_CLIENT_SECRET:-dashboard-signer-dev-secret}"
# Required by docker-compose.yml (no default); a throwaway value is fine for config rendering.
export CLEARINGHOUSE_ADMIN_CLIENT_SECRET="${CLEARINGHOUSE_ADMIN_CLIENT_SECRET:-$(openssl rand -hex 16)}"

docker compose -f "${COMPOSE_FILE}" config >/dev/null
docker compose -f "${COMPOSE_FILE}" config | grep -q "quay.io/keycloak/keycloak"
docker compose -f "${COMPOSE_FILE}" config | grep -q "clearinghouse-control-plane"
docker compose -f "${COMPOSE_FILE}" config | grep -q "realm-clearinghouse"

RENDERED="$(docker run --rm \
  -e SIGNER_OIDC_METADATA_URL \
  -e SIGNER_OIDC_CLIENT_ID \
  -e SIGNER_OIDC_CLIENT_SECRET \
  -e SIGNER_OIDC_CRYPTO_PASSPHRASE=dev-change-me \
  -v "${ROOT}/apache/httpd.conf.template:/template:ro" \
  debian:bookworm-slim \
  sh -c 'apt-get update -qq && apt-get install -y -qq gettext-base >/dev/null && envsubst < /template')"

echo "${RENDERED}" | grep -q "AuthType oauth20"
echo "${RENDERED}" | grep -q "Location /realms/"
echo "${RENDERED}" | grep -q "Location /api/clearinghouse/"
echo "${RENDERED}" | grep -q "Location /api/signer/"
echo "${RENDERED}" | grep -q "generate-live-payment"

# Only apache-signer-dmz should publish host ports.
docker compose -f "${COMPOSE_FILE}" config | grep -E 'published:' | grep -c "8080" >/dev/null

echo "clearinghouse compose verification passed"
