#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build --locked --release --target wasm32-unknown-unknown
install -m 644 target/wasm32-unknown-unknown/release/smearoo.wasm assets/paint.wasm

runtime=${STARHERMIT:-starhermit}
if (( $# )); then
    output=$1
else
    output=$(mktemp -d)
    trap 'rm -rf -- "$output"' EXIT
fi
"$runtime" package --web . --out "$output"
"$runtime" check "$output"
install -m 644 "$output/index.html" "$output/starhermit-files.json" .
