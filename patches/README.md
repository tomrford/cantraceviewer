# Dependency patches

## chartgpu@0.3.3

The `patchedDependencies` setting in `pnpm-workspace.yaml` applies `chartgpu@0.3.3.patch` to the published minified bundle (`dist/index.js`). chartgpu stays pinned at 0.3.3; this file is the inventory of behavioral edits for re-rolling the patch or porting to a fork.

Identifiers below (`zc`, `Yc`, ...) are minifier names in the 0.3.3 bundle. Search `dist/index.js` inside `node_modules/chartgpu` after patching.

### 1. Disable built-in crosshair and hover tooltip

**Behavior.** ChartGPU never draws its internal crosshair or pointer-driven tooltip, even when the pointer is inside the plot grid.

**Why.** CAN Trace Viewer owns pointer interaction (custom marker, pan/box-zoom overlay) and already passes `tooltip: { show: false }`. The library still rendered a follow-cursor crosshair and tooltip branch on `source === "mouse"`, which fought the app cursor and duplicated UI we do not want.

**Source.** Commit [df6b4d49](https://github.com/tomrford/cantraceviewer/commit/df6b4d490bda8d682b4962309ff9564a18b9bb73) (`trying to make better cursor`). No PR.

**Anchors (`zc`).** In the grid/axis/crosshair prepare path inside `function zc(e, t)`:

- Crosshair prepare: `if (!1 && l.hasPointer && l.isInGrid) {` (~line 1977)
- Tooltip branch: `if (!1 && l.source === "mouse" && l.hasPointer && l.isInGrid)` (~line 1993)

`!1 &&` dead-codes both branches without removing downstream structure.

### 2. Gridline count follows axis tick count

**Behavior.** Horizontal and vertical gridline counts are taken from the axis tick generators instead of `gridLines.horizontal.count` / `gridLines.vertical.count` from options. ChartGPU 0.3.3 can have several y axes but still draws one shared grid, so horizontal gridlines follow the primary y axis (`yAxes[0].tickCount ?? kc`) and vertical gridlines follow the computed x tick count (`s`).

**Why.** Fixed counts in app config drifted from tick density as the viewport changed. The app now omits `horizontal.count` / `vertical.count` from `gridLines` and relies on the patch so gridlines stay aligned with computed ticks.

**Source.** Commit [75596bbb](https://github.com/tomrford/cantraceviewer/commit/75596bbb6cf5b1075c0865d988bee608de671572) (`further patching for dynamic gridlines`). No PR.

**Anchors (`zc`).** Grid prepare inside `function zc(e, t)`:

```js
} = t, f = n.gridLines, h = f.show && f.horizontal.show ? ((F = n.yAxes[0]) == null ? void 0 : F.tickCount) ?? kc : 0, p = f.show && f.vertical.show ? s : 0;
```

(~line 1931; stock uses `f.horizontal.count` and `f.vertical.count`.)

### 3. Point markers on unsampled line series

**Behavior.** For `type: "line"` series, when the rendered point count equals the raw point count, the count is positive, and the count is at most `samplingThreshold` (default 5000), ChartGPU prepares and renders 1.5px scatter markers in the line color on top of the line. Sampled or downsampled lines get an empty scatter pass (`symbolSize: 0`).

**Why.** Decoded CAN signals at full resolution should show individual samples; stock ChartGPU only drew strokes. Markers are gated so zoomed/sampled views do not paint millions of points.

**Source.** PR [#15](https://github.com/tomrford/cantraceviewer/pull/15), commit [eb9210c7](https://github.com/tomrford/cantraceviewer/commit/eb9210c793e74a5d678eccf5a0147e94174dd64a).

**Anchors.**

- `function Yc(e, t)` - `case "line":` prepare block (~line 2300): scatter `prepare` using `Ae(g.rawData ?? g.data)`, `Ae(A)`, `g.samplingThreshold`, and the same per-series y scale resolver `R(g)` as the line renderer; `symbolSize: 1.5` vs empty data / `symbolSize: 0`. Renames area-local `S` -> `P` to avoid shadowing the new marker threshold variable (no behavior change).
- `function qc(e, t, n, i)` - after the line render loop (~line 2545): extra loop `F.type === "line" && e.scatterRenderers[R].render(s)`.

App sets per-series `samplingThreshold` in `src/lib/signal-plot-data.ts`.

### 4. Axes with explicit bounds and no series

**Behavior.** Axis lines, ticks, and labels render when `xAxis` min/max and at least one `yAxes[]` min/max are all defined, even if `series` is empty (or only pie). The main chart instance also enters its data-present render path when those explicit bounds are set.

**Why.** After trace load, the plot should show time/value axes from trace duration before any signal is decoded. Stock ChartGPU skipped axis drawing unless at least one non-pie series existed.

**Source.** PR [#45](https://github.com/tomrford/cantraceviewer/pull/45), commit [8ea6bf18](https://github.com/tomrford/cantraceviewer/commit/8ea6bf18a608f9efa807fcb2b83aa096c2f6b80d).

**Anchors.**

- `function hc(e, t, n)` - x-axis DOM label overlay early return (~line 1330): bail out when there are no non-pie series **and** no y axis has explicit x/y bounds. (`mr` ~= "bound provided".)
- `function vc(e, t, n)` - annotation/canvas overlay early return (~line 1477): same guard using `i.xAxis` and `i.yAxes`.
- Render loop inside the coordinator (~line 9568): `k = p.series.some(... "pie") || p.yAxes.some(...)` (`br` ~= defined check) so animation/layout runs with bounds-only options.

App supplies bounds via `traceDurationDomain` / viewport in `src/lib/components/signal-plot.svelte`.

## svelte-check@4.7.1

The workspace keeps TypeScript 6 as `typescript` for tools that use its JavaScript API and installs the native TypeScript 7 compiler as the `@typescript/native` npm alias. The `check` scripts pass `--tsgo-experimental-api` so Svelte diagnostics use TypeScript 7.

The patch lets `svelte-check` discover that alias while retaining support for `@typescript/native-preview`. It is the focused compatibility change from the pending upstream [sveltejs/language-tools#3073](https://github.com/sveltejs/language-tools/pull/3073) and can be removed when a release containing that change satisfies the workspace minimum-release-age policy.
