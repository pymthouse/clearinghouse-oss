#!/bin/sh
set -eu

: "${SIGNER_OIDC_METADATA_URL:?SIGNER_OIDC_METADATA_URL is required}"
: "${SIGNER_OIDC_ISSUER_URL:?SIGNER_OIDC_ISSUER_URL is required}"
: "${SIGNER_OIDC_JWKS_URL:?SIGNER_OIDC_JWKS_URL is required}"
: "${SIGNER_OIDC_CLIENT_ID:?SIGNER_OIDC_CLIENT_ID is required}"
: "${SIGNER_OIDC_CLIENT_SECRET:?SIGNER_OIDC_CLIENT_SECRET is required}"
: "${SIGNER_OIDC_CRYPTO_PASSPHRASE:?SIGNER_OIDC_CRYPTO_PASSPHRASE is required}"

envsubst '${SIGNER_OIDC_METADATA_URL} ${SIGNER_OIDC_ISSUER_URL} ${SIGNER_OIDC_JWKS_URL} ${SIGNER_OIDC_CLIENT_ID} ${SIGNER_OIDC_CLIENT_SECRET} ${SIGNER_OIDC_CRYPTO_PASSPHRASE}' \
  < /etc/apache2/sites-available/000-default.conf.template \
  > /etc/apache2/sites-available/000-default.conf

ln -sf /etc/apache2/sites-available/000-default.conf /etc/apache2/sites-enabled/000-default.conf

exec /usr/sbin/apache2ctl -D FOREGROUND
