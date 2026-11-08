# CAN Trace Viewer

CAN log plotting app with a reusable Rust and WebAssembly parsing package.

Live instance: https://cantraceviewer.com.

## Commands

Use the repository's pinned mise toolchain (`mise trust`, then `mise install --locked`).

```sh
CI=true mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm run dev
mise exec -- pnpm run validate
mise exec -- pnpm run package:validate
```

Run `validate` before handoff. Use `package:validate` for package release checks.
Keep build-generating commands serial within a checkout because they share output directories.

## Structure

- `src/` contains the React app. `main.tsx` starts browser services and hydrates the shell; `server.tsx` renders it through `scripts/prerender.mjs` during the build. UI lives in `src/components/`, React hooks in `src/hooks/`, and non-React modules in `src/lib/` (`src/lib/plot/` is the plot domain).
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
