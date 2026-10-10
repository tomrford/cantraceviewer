# Crosshairs and numerical inspection

Place C1/C2 and compare nearest decoded samples, or inspect explicit times without moving the plot.

## Sub-features

- `inspect.markers`: place/centre/drag/remove/clear.
- `inspect.readout`: C1, C2 and C2 minus C1 values.
- `inspect.times`: bounded nearest samples, units/labels and distances.

## How to get to it (user POV)

- `Manage crosshairs` → `Place C1`/`Place C2`, then `Center C1`/`Center C2`, or `Clear all`.
- 1, 2, C; palette; plot context-menu Crosshairs and marker dragging/removal.
- Legend `Value at C1`, `Value at C2`, `Delta C2 − C1`.
- Public `inspect_at_times`, `set_crosshairs`, `describe_session`.

## Driving it with Browser

Preconditions: demo trace/DBC, selected vehicle_speed, discovered tools for exact times; GPU for visual markers.

- **Samples:** inspect `timesMs:[10,110]` with discovered vehicle_speed key. Require sample times 10/110 ms and values 100/123.4 km/h within floating-point tolerance; delta 23.4 if returned. Capture distances. Inspect 60 ms to record nearest/tie behaviour without asserting interpolation. Session before/after must retain viewport/markers.
- **UI:** `Manage crosshairs` → `Place C1`, repeat C2. Capture lines and legend choices; switch readouts, drag a marker and require changed time/value, then `Clear all`. Context menu/keys are distinct paths.
- **Tools:** set `crosshairs:[{id:1,timeMs:10},{id:2,timeMs:110}],readout:"delta"`; require unchanged time window, correct screenshot/session/legend. Inspect without times reads C1/C2 order. Clear with `crosshairs:[]` and confirm absence.

## Gotchas

- Nearest samples are not interpolated or simultaneous across signals. Preserve timestamps, distances, units and enum labels.
- Old UI formatting may hide precision; tool numbers do not prove rendered readouts.
- Numerical tools may work despite GPU failure; report visual marker checks blocked separately.
- Never return full decoded arrays to the model.
