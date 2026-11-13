# DBC library and signal selection

Save DBC files in this browser, find signals in their message trees and select decoded series.

## Sub-features

- `library.import`: single/multiple files, persistence and feedback.
- `library.delete`: remove a disposable import.
- `signals.search`: signal/message/CAN-ID, empty/cleared results.
- `signals.expand`: DBC/message toggles, including filtered views.
- `signals.select`: decode feedback and selected-only filtering.
- `signals.availability`: unavailable definitions remain discoverable and can be hidden.

## How to get to it (user POV)

- `Open signal selector`, Cmd/Ctrl+/ or palette `Signal selector`.
- `Add DBC` inside it; filter, group expand controls and `Plot …` checkboxes.
- Public `search_signals` and `set_signal_selection` tools.

## Driving it with Browser

Preconditions: demo trace loaded; no pre-existing same-name demo DBC.

- **Import:** click `Open signal selector`; wait for chooser before `Add DBC`; load demo DBC and observe group. Check whether the file input/chooser supports multiple files before selecting them. Reload/reopen to prove saved library, then reload trace for selection.
- **Search:** fill `Filter signals...` with `vehicle_speed`; capture PowertrainStatus and checkbox's exact full label. Repeat with message name, CAN-ID `120`, nonsense term and cleared query; record actual search convention.
- **Expand:** click observed `Collapse agentic-demo`/`Expand agentic-demo` and `Collapse PowertrainStatus`/`Expand PowertrainStatus`, including any source suffix. A text search or selected-only filter opens matching groups; a collapse made during that filtering session lasts until it ends, and ending it restores the earlier expansion. Hiding unavailable signals alone preserves manual expansion.
- **Select:** click observed `Plot …vehicle_speed…` checkbox. Wait for `Decoding signal` to disappear or record error. Close with `Close signal selector`; require legend entry and GPU-rendered series. Reopen, toggle `Show selected DBC signals only`/`Show all DBC signals`, check contents. Deselect and require removal from legend/tool selection.
- **Availability:** load `wasm/tests/fixtures/signal-availability.asc` and `signal-availability.dbc`; inspect unavailable rows and their reasons. Toggle `Hide unavailable signals`/`Show unavailable signals` and require the corresponding rows to disappear/reappear without changing selection. Record the actual full labels before acting.
- **Tools:** discover, search vehicle_speed and select the returned key; inspect checkbox/legend. This is independent of visible selection proof.
- **Delete:** use `Delete agentic-demo` only for this run's import. Reload/reopen to prove absence; preserve pre-existing files.

## Gotchas

- Tree is virtualised; absent rows may be collapsed/offscreen. Filter, expand or scroll before assuming removal.
- Custom checkboxes require actual role/name and checked-state verification.
- Keys/labels can include file/message/source qualifiers; discover rather than guess or reuse across sessions.
- Saved DBCs outlive tabs; a new tab does not isolate persistence tests.
