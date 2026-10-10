# Settings, help and export

Adjust browser preferences, discover controls and copy/save an image of the current plot.

## Sub-features

- `settings.preferences`: theme, timestamps and legend order.
- `settings.persistence`: reload and disposable-profile reset.
- `help.discovery`: help/tour, command search and enabled states.
- `export.image`: actual copy/save output.

## How to get to it (user POV)

- `Open settings` or Cmd/Ctrl+,; Light/Dark/System, X-axis timestamps, Legend order.
- `Open help`, ?, `First time? Take a tour` or help `Show quick tour`.
- Cmd/Ctrl+K and `Search for a command...`.
- Plot right-click `Copy image`/`Save image`.

## Driving it with Browser

Preconditions: preserve initial preferences; disposable profile for reset; GPU/plotted demo for export.

- **Theme:** open settings, Light then Dark; require `aria-pressed` and changed appearance. Reload/reopen to prove persistence; restore original including System.
- **Other preferences:** use observed labelled select/combobox, choose Absolute/Relative and require timestamp labels to change for dated trace. Choose Selection order/Alphabetical/Grouped with multiple series, inspect rows; reload/reopen, then restore.
- **Help/tour:** `Open help` shows CAN Trace Viewer dialog/shortcut groups; Close, reopen and `Show quick tour`. Inspect first step, advance through observed Next control and finish/close. Empty-screen tour is a distinct path.
- **Palette:** Cmd/Ctrl+K outside editable fields, fill search with nonsense and require `No matching command.`; choose a real command and verify destination. Plot commands disabled in empty session.
- **Save:** screenshot-grounded plot right-click, listen for the download before activating `Save image`. Record download path; inspect dimensions/content, retain with evidence. Require series/axes/legend in image, not just a toast.
- **Copy:** preserve clipboard if supported, choose `Copy image`, inspect image entry and restore prior content. Record permission limitations.
- **Reset:** only disposable profile: seed through UI, use observed `Reset persistent data`, reload; require empty saved library/default preferences. Never reset shared state.

## Gotchas

- Settings/help have separate close controls; use current exact accessible names.
- Editable fields/popovers suppress shortcuts; focus intended surface.
- Theme can synchronise across same-origin tabs; restore promptly.
- Export and visible timestamps/order need GPU; help/preference selection can work without it.
