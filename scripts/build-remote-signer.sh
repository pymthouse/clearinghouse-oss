#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GO_LIVEPEER="${GO_LIVEPEER_DIR:-${ROOT}/go-livepeer}"
IMAGE="${REMOTE_SIGNER_IMAGE:-go-livepeer-remote-signer:local}"

if [[ ! -d "${GO_LIVEPEER}/docker" ]]; then
  echo "go-livepeer not found at ${GO_LIVEPEER}" >&2
  echo "Set GO_LIVEPEER_DIR to your checkout path." >&2
  exit 1
fi

echo "Building ${IMAGE} from ${GO_LIVEPEER}/docker/Dockerfile (mainnet+experimental; this may take several minutes)..."
docker build \
  --build-arg BUILD_TAGS=mainnet,experimental \
  -f "${GO_LIVEPEER}/docker/Dockerfile" \
  -t "${IMAGE}" \
  "${GO_LIVEPEER}"

echo "Done. Start the stack with hot path:"
echo "  cd lpclearinghouse && docker compose --profile hot-path up -d"
