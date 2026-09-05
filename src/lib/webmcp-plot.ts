import { tick } from 'svelte';
import type { LegendCrosshairMode, PlotCrosshair } from './plot-crosshair.js';
import type { PlotViewportState } from './plot-viewport-state.svelte.js';
import { plotAxes } from './stores/plot-axes.svelte.js';
import type { WebMcpHost } from './webmcp-tools.js';

export type WebMcpPlotHost = Pick<
	WebMcpHost,
	'view' | 'setTimeWindow' | 'setCrosshairs' | 'setSignalAxes'
>;

/** Share the page's existing plot state with tools without synthesising gestures. */
export function createWebMcpPlotHost(
	viewport: PlotViewportState,
	state: { crosshairs: PlotCrosshair[]; readout: LegendCrosshairMode }
): WebMcpPlotHost {
	return {
		view: () => {
			const domain = viewport.fullDomain;
			const active = viewport.activeViewport;
			return {
				timeDomainMs: domain === null ? null : { startMs: domain.xMin, endMs: domain.xMax },
				timeWindowMs: active === null ? null : { startMs: active.xMin, endMs: active.xMax },
				isFullTimeRange:
					domain !== null && active?.xMin === domain.xMin && active.xMax === domain.xMax,
				axes: plotAxes.ids.map((id, index) => ({
					axis: index + 1,
					range:
						index === 0
							? active === null
								? null
								: { min: active.yMin, max: active.yMax }
							: (viewport.secondaryRanges.get(id) ?? null)
				})),
				crosshairs: state.crosshairs.map(({ id, x, y }) => ({ id, timeMs: x, value: y })),
				readout: state.readout
			};
		},
		setTimeWindow: (range) => {
			const active = viewport.activeViewport;
			if (active === null) return null;
			if (range === null) viewport.reset();
			else viewport.setManual({ ...active, xMin: range.startMs, xMax: range.endMs });
			const applied = viewport.activeViewport;
			return applied === null ? null : { startMs: applied.xMin, endMs: applied.xMax };
		},
		setCrosshairs: (markers, readout) => {
			const active = viewport.activeViewport;
			const centreY = active === null ? 0 : (active.yMin + active.yMax) / 2;
			state.crosshairs = markers
				.map(({ id, timeMs, value }) => ({
					id,
					x: timeMs,
					y: value ?? state.crosshairs.find((marker) => marker.id === id)?.y ?? centreY
				}))
				.sort((a, b) => a.id - b.id);
			const has = (id: number) => markers.some((marker) => marker.id === id);
			const previousValid =
				state.readout === 'delta' ? markers.length === 2 : has(state.readout === 'c1' ? 1 : 2);
			state.readout =
				readout ?? (previousValid ? state.readout : has(1) ? 'c1' : has(2) ? 'c2' : 'c1');
		},
		setSignalAxes: async (assignments) => {
			for (const { key, axis } of assignments) {
				while (plotAxes.ids.length < axis) plotAxes.addAxis();
				plotAxes.assign(key, plotAxes.ids[axis - 1]);
			}
			// Let the plot recompute its fit domains before reporting applied ranges.
			await tick();
		}
	};
}
