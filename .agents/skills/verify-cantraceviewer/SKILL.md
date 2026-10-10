---
name: verify-cantraceviewer
description: Verify CAN Trace Viewer's browser UI and public WebMCP tools with real fixtures, visual and numerical evidence. Use for feature changes, regressions and final branch-preview testing.
---

# Verify CAN Trace Viewer

Read [the feature map](features/README.md), then the affected recipes. The primary surface is the browser plotter at `/`. Core-package integration checks complement browser evidence; they cannot prove UI behaviour.

## Launch

Choose the target before driving:

- **Committed/pushed work:** use the live Cloudflare branch preview, including final testing. Discover its URL from the PR Cloudflare check/deployment link or Cloudflare deployment metadata. Verify the deployed SHA matches the exact tested head. Record URL, branch and SHA: a mutable branch alias alone is insufficient. If no preview is available, report this gate blocked; local testing cannot substitute. The repository CI validates code but does not publish a preview URL in its workflow. Never invent a preview hostname.
- **Clear before/after:** reproduce on `https://cantraceviewer.com`, then repeat identical actions and fixture bytes on the branch preview (or local instance during uncommitted development). Match browser, viewport, theme, timestamps and initial library/selection state. Capture both outcomes, intended difference and unaffected behaviour. Record production revision when available, otherwise explicitly unknown. Production is a baseline, not the oracle for new behaviour.
- **Uncommitted development/skill authoring:** from the repository root run `nix develop -c sfw pnpm run dev --host 127.0.0.1 --port 5174 --strictPort`. Retain its terminal session for cleanup. Ready means Vite reports `http://127.0.0.1:5174/` and the browser displays `CAN Trace Viewer` with `Load trace`. If occupied choose a free port and record it; never stop its owner. On local machines prefix pnpm/uv/cargo with `sfw`; cloud uses the platform egress proxy. If needed install separately with `CI=true nix develop -c sfw pnpm install --frozen-lockfile`. Build-generating commands sharing output directories run serially.

Use `@Browser` through `cua_repl`. Initialise `let tab = await cua.createBrowserTab("iab", targetUrl, {visible:false})` and read its returned documentation. Use `@Chrome` as fallback or for logged-in access. Read `file-uploads` documentation before loading files.

Different origins isolate browser storage. Tabs at the same origin share the saved DBC library/preferences; theme synchronises between tabs. A fresh tab is not a fresh profile. Prefer a disposable profile. Otherwise inspect existing state, avoid filename collisions, restore preferences and delete only this run's added DBCs. Never reset the user's library. Local instances can run on distinct ports. Never double-drive a shared tab/profile with another agent.

## Doctor

Run this read-only check on opening a target and whenever identity/health looks wrong:

```js
nodeRepl.write({ url: await tab.url(), title: await tab.title() });
nodeRepl.write(await tab.playwright.domSnapshot());
nodeRepl.write(await tab.dev.logs({ levels: ['error', 'warn'], limit: 30 }));
```

Require the intended origin, `CAN Trace Viewer`, `Load trace`, `Open signal selector` and no unexplained page/Worker errors. Verify preview SHA externally: page title does not identify a revision. Locally record `git rev-parse HEAD`, dirty state and the retained server session. No account or seed service is required.

**GPU scope:** browsers without GPU acceleration, particularly cloud agents, can likely test only a subset. Load/select a known signal, then inspect screenshot and logs for ChartGPU startup failure. A canvas, available tools or successful decoding does not prove rendering. If startup fails, record the actual error and mark plot shape, gutters/axes, gestures, marker rendering and image export blocked pending a GPU-capable browser. Imports, library/search, help/settings and bounded numerical tools may still work; verify each independently. Do not mock the canvas, patch ChartGPU or silently use software rendering to claim equivalent visual proof.

## Drive

Use supported browser locators grounded in fresh snapshots; inspect state after actions. Bind `repoRoot` to this checkout's absolute path. Load a committed fixture through the visible control:

```js
let chooserPending = tab.playwright.waitForEvent('filechooser');
await tab.playwright.getByRole('button', { name: 'Load trace', exact: true }).click();
let chooser = await chooserPending;
await chooser.setFiles([repoRoot + '/wasm/tests/fixtures/agentic-demo.asc']);
nodeRepl.write(await tab.playwright.domSnapshot());
```

Click `Open signal selector`, then use the same chooser flow on `Add DBC` for `wasm/tests/fixtures/agentic-demo.dbc`. Filter with `getByPlaceholder("Filter signals...")`; click the exact `Plot …` checkbox name from the fresh snapshot. The map specifies alternate entry points and observable outcomes.

Public WebMCP is an additional user surface. Discover tools per tab each turn and after navigation:

```js
let webmcp = await tab.capabilities.get('webmcp');
let pageTools = await webmcp.fetchTools();
nodeRepl.write(pageTools.description());
```

Call only returned names/schemas; IDs vary by document. Logical names are `describe_session`, `search_signals`, `set_signal_selection`, `set_signal_axes`, `set_time_window`, `set_crosshairs`, `inspect_at_times`. Use bounded explicit-time/current-marker inspection. Never extract decoded arrays or WASM internals. If unavailable, drive visible controls and report tool-only checks unavailable. Tool proof does not verify the corresponding menu, key or gesture path.

## Evidence

Store each run outside disposable state at `/tmp/cantraceviewer-verification/<unique-run-id>/` (platform temporary directory elsewhere). Save a manifest with target URL, deployment/head SHA or unknown, dirty state, browser/viewport, GPU outcome, fixture paths and SHA-256 hashes, feature IDs, entry points, actions, expected/actual outcomes and passed/failed/blocked/not-run coverage.

Capture before snapshot/screenshot, action and resulting snapshot/screenshot. Save relevant logs and public tool results. Browser screenshots are JPEG; persist returned bytes as `.jpg`. File I/O can use `node:fs/promises` in the browser REPL; browser interactions use supported browser APIs. Report real artifact paths.

Exercise actual user paths; do not seed IndexedDB/local storage or invoke internal stores. Mocks only belong at an existing isolated production boundary. Prove persistence by reload and reopening library/settings: traces/selections clear while saved DBCs/preferences remain. Inspect actual downloads/clipboard image as well as toasts. Capture errors/warnings before dismissal.

For comparisons use `baseline/` and `candidate/` directories plus paired expected/actual results with identical actions and inputs. Derive numerical expectations independently from fixture bytes/contracts: demo PowertrainStatus at 10 ms has vehicle_speed 100 km/h and engine_rpm 4488 rpm; at 110 ms they are 123.4 km/h and 5379 rpm. Record nearest-sample timestamps/distances. Formatting can differ between revisions.

## Cleanup

After every successful or failed attempt, close only run-created tabs and stop only the retained local server session with Ctrl-C. Confirm a started port is released; never kill by process name. On shared profiles delete only newly imported fixtures through `Delete <name>`, restore changed preferences, and verify cleanup in a second view. Never use `Reset persistent data` on shared state. Restore clipboard and release temporary viewport overrides if used. Preserve all proof artifacts and confirm they still exist after teardown; report incomplete cleanup.

## Helpers

No helper executable or new browser dependency is required. Use the installed browser tool's documented chooser, locators, screenshots, logs and WebMCP capabilities. These are agent recipes, not a standalone Playwright runner. Maintain the map with `/maintain-verification-skill` as the app changes.
