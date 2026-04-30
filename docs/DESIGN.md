# DESIGN.md

We're intentionally keeping functionality quick and minimal instead of parsing all relevant data. The UX will be something akin to:

0. open a single trace file (.asc, .blf, .trc etc)
1. open 1+ dbc files
2. user selects/toggles signals that should appear on the plot
3. user then zooms around and interacts with the plot

To that end we really only need to deliver a handful of things from WASM:

- we have the existing dbc as json export to populate the UI and provide names for all the signals. This is done and works; the user can select a signal from this list.
- we export a tiny amount of trace metadata as json; currently the only thing I can think of here is the parsed start time of the measurement (so we can configure the axes correctly)
- When the user selects a signal, we call a WASM function along the lines of `get_signal_values(dbc_handle, signal_name, trace_handle)` which returns a binary blob or json set of `(timestamp, value)` tuples for that given signal. The UI can then take this and plot it.

I believe this should be literally all we need in order to make a basic viewer.
