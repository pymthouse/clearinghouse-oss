#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPI_DIR="${ROOT}/keycloak-spi"
PROVIDERS_DIR="${SPI_DIR}/providers"

mkdir -p "${PROVIDERS_DIR}"

docker run --rm \
  -v "${SPI_DIR}:/work" \
  -w /work \
  maven:3.9-eclipse-temurin-17 \
  mvn -q -DskipTests package

echo "Built ${PROVIDERS_DIR}/clearinghouse-spi.jar"
