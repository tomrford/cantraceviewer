# CAN Trace Viewer

CAN log plotting app with a reusable Rust and WebAssembly parsing package.

Live instance: https://cantraceviewer.com.

## Commands

Use the Nix development environment.

```sh
CI=true nix develop -c pnpm install --frozen-lockfile
nix develop -c pnpm run dev
nix develop -c pnpm run validate
nix develop -c pnpm run package:validate
```

Run `validate` before handoff. Use `package:validate` for package release checks.
Keep build-generating commands serial within a checkout because they share output directories.

## Structure

- `src/` contains the React app. `main.tsx` starts browser services and hydrates the shell; `server.tsx` renders it through `scripts/prerender.mjs` during the build.
- `src/store/store.ts` owns the Zustand app store and derived-state update order. Domain actions write source state through `update()`; `derive.ts` computes the derived fields. Keep React subscriptions narrow and avoid duplicating this derivation in effects.
- `packages/core/` contains the reusable package; its [README](packages/core/README.md) documents the public API and parser contracts. The app consumes the pinned registry version, so local Rust/package edits do not automatically change browser behaviour.
- `wasm/` contains the Rust parser and decoder.

## Tests

For browser verification, use [verify-cantraceviewer](.agents/skills/verify-cantraceviewer/SKILL.md) and its feature map. Test pushed changes on the preview for the exact commit and retain the evidence. Package tests complement browser checks; they do not prove plot rendering or UI interactions.

## Reference sources

Clone upstream sources into `.repos/` (gitignored) only when needed; prefer a shallow clone at the noted ref.

- python-can: https://github.com/hardbyte/python-can (trace format readers/writers)
- chartgpu: https://github.com/chartgpu/chartgpu at the version in `package.json`
- blf_asc: crate `blf_asc` 0.2.0
