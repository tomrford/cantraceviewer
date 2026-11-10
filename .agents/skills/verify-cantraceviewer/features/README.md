# CAN Trace Viewer verification map

Read [the skill](../SKILL.md) for target selection, isolation, GPU checks and evidence standards. Baseline fixtures are `wasm/tests/fixtures/agentic-demo.asc` and `agentic-demo.dbc`; record hashes and load through visible controls. Avoid duplicate saved DBCs in shared profiles.

This map is the maintained verification source. Cover every affected sub-feature/entry point or report blocked/not run. One convenient entry point does not prove the others. Tool and UI paths are separately reportable; GPU-independent checks remain partial when rendering fails.

- [Trace loading](trace-loading.md): chooser, drop, replacement, warnings and MF4.
- [DBC library and selection](signal-library.md): persistence, search, expansion and selection.
- [Plot navigation and axes](plot-navigation.md): zoom/pan, legend and five Y axes.
- [Crosshairs and inspection](inspection.md): markers, nearest samples and deltas.
- [Settings, help and export](settings-help-export.md): preferences, shortcuts, tour and image outputs.

This seed map covers the main surfaces, not every parser variant. Add regression fixtures and independent expectations for formats, multiplexing, source choices and limits. Core checks use `nix develop -c pnpm run package:validate`; they cannot substitute for deployed browser proof. The app consumes the exact published core version in `package.json`; local Rust edits are not automatically exercised by the app.
