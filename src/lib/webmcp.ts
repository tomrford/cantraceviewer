import { displayDbcName } from '@/lib/dbc-file-types';
import type { LegendCrosshairMode } from '@/lib/plot/plot-crosshair';
import { PRIMARY_Y_AXIS_ID } from '@/lib/plot/y-axis';
import { countSignals } from '@/lib/utils';
import {
	createWebMcpTools,
	type WebMcpCrosshairInput,
	type WebMcpTimeRange,
	type WebMcpTool
} from '@/lib/webmcp-tools';
import { addAxis, assignAxis } from '@/store/plot-axes';
import { isSignalSelected, signalDecodeStatus, toggleSignal } from '@/store/plot-data';
import { resetZoom, setCrosshairs, setViewport } from '@/store/plot-view';
import { appStore } from '@/store/store';

export type ModelContext = {
	registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => Promise<void>;
};

declare global {
	interface Document {
		readonly modelContext?: ModelContext;
	}
}

export function mountWebMcp(context: ModelContext | undefined = document.modelContext): () => void {
	if (typeof context?.registerTool !== 'function') return () => {};

	const controller = new AbortController();
	void registerTools(context, createWebMcpTools(storeHost), controller.signal);
	return () => controller.abort();
}

async function registerTools(
	context: ModelContext,
	tools: WebMcpTool[],
	signal: AbortSignal
): Promise<void> {
	for (const tool of tools) {
		if (signal.aborted) return;
		try {
			await context.registerTool(tool, { signal });
		} catch (error) {
			if (signal.aborted) return;
			console.warn(`WebMCP: failed to register ${tool.name}`, error);
		}
	}
}

/** WebMCP host backed directly by the app stores, so tools see the same plot as the page. */
export const storeHost = {
	view: () => {
		const domain = appStore.getState().plotModel.fullDomain;
		const {
			activeViewport: active,
			axisRanges,
			crosshairs,
			legendCrosshairMode
		} = appStore.getState();
		return {
			timeDomainMs: domain === null ? null : { startMs: domain.xMin, endMs: domain.xMax },
			timeWindowMs: active === null ? null : { startMs: active.xMin, endMs: active.xMax },
			isFullTimeRange:
				domain !== null && active?.xMin === domain.xMin && active.xMax === domain.xMax,
			axes: appStore.getState().axisIds.map((id, index) => ({
				axis: index + 1,
				range: axisRanges.get(id) ?? null
			})),
			crosshairs: crosshairs.map(({ id, x, y }) => ({ id, timeMs: x, value: y })),
			readout: legendCrosshairMode
		};
	},
	setTimeWindow: (range: WebMcpTimeRange | null) => {
		const active = appStore.getState().activeViewport;
		if (active === null) return null;
		if (range === null) resetZoom();
		else setViewport({ ...active, xMin: range.startMs, xMax: range.endMs });
		const applied = appStore.getState().activeViewport;
		return applied === null ? null : { startMs: applied.xMin, endMs: applied.xMax };
	},
	setCrosshairs: (markers: WebMcpCrosshairInput[], readout?: LegendCrosshairMode) => {
		const { activeViewport: active, crosshairs } = appStore.getState();
		const centreY = active === null ? 0 : (active.yMin + active.yMax) / 2;
		setCrosshairs(
			markers
				.map(({ id, timeMs, value }) => ({
					id,
					x: timeMs,
					y: value ?? crosshairs.find((marker) => marker.id === id)?.y ?? centreY
				}))
				.sort((a, b) => a.id - b.id),
			readout
		);
	},
	setSignalAxes: (assignments: Array<{ key: string; axis: number }>) => {
		for (const { key, axis } of assignments) {
			// addAxis refuses past the axis limit; stop rather than wait for an axis that cannot exist.
			while (appStore.getState().axisIds.length < axis) {
				if (addAxis() === null) break;
			}
			assignAxis(key, appStore.getState().axisIds[axis - 1]);
		}
	},
	signalCatalog: () => appStore.getState().selectorSearchIndexes,
	plottedSignals: () => appStore.getState().signals,
	isSignalSelected,
	toggleSignal,
	session: () => {
		const {
			trace,
			traceName: displayName,
			traceWarning: warning,
			openingTrace: isLoading,
			dbcFiles: files,
			hasLoadedLibrary,
			dbcLoading,
			axisIds: ids,
			axisAssignment: assignment
		} = appStore.getState();
		const nativeCount = countSignals(trace?.mf4Catalog?.groups ?? []);
		return {
			trace:
				trace === null
					? null
					: {
							name: displayName,
							fileName: trace.file.name,
							hasRawFrames: trace.hasRawFrames,
							validMessageCount: trace.metadata.validMessageCount,
							skippedLineCount: trace.metadata.skippedLineCount,
							durationNs: trace.metadata.durationNs,
							durationMs:
								trace.metadata.durationNs === null ? null : trace.metadata.durationNs / 1_000_000,
							measurementStartMs: trace.metadata.measurementStartMs,
							mf4NativeSignalCount: nativeCount,
							warning
						},
			traceLoading: isLoading,
			dbcLibrary: { loaded: hasLoadedLibrary, loading: dbcLoading },
			dbcs: files.map((file) => ({
				name: displayDbcName(file.name),
				origin: file.origin,
				messageCount: file.catalog.messages.length,
				signalCount: countSignals(file.catalog.messages)
			})),
			plotted: appStore.getState().signals.map(({ signal, series }) => {
				const decode = signalDecodeStatus(signal.key);
				return {
					key: signal.key,
					label: signal.label,
					unit: signal.format.unit,
					axis: ids.indexOf(assignment.get(signal.key) ?? PRIMARY_Y_AXIS_ID) + 1,
					decodeStatus: decode.isDecoding
						? ('decoding' as const)
						: decode.decodeError !== null
							? ('error' as const)
							: series !== null
								? ('ready' as const)
								: ('idle' as const),
					decodeError: decode.decodeError
				};
			})
		};
	}
};
