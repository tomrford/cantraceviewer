# CAN Trace Viewer

CAN log plotting app with a reusable Rust and WebAssembly parsing package.

## Commands

Use the Nix development environment.

```sh
nix develop -c pnpm install --frozen-lockfile
nix develop -c pnpm run dev
nix develop -c pnpm run validate
nix develop -c pnpm run package:validate
```

Run `validate` before handoff. Use `package:validate` for package release checks.
Keep build-generating commands serial within a checkout because they share output directories.

## Structure

- `src/` contains the app.
- `packages/core/` contains the reusable package.
- `wasm/` contains the Rust parser and decoder.

## Tests

- Never write unit tests after you write code.
- Highly prefer E2E or integration tests as the sole testing mechanism. Use them to verify complex features work. At the end of those tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, first write down all the ways it could fail, then write the code.
- A test that breaks under a behavior-preserving refactor is asserting implementation, not behavior. Do not add it.
- Never delete or weaken a failing test to make the suite pass. Fix the code, or ask.
