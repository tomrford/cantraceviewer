# Trace loading

Open one CAN log or MF4 file. Replacing it changes the active trace without persisting the trace file.

## Sub-features

- `trace.open`: ASC/TRC/BLF/MF4 chooser, loading and completion.
- `trace.drop`: supported file dropped onto the page.
- `trace.replace`: new active trace with saved DBCs retained.
- `trace.feedback`: invalid/oversized inputs and recoverable warnings.
- `trace.native`: MF4-native signals and temporary embedded DBCs.

## How to get to it (user POV)

- Empty-screen `Open trace` or toolbar `Load trace`.
- Cmd/Ctrl+O, palette `Open trace`, or drop a file onto the page.

## Driving it with Browser

Preconditions: doctor passed; record existing library/selection before replacement.

- **Open:** use the skill's chooser recipe for the demo ASC. Require filename in toolbar and loading completion. Add demo DBC/select vehicle_speed to establish usable data, not merely a filename. Capture `describe_session` metadata when available.
- **Alternate paths:** start chooser wait before the empty-screen button, shortcut or palette command. Drop requires documented native/browser file-drag support; otherwise record not run. Chooser proof cannot stand in for drop.
- **Replace:** load `wasm/tests/fixtures/mf4/decoded-channels.mf4`; inspect native catalogue, select a native signal and capture decode/render outcome. Restore demo ASC: obsolete native entries disappear, saved DBC remains.
- **Embedded:** load `wasm/tests/fixtures/mf4/hybrid-embedded-dbc.mf4`; inspect temporary `MF4` DBC badge and its replacement/reload lifetime. Derive numerical expectations from fixture code before asserting values.
- **Feedback:** prepare disposable unsupported input or malformed-line ASC copy; record bytes/policy, load visibly, capture error/warning before dismissal and subsequent successful load. Use a sparse oversized fixture only if transport preserves its size; verify the 500 MiB pre-read cap without pulling huge contents into the model.
- **Reload:** trace clears; saved DBC persists. Capture the second view.

## Gotchas

- Input accept filters can prevent unsupported-file selection; report the limitation rather than inject inputs.
- Parsed metadata is GPU-independent evidence only; rendered series require ChartGPU.
- Capture transient warnings immediately and inspect session before classifying import failure.
- Format-specific regressions need their own fixtures; demo ASC cannot prove BLF/TRC support.
