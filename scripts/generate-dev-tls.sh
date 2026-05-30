#!/usr/bin/env bash
# Generate a local development TLS chain for the signer Apache DMZ:
#   - a local CA (dev-ca.crt / dev-ca.key)
#   - a server cert (server.crt / server.key) signed by that CA, with SANs covering
#     the hostnames the DMZ is reached by (localhost, clearinghouse.localhost, the
#     in-network service names, and 127.0.0.1).
#
# The CA cert can be trusted by Node (NODE_EXTRA_CA_CERTS), the OS trust store, and the
# browser so the self-signed chain is accepted without warnings. Re-run with --force to
# regenerate. The Python SDK can instead set LIVEPEER_ALLOW_INSECURE_TLS=1.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${TLS_CERT_DIR:-$SCRIPT_DIR/../apache/certs}"
DAYS="${TLS_DAYS:-825}"
FORCE="${1:-}"

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

if [[ -f server.crt && "$FORCE" != "--force" ]]; then
  echo "TLS certs already exist in $CERT_DIR (use --force to regenerate)"
  exit 0
fi

# Local CA
openssl genrsa -out dev-ca.key 4096
openssl req -x509 -new -nodes -key dev-ca.key -sha256 -days "$DAYS" \
  -subj "/O=Livepeer Clearinghouse Dev/CN=Livepeer Clearinghouse Dev CA" \
  -out dev-ca.crt

# Server key + CSR
openssl genrsa -out server.key 2048
openssl req -new -key server.key \
  -subj "/O=Livepeer Clearinghouse Dev/CN=localhost" \
  -out server.csr

cat > server.ext <<'EXT'
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = clearinghouse.localhost
DNS.3 = keycloak
DNS.4 = apache-signer-dmz
IP.1 = 127.0.0.1
EXT

openssl x509 -req -in server.csr -CA dev-ca.crt -CAkey dev-ca.key -CAcreateserial \
  -out server.crt -days "$DAYS" -sha256 -extfile server.ext

rm -f server.csr server.ext dev-ca.srl

echo "Generated dev TLS chain in $CERT_DIR:"
echo "  CA:     $CERT_DIR/dev-ca.crt"
echo "  Server: $CERT_DIR/server.crt (+ server.key)"
echo
echo "Trust the CA for clients that verify TLS:"
echo "  Node (Dashboard): export NODE_EXTRA_CA_CERTS=$CERT_DIR/dev-ca.crt"
echo "  Linux system:     sudo cp $CERT_DIR/dev-ca.crt /usr/local/share/ca-certificates/clearinghouse-dev-ca.crt && sudo update-ca-certificates"
echo "  Python SDK:       set LIVEPEER_ALLOW_INSECURE_TLS=1 (or REQUESTS_CA_BUNDLE=$CERT_DIR/dev-ca.crt)"
