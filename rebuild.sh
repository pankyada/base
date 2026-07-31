#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

command -v pnpm >/dev/null || { echo "pnpm required" >&2; exit 1; }
command -v bun >/dev/null || { echo "bun required" >&2; exit 1; }
command -v go >/dev/null || { echo "go required" >&2; exit 1; }

if [[ ! -d node_modules || "${INSTALL_DEPS:-0}" == "1" ]]; then
  pnpm install --frozen-lockfile
fi

pnpm build
GOCACHE="${GOCACHE:-/tmp/harness-go-cache}" pnpm build:bin

echo "rebuild complete"
