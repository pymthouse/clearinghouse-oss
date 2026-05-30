#!/usr/bin/env bash
# Direct-to-Dashboard device verification (Option 1 variant).
#
# Keycloak returns verification_uri / verification_uri_complete pointing at the Dashboard
# (realm attribute shortVerificationUri). The Dashboard receives user_code, runs auth-code
# login against the clearinghouse, and approves the pending device via RFC 8693 token
# exchange (m2m_demo). No SPI redirect hop on /realms/.../device.
#
# Run after realm import when the realm already exists (import skips updates). Idempotent.
set -euo pipefail

KC="${KEYCLOAK_CONTAINER:-lpclearinghouse-keycloak-1}"
ADMIN="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
REALM="${CLEARINGHOUSE_REALM:-clearinghouse}"
PUBLIC_CLIENT_ID="${DEVICE_PUBLIC_CLIENT_ID:-app_demo}"
M2M_CLIENT_ID="${DEVICE_M2M_CLIENT_ID:-m2m_demo}"
SHORT_VERIFICATION_URI="${DASHBOARD_DEVICE_VERIFICATION_URI:-http://localhost:3001/login/device}"
# Default client scopes required by clearinghouse SPI (device approval + signer audience exchange).
M2M_DEFAULT_SCOPES="${M2M_DEFAULT_SCOPES:-signer-claims,device:approve,sign:job,users:token,users:write}"
PUBLIC_DEFAULT_EXTRA_SCOPES="${PUBLIC_DEFAULT_EXTRA_SCOPES:-sign:job}"

kc() { docker exec "$KC" /opt/keycloak/bin/kcadm.sh "$@"; }

kc config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$ADMIN" \
  --password "$ADMIN_PASSWORD" >/dev/null

CLIENT_UUID="$(kc get clients -r "$REALM" 2>/dev/null | PUBLIC_CLIENT_ID="$PUBLIC_CLIENT_ID" python3 -c '
import sys, json, os
target = os.environ["PUBLIC_CLIENT_ID"]
print(next((c["id"] for c in json.load(sys.stdin) if c.get("clientId") == target), ""))
')"
if [[ -z "$CLIENT_UUID" ]]; then
  echo "client $PUBLIC_CLIENT_ID not found in realm $REALM" >&2
  exit 1
fi

# Point device verification URLs at the Dashboard (DeviceEndpoint.SHORT_VERIFICATION_URI).
kc update "realms/${REALM}" -s "attributes.shortVerificationUri=${SHORT_VERIFICATION_URI}"

# Use default browser flow for app_demo (not device-third-party-browser + SPI).
kc update "clients/${CLIENT_UUID}" -r "$REALM" -s 'authenticationFlowBindingOverrides.browser='

# Device grant + PKCE on the public client.
kc get "clients/${CLIENT_UUID}" -r "$REALM" > /tmp/app_demo_kc.json
python3 <<'PY'
import json
with open("/tmp/app_demo_kc.json") as f:
    client = json.load(f)
client.setdefault("attributes", {})
client["attributes"]["oauth2.device.authorization.grant.enabled"] = "true"
client["attributes"]["pkce.code.challenge.method"] = "S256"
client["attributes"].pop("initiate.login.uri", None)
with open("/tmp/app_demo_kc_patched.json", "w") as f:
    json.dump(client, f)
PY
docker cp /tmp/app_demo_kc_patched.json "$KC":/tmp/app_demo_kc_patched.json
kc update "clients/${CLIENT_UUID}" -r "$REALM" -f /tmp/app_demo_kc_patched.json

# Verify realm attribute and cleared browser override.
APPLIED_URI="$(kc get "realms/${REALM}" 2>/dev/null | python3 -c '
import sys, json
r = json.load(sys.stdin)
print(r.get("attributes", {}).get("shortVerificationUri", ""))
')"
if [[ "$APPLIED_URI" != "$SHORT_VERIFICATION_URI" ]]; then
  echo "ERROR: shortVerificationUri did not persist (expected $SHORT_VERIFICATION_URI, got '$APPLIED_URI')" >&2
  exit 1
fi

OVERRIDE="$(kc get "clients/${CLIENT_UUID}" -r "$REALM" 2>/dev/null | python3 -c '
import sys, json
c = json.load(sys.stdin)
print(c.get("authenticationFlowBindingOverrides", {}).get("browser", ""))
')"
if [[ -n "$OVERRIDE" ]]; then
  echo "ERROR: browser flow override still set on $PUBLIC_CLIENT_ID: $OVERRIDE" >&2
  exit 1
