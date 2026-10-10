# DBC library and signal selection

Save DBC files in this browser, find signals in their message trees and select decoded series.

## Sub-features

- `library.import`: single/multiple files, persistence and feedback.
- `library.delete`: remove a disposable import.
- `signals.search`: signal/message/CAN-ID, empty/cleared results.
- `signals.expand`: DBC/message toggles, including filtered views.
- `signals.select`: decode feedback and selected-only filtering.

## How to get to it (user POV)

- `Open signal selector`, Cmd/Ctrl+/ or palette `Signal selector`.
- `Add DBC` inside it or DBC drop; filter, group expand controls and `Plot …` checkboxes.
- Public `search_signals` and `set_signal_selection` tools.

## Driving it with Browser

Preconditions: demo trace loaded; no pre-existing same-name demo DBC.

- **Import:** click `Open signal selector`; wait for chooser before `Add DBC`; load demo DBC and observe group. Inspect `chooser.isMultiple()` before multiple files. Reload/reopen to prove saved library, then reload trace for selection.
- **Search:** fill `Filter signals...` with `vehicle_speed`; capture PowertrainStatus and checkbox's exact full label. Repeat with message name, CAN-ID `120`, nonsense term and cleared query; record actual search convention.
- **Expand:** click observed `Collapse agentic-demo`/`Expand agentic-demo` and `Collapse PowertrainStatus`/`Expand PowertrainStatus`. For search-time changes compare against live baseline; assert branch's intended contract, then clear/restart search separately.
- **Select:** click observed `Plot …vehicle_speed…` checkbox. Wait for `Decoding signal` to disappear or record error. Close with `Close signal selector`; require legend entry and GPU-rendered series. Reopen, toggle `Show selected DBC signals only`/`Show all DBC signals`, check contents. Deselect and require removal from legend/tool selection.
- **Tools:** discover, search vehicle_speed and select the returned key; inspect checkbox/legend. This is independent of visible selection proof.
- **Delete:** use `Delete agentic-demo` only for this run's import. Reload/reopen to prove absence; preserve pre-existing files.

## Gotchas

- Tree is virtualised; absent rows may be collapsed/offscreen. Filter, expand or scroll before assuming removal.
- Custom checkboxes require actual role/name and checked-state verification.
- Keys/labels can include file/message/source qualifiers; discover rather than guess or reuse across sessions.
- Saved DBCs outlive tabs; a new tab does not isolate persistence tests.
