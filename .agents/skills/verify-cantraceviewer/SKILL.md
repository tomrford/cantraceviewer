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
- **Uncommitted development/skill authoring:** from the repository root run `nix develop -c pnpm run dev --host 127.0.0.1 --port 5174 --strictPort`. Retain its terminal session for cleanup. Ready means Vite reports `http://127.0.0.1:5174/` and the browser displays `CAN Trace Viewer` with `Load trace`. If occupied choose a free port and record it; never stop its owner. If needed install separately with `CI=true nix develop -c pnpm install --frozen-lockfile`. Build-generating commands sharing output directories run serially.

Use the browser automation available in your environment: an agent browser tool, Playwright, CDP or native browser control. Read its supported API and file-loading instructions before driving. Use accessible roles/names and fresh DOM or accessibility snapshots where supported; use screenshot-grounded interaction for canvas gestures. Record the browser and rendering capabilities, including whether GPU acceleration is available.

Different origins isolate browser storage. Tabs at the same origin share the saved DBC library/preferences; theme synchronises between tabs. A fresh tab is not a fresh profile. Prefer a disposable profile. Otherwise inspect existing state, avoid filename collisions, restore preferences and delete only this run's added DBCs. Never reset the user's library. Local instances can run on distinct ports. Never double-drive a shared tab/profile with another agent.

## Doctor

On opening a target and whenever identity/health looks wrong, perform one read-only browser health check: capture the current URL, page title, DOM/accessibility snapshot and recent console warnings/errors using your browser harness.

Require the intended origin, `CAN Trace Viewer`, `Load trace`, `Open signal selector` and no unexplained page/Worker errors. Verify preview SHA externally: page title does not identify a revision. Locally record `git rev-parse HEAD`, dirty state and the retained server session. No account or seed service is required.

**GPU scope:** browsers without GPU acceleration, particularly cloud agents, can likely test only a subset. Load/select a known signal, then inspect screenshot and logs for ChartGPU startup failure. A canvas, available tools or successful decoding does not prove rendering. If startup fails, record the actual error and mark plot shape, gutters/axes, gestures, marker rendering and image export blocked pending a GPU-capable browser. Imports, library/search, help/settings and bounded numerical tools may still work; verify each independently. Do not mock the canvas, patch ChartGPU or silently use software rendering to claim equivalent visual proof.

## Drive

Use supported browser controls grounded in fresh snapshots; inspect state after actions. Resolve fixture paths against this checkout's absolute root. For the initial user path:

1. Activate the button named `Load trace` and choose `wasm/tests/fixtures/agentic-demo.asc` through the harness's file chooser or file-input support. Where file choosers are event-based, start listening before activating the button.
2. Wait for loading to finish and the toolbar to show `agentic-demo`.
3. Activate `Open signal selector`, then `Add DBC`, and choose `wasm/tests/fixtures/agentic-demo.dbc`.
4. Fill the input with placeholder `Filter signals...` with `vehicle_speed`; activate the checkbox named `Plot PowertrainStatus.vehicle_speed`.
5. Wait for decoding to finish, activate `Close signal selector`, and capture the legend and plot outcome.

The feature map specifies alternate entry points and observable outcomes. These accessible names can be used directly with role/name locators in harnesses that support them.

Public WebMCP is an additional user surface. If your browser harness exposes it, discover the current document's tool names and schemas before calling them. Refresh discovery after navigation or when the tool list changes; follow the harness's handle-lifetime rules.

Call only returned names/schemas; IDs vary by document. Logical names are `describe_session`, `search_signals`, `set_signal_selection`, `set_signal_axes`, `set_time_window`, `set_crosshairs`, `inspect_at_times`. Use bounded explicit-time/current-marker inspection. Never extract decoded arrays or WASM internals. If unavailable, drive visible controls and report tool-only checks unavailable. Tool proof does not verify the corresponding menu, key or gesture path.

## Evidence

Store each run outside disposable state at `/tmp/cantraceviewer-verification/<unique-run-id>/` (platform temporary directory elsewhere). Save a manifest with target URL, deployment/head SHA or unknown, dirty state, browser/viewport, GPU outcome, fixture paths and SHA-256 hashes, feature IDs, entry points, actions, expected/actual outcomes and passed/failed/blocked/not-run coverage.

Capture before snapshot/screenshot, action and resulting snapshot/screenshot. Save relevant logs and public tool results. Save screenshots in their actual returned format with a matching extension. Use the harness's export facilities or ordinary file I/O to preserve artifacts. Report real artifact paths.

Exercise actual user paths; do not seed IndexedDB/local storage or invoke internal stores. Mocks only belong at an existing isolated production boundary. Prove persistence by reload and reopening library/settings: traces/selections clear while saved DBCs/preferences remain. Inspect actual downloads/clipboard image as well as toasts. Capture errors/warnings before dismissal.

For comparisons use `baseline/` and `candidate/` directories plus paired expected/actual results with identical actions and inputs. Derive numerical expectations independently from fixture bytes/contracts: demo PowertrainStatus at 10 ms has vehicle_speed 100 km/h and engine_rpm 4488 rpm; at 110 ms they are 123.4 km/h and 5379 rpm. Record nearest-sample timestamps/distances. Formatting can differ between revisions.

## Cleanup

After every successful or failed attempt, close only run-created tabs and stop only the retained local server session with Ctrl-C. Confirm a started port is released; never kill by process name. On shared profiles delete only newly imported fixtures through `Delete <name>`, restore changed preferences, and verify cleanup in a second view. Never use `Reset persistent data` on shared state. Restore clipboard and release temporary viewport overrides if used. Preserve all proof artifacts and confirm they still exist after teardown; report incomplete cleanup.

## Helpers

No helper executable or new browser dependency is required. Use your environment's supported file loading, browser controls, screenshots, logs and optional WebMCP access. These recipes do not require a particular agent plugin or browser harness. Maintain the map with `/maintain-verification-skill` as the app changes.
