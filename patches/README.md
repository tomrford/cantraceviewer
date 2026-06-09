# chartgpu@0.3.2 patch

Bun `patchedDependencies` applies `chartgpu@0.3.2.patch` to the published minified bundle (`dist/index.js`). chartgpu stays pinned at 0.3.2; this file is the inventory of behavioral edits for re-rolling the patch or porting to a fork.

Identifiers below (`Ic`, `oc`, …) are minifier names in the 0.3.2 bundle. Search `dist/index.js` inside `node_modules/chartgpu` after patching.

## 1. Disable built-in crosshair and hover tooltip

**Behavior.** ChartGPU never draws its internal crosshair or pointer-driven tooltip, even when the pointer is inside the plot grid.

**Why.** CAN Trace Viewer owns pointer interaction (custom marker, pan/box-zoom overlay) and already passes `tooltip: { show: false }`. The library still rendered a follow-cursor crosshair and tooltip branch on `source === "mouse"`, which fought the app cursor and duplicated UI we do not want.

**Source.** Commit [df6b4d49](https://github.com/tomrford/cantraceviewer/commit/df6b4d490bda8d682b4962309ff9564a18b9bb73) (`trying to make better cursor`). No PR.

**Anchors (`Ic`).** In the grid/axis/crosshair prepare path inside `function Ic(e, t)`:

- Crosshair prepare: `)), !1 && c.hasPointer && c.isInGrid) {` (~line 1708)
- Tooltip branch: `if (!1 && c.source === "mouse" && c.hasPointer && c.isInGrid)` (~line 1719)

`!1 &&` dead-codes both branches without removing downstream structure.

## 2. Gridline count follows axis tick count

**Behavior.** Horizontal and vertical gridline counts are taken from the axis tick generators (`Nc` for horizontal, `s` for vertical in this hunk) instead of `gridLines.horizontal.count` / `gridLines.vertical.count` from options.

**Why.** Fixed counts in app config drifted from tick density as the viewport changed. The app now omits `horizontal.count` / `vertical.count` from `gridLines` and relies on the patch so gridlines stay aligned with computed ticks.

**Source.** Commit [75596bbb](https://github.com/tomrford/cantraceviewer/commit/75596bbb6cf5b1075c0865d988bee608de671572) (`further patching for dynamic gridlines`). No PR.

**Anchors (`Ic`).** Grid prepare inside `function Ic(e, t)`:

```js
} = t, u = n.gridLines, y = u.show && u.horizontal.show ? Nc : 0, p = u.show && u.vertical.show ? s : 0;
```

(~line 1673; stock uses `u.horizontal.count` and `u.vertical.count`.)

## 3. Point markers on unsampled line series

**Behavior.** For `type: "line"` series, when the rendered point count equals the raw point count, the count is positive, and the count is at most `samplingThreshold` (default 5000), ChartGPU prepares and renders 1.5px scatter markers in the line color on top of the line. Sampled or downsampled lines get an empty scatter pass (`symbolSize: 0`).

**Why.** Decoded CAN signals at full resolution should show individual samples; stock ChartGPU only drew strokes. Markers are gated so zoomed/sampled views do not paint millions of points.

**Source.** PR [#15](https://github.com/tomrford/cantraceviewer/pull/15), commit [eb9210c7](https://github.com/tomrford/cantraceviewer/commit/eb9210c793e74a5d678eccf5a0147e94174dd64a).

**Anchors.**

- `function Lc(e, t)` — `case "line":` prepare block (~line 1964): scatter `prepare` using `Ne(x.rawData ?? x.data)`, `Ne(v)`, and `x.samplingThreshold`; `symbolSize: 1.5` vs empty data / `symbolSize: 0`. Renames area-local `h` → `P` to avoid shadowing the new `h` length variable (no behavior change).
- `function kc(e, t, n, i)` — after the line render loop (~line 2108): extra loop `M.type === "line" && e.scatterRenderers[R].render(s)`.

App sets per-series `samplingThreshold` in `src/lib/signal-plot-data.ts`.

## 4. Axes with explicit bounds and no series

**Behavior.** Axis lines, ticks, and labels render when `xAxis`/`yAxis` min and max are all defined, even if `series` is empty (or only pie). The main chart instance also enters its data-present render path when all four bounds are set.

**Why.** After trace load, the plot should show time/value axes from trace duration before any signal is decoded. Stock ChartGPU skipped axis drawing unless at least one non-pie series existed.

**Source.** PR [#45](https://github.com/tomrford/cantraceviewer/pull/45), commit [8ea6bf18](https://github.com/tomrford/cantraceviewer/commit/8ea6bf18a608f9efa807fcb2b83aa096c2f6b80d).

**Anchors.**

- `function oc(e, t, n)` — early return (~line 1160): bail out when there are no non-pie series **and** any of `Li(r.xAxis.min|max)`, `Li(r.yAxis.min|max)` is unset (`=== void 0`). (`Li` ≈ “bound provided”.)
- `function lc(e, t, n)` — same guard on the canvas axis path (~line 1266), using `Li(i.xAxis…)` / `Li(i.yAxis…)`.
- `function Of(e, t, n)` — render-loop flag (~line 7927): `k = p.series.some(… "pie") || gn(p.xAxis.min) !== void 0 && …` (`gn` ≈ defined check) so animation/layout runs with bounds-only options.

App supplies bounds via `traceDurationDomain` / viewport in `src/lib/components/signal-plot.svelte`.
