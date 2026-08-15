#!/usr/bin/env bash

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ ! -f .env.local ]]; then
  cp .env.local.example .env.local
fi

npm ci
npm --prefix mobile ci
npm --prefix mcp ci
(
  cd go-ingress
  go mod download
)
