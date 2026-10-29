#!/usr/bin/env bash
# Preserve the upstream six-argument interface, with Node's scoped path and TSV checks.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "$script_dir/log.mjs" "$@"
