# Plot navigation and axes

Explore decoded series sharing one time axis and organise scales across up to five Y axes.

## Sub-features

- `plot.zoom`: in/out/full extent and explicit time windows.
- `plot.gestures`: scroll zoom, pan and box zoom.
- `plot.legend`: visibility, colours and selected entries.
- `plot.axes`: create/move/remove axes, gutters and proportional Y navigation.

## How to get to it (user POV)

- Toolbar `Zoom in`, `Zoom out`, `Zoom to full extent`, `Use box zoom`/`Use drag pan`, `Hide legend`/`Show legend`.
- Plot gestures/context menu; +, -, 0, B, L and corresponding palette commands.
- Legend `Add Y axis`, grip context menu or grip drag-and-drop, `Remove Y2` and subsequent axes.
- Public `set_time_window` and `set_signal_axes` tools.

## Driving it with Browser

Preconditions: GPU doctor passed; demo vehicle_speed and engine_rpm selected/decoded.

- **Zoom:** capture fit, click `Zoom in`, require narrower time range/changed image; zoom out/reset and confirm fit. Tool path: set window `startMs:10,endMs:110`, inspect session and screenshot; reset with no bounds.
- **Gestures:** locate interior from current screenshot, scroll, pan by drag, activate box zoom and drag a rectangle. Record endpoints and before/after ranges. Y gestures move every axis by the same proportion of its own fit range. Test keys/context menu/palette separately when affected.
- **Legend:** hide/show, confirm visibility and unchanged selection/colour.
- **Axes:** click `Add Y axis` to create Y2, then right-click the observed `Move … to another Y axis` grip for engine_rpm and choose `Y2`; require Y1/Y2 grouping and separate scales/gutters. The grip appears only once multiple axes exist. Verify a left-click does not open a menu, dragging begins from the grip only and shows the whole row under the pointer, and label text does not move the signal. Focus the grip and open its menu with Enter, Space, Shift+F10 or the Menu key; move using the arrow keys and Enter, then require focus returns to the moved grip. Escape closes the menu and returns focus. `New Y axis` creates an additional axis. Move via `Y1`. Deselect releases assignment/colour but retains empty axis; reselect starts Y1. Add axes until five; no sixth available. Remove extra via `Remove Y…` and inspect reassignment.
- **Tools/drag:** discovered keys with `set_signal_axes` to Y2; inspect session and pixels. Independently prove first-attempt grip dragging to another axis and back, plus cancellation outside the legend, with documented native/browser drag capability; otherwise report not run. Move-menu proof cannot establish drag.

## Gotchas

- Canvas/tool ranges cannot prove pixels or gestures; visual checks blocked without ChartGPU.
- Coordinates come from current screenshots and must be recorded.
- Assignments are session state, released on deselection and cleared on reload.
- Explicit time bounds preserve Y zoom; no bounds resets all axes.
