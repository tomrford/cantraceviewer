# Deferred loading regression

Protect `help.discovery` and the first plot against a missing deployment chunk or failed network
request. Run this browser integration scenario against an immutable preview; retain screenshots,
DOM snapshots, console errors, blocked request URLs and the deployment SHA in the run manifest.
Use only run-created tabs. No saved-library reset is needed.

For each of Help, Command palette and Plot, start a fresh document with cache disabled. Block
`*help-dialog-*.js`, `*command-palette-*.js` or `*signal-plot-*.js` respectively using the tab's
DevTools Network request blocking. Activate Help through settings, Cmd/Ctrl+K, or Load trace with
`wasm/tests/fixtures/agentic-demo.asc`.

1. While the request is pending (use request interception to pause it), require `Loading Plot…`
   for the plot and no stub dialog for Help or the palette: a chunk usually lands within a few
   frames, and a stub would flash before the real dialog.
2. Fail the request. Require a visible named failure, a `Reload page` button and an explanation
   that reloading clears the current trace and selection while retaining saved DBCs/preferences.
3. For dialogs, close with Escape and reopen through the same entry point. Require the failure
   and recovery action again. Hidden dialogs must not leave a recovery overlay on the page.
4. Remove the block. Click `Reload page` (do not call an internal retry). Require the landing
   screen and no failure. Reopen the same feature; require the real Help shortcut groups,
   searchable command palette, or plot shell with `Select signals from the signal selector to view
them.` after loading the trace.
5. Capture the result and close only this run's tab; always remove network overrides, including
   when an assertion fails.

A reload deliberately starts a new ESM module map: importing the same rejected URL again can
reuse a cached failure, and a deleted deployment chunk needs fresh HTML. Do not assert a network
retry on reopen. An immutable old preview cannot prove recovery from a removed deployment's
assets; the blocked-request scenario proves the visible failure/reload contract.
