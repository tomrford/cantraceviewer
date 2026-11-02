#!/usr/bin/env bash

set -u

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

failed=0

echo "pnpm audit"
pnpm audit || failed=1

echo
echo "cargo audit"
cargo audit --file wasm/Cargo.lock || failed=1

exit "$failed"