fi

scope_id_for_name() {
  local scope_name="$1"
  kc get client-scopes -r "$REALM" 2>/dev/null | SCOPE_NAME="$scope_name" python3 -c "
import sys, json, os
target = os.environ['SCOPE_NAME']
rows = json.load(sys.stdin)
print(next((r['id'] for r in rows if r.get('name') == target), ''))
"
}

client_has_default_scope() {
  SCOPE_NAME="$1" python3 -c "
import sys, json, os
want = os.environ['SCOPE_NAME']
print('yes' if any(s.get('name') == want for s in json.load(sys.stdin)) else 'no')
"
}

client_has_optional_scope() {
  client_has_default_scope "$@"
}

assign_default_client_scopes() {
  local client_uuid="$1"
  local scope_csv="$2"
  local scope_name scope_id
  IFS=',' read -ra WANT_SCOPES <<<"$scope_csv"
  for scope_name in "${WANT_SCOPES[@]}"; do
    scope_name="${scope_name// /}"
    [[ -z "$scope_name" ]] && continue
    scope_id="$(scope_id_for_name "$scope_name")"
    if [[ -z "$scope_id" ]]; then
      echo "client scope $scope_name not found in realm $REALM" >&2
      exit 1
    fi
  done
  for scope_name in "${WANT_SCOPES[@]}"; do
    scope_name="${scope_name// /}"
    [[ -z "$scope_name" ]] && continue
    scope_id="$(scope_id_for_name "$scope_name")"
    if [[ "$(kc get "clients/${client_uuid}/default-client-scopes" -r "$REALM" 2>/dev/null | client_has_default_scope "$scope_name")" != "yes" ]]; then
      kc update "clients/${client_uuid}/default-client-scopes/${scope_id}" -r "$REALM" -n >/dev/null 2>&1 || true
    fi
    if [[ "$(kc get "clients/${client_uuid}/optional-client-scopes" -r "$REALM" 2>/dev/null | client_has_optional_scope "$scope_name")" == "yes" ]]; then
      kc delete "clients/${client_uuid}/optional-client-scopes/${scope_id}" -r "$REALM" >/dev/null 2>&1 || true
    fi
  done
}

M2M_UUID="$(kc get clients -r "$REALM" 2>/dev/null | M2M_CLIENT_ID="$M2M_CLIENT_ID" python3 -c '
import sys, json, os
target = os.environ["M2M_CLIENT_ID"]
print(next((c["id"] for c in json.load(sys.stdin) if c.get("clientId") == target), ""))
')"
if [[ -z "$M2M_UUID" ]]; then
  echo "client $M2M_CLIENT_ID not found in realm $REALM" >&2
  exit 1
fi

assign_default_client_scopes "$M2M_UUID" "$M2M_DEFAULT_SCOPES"
assign_default_client_scopes "$CLIENT_UUID" "$PUBLIC_DEFAULT_EXTRA_SCOPES"

# Ensure M2M links to the public app for token-exchange binding.
LINKED_PUBLIC="$(kc get "clients/${M2M_UUID}" -r "$REALM" 2>/dev/null | python3 -c '
import sys, json
c = json.load(sys.stdin)
print(c.get("attributes", {}).get("linked.public.client.id", ""))
')"
if [[ "$LINKED_PUBLIC" != "$PUBLIC_CLIENT_ID" ]]; then
  kc get "clients/${M2M_UUID}" -r "$REALM" > /tmp/m2m_kc.json
  PUBLIC_CLIENT_ID="$PUBLIC_CLIENT_ID" python3 <<'PY'
import json, os
with open("/tmp/m2m_kc.json") as f:
    client = json.load(f)
client.setdefault("attributes", {})["linked.public.client.id"] = os.environ["PUBLIC_CLIENT_ID"]
with open("/tmp/m2m_kc_patched.json", "w") as f:
    json.dump(client, f)
PY
  docker cp /tmp/m2m_kc_patched.json "$KC":/tmp/m2m_kc_patched.json
  kc update "clients/${M2M_UUID}" -r "$REALM" -f /tmp/m2m_kc_patched.json
fi

echo "Configured direct-to-Dashboard device verification for $REALM"
echo "  shortVerificationUri=$SHORT_VERIFICATION_URI"
echo "  public client=$PUBLIC_CLIENT_ID (browser override cleared)"
echo "  m2m client=$M2M_CLIENT_ID default scopes=$M2M_DEFAULT_SCOPES"
echo "  public extra default scopes=$PUBLIC_DEFAULT_EXTRA_SCOPES"
