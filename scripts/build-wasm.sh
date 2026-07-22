#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
crate_dir="$repo_root/wasm"
out_dir="$repo_root/packages/core/src/wasm-bindgen"
target_dir="$crate_dir/target/wasm32-unknown-unknown"

profile="${1:-release}"
case "$profile" in
	dev)
		cargo_profile="debug"
		cargo_args=()
		;;
	release)
		cargo_profile="release"
		cargo_args=(--release)
		;;
	*)
		echo "usage: $0 [dev|release]" >&2
		exit 2
		;;
esac

if (( $# > 1 )); then
	echo "usage: $0 [dev|release]" >&2
	exit 2
fi

cd "$crate_dir"
cargo build --locked --target wasm32-unknown-unknown "${cargo_args[@]}"

mkdir -p "$out_dir"
wasm-bindgen \
	"$target_dir/$cargo_profile/cantraceviewer_wasm.wasm" \
	--target web \
	--typescript \
	--out-dir "$out_dir" \
	--out-name cantraceviewer

if [[ "$profile" == "release" ]]; then
	wasm_path="$out_dir/cantraceviewer_bg.wasm"
	wasm-opt \
		"$wasm_path" \
		-Oz \
		--enable-bulk-memory \
		--enable-bulk-memory-opt \
		--enable-nontrapping-float-to-int \
		-o "$wasm_path.optimized"
	mv "$wasm_path.optimized" "$wasm_path"
fi
