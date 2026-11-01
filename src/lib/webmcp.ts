import { PRIMARY_Y_AXIS_ID } from '#lib/plot-axes.js';
import { dbcFiles } from '#lib/stores/dbc-files.js';
import { addAxis, assignAxis, plotAxes } from '#lib/stores/plot-axes.js';
import {
	isSignalSelected,
	plotData,
	signalDecodeStatus,
	toggleSignal
} from '#lib/stores/plot-data.js';
import { plotModel } from '#lib/stores/plot-model.js';
import { plotView, resetZoom, setCrosshairs, setViewport } from '#lib/stores/plot-view.js';
import { traceFile } from '#lib/stores/trace-file.js';
import { createWebMcpTools, type WebMcpHost, type WebMcpTool } from '#lib/webmcp-tools.js';

type ModelContext = {
	registerTool: (
		tool: {
			name: string;
			title?: string;
			description: string;
			inputSchema?: object;
			execute: (input: object, options?: { signal?: AbortSignal }) => Promise<unknown>;
			annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
		},
		options?: { signal?: AbortSignal }
	) => Promise<void>;
};

declare global {
	interface Document {
		readonly modelContext?: ModelContext;
	}
}

export function documentModelContext(): ModelContext | null {
	if (typeof document === 'undefined') return null;
	const context = document.modelContext;
	if (context === undefined || typeof context.registerTool !== 'function') return null;
	return context;
}

export function mountWebMcp(context: ModelContext | null = documentModelContext()): () => void {
	if (context === null) return () => {};

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
export const storeHost: WebMcpHost = {
	view: () => {
		const domain = plotModel.getState().fullDomain;
		const {
			activeViewport: active,
			axisRanges,
			crosshairs,
			legendCrosshairMode
		} = plotView.getState();
		return {
			timeDomainMs: domain === null ? null : { startMs: domain.xMin, endMs: domain.xMax },
			timeWindowMs: active === null ? null : { startMs: active.xMin, endMs: active.xMax },
			isFullTimeRange:
				domain !== null && active?.xMin === domain.xMin && active.xMax === domain.xMax,
			axes: plotAxes.getState().ids.map((id, index) => ({
				axis: index + 1,
				range: axisRanges.get(id) ?? null
			})),
			crosshairs: crosshairs.map(({ id, x, y }) => ({ id, timeMs: x, value: y })),
			readout: legendCrosshairMode
		};
	},
	setTimeWindow: (range) => {
		const active = plotView.getState().activeViewport;
		if (active === null) return null;
		if (range === null) resetZoom();
		else setViewport({ ...active, xMin: range.startMs, xMax: range.endMs });
		const applied = plotView.getState().activeViewport;
		return applied === null ? null : { startMs: applied.xMin, endMs: applied.xMax };
	},
	setCrosshairs: (markers, readout) => {
		const { activeViewport: active, crosshairs, legendCrosshairMode } = plotView.getState();
		const centreY = active === null ? 0 : (active.yMin + active.yMax) / 2;
		const has = (id: number) => markers.some((marker) => marker.id === id);
		const previousValid =
			legendCrosshairMode === 'delta'
				? markers.length === 2
				: has(legendCrosshairMode === 'c1' ? 1 : 2);
		setCrosshairs(
			markers
				.map(({ id, timeMs, value }) => ({
					id,
					x: timeMs,
					y: value ?? crosshairs.find((marker) => marker.id === id)?.y ?? centreY
				}))
				.sort((a, b) => a.id - b.id),
			readout ?? (previousValid ? legendCrosshairMode : has(1) ? 'c1' : has(2) ? 'c2' : 'c1')
		);
	},
	setSignalAxes: async (assignments) => {
		for (const { key, axis } of assignments) {
			while (plotAxes.getState().ids.length < axis) addAxis();
			assignAxis(key, plotAxes.getState().ids[axis - 1]);
		}
	},
	signalCatalog: () => [
		...dbcFiles.getState().selectorSearchIndexes,
		...traceFile.getState().mf4SelectorIndexes
	],
	plottedSignals: () =>
		plotData
			.getState()
			.signals.flatMap((signal) =>
				signal.series === null ? [] : [{ ...signal, series: signal.series }]
			),
	isSignalSelected,
	toggleSignal,
	dbcLibrary: () => {
		const { hasLoadedLibrary, isLoading } = dbcFiles.getState();
		return { loaded: hasLoadedLibrary, loading: isLoading };
	},
	session: () => {
		const { entry: trace, displayName, warning, isLoading } = traceFile.getState();
		const { files, hasLoadedLibrary, isLoading: dbcLoading } = dbcFiles.getState();
		const { ids, assignment } = plotAxes.getState();
		const nativeCount =
			trace?.mf4Catalog?.groups.reduce((count, group) => count + group.signals.length, 0) ?? 0;
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
				name: file.name.replace(/\.dbc$/i, ''),
				origin: file.origin,
				messageCount: file.catalog.messages.length,
				signalCount: file.catalog.messages.reduce(
					(count, message) => count + message.signals.length,
					0
				)
			})),
			plotted: plotData.getState().signals.map((signal) => {
				const decode = signalDecodeStatus(signal.key);
				return {
					key: signal.key,
					label: signal.label,
					unit: signal.unit,
					axis: ids.indexOf(assignment.get(signal.key) ?? PRIMARY_Y_AXIS_ID) + 1,
					decodeStatus: decode.isDecoding
						? ('decoding' as const)
						: decode.decodeError !== null
							? ('error' as const)
							: signal.series !== null
								? ('ready' as const)
								: ('idle' as const),
					decodeError: decode.decodeError
				};
			})
		};
	}
};
