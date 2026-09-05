import { buildSelectorSearchIndexes, dbcFiles } from '$lib/stores/dbc-files.svelte.js';
import { plotData } from '$lib/stores/plot-data.svelte.js';
import { traceFile } from '$lib/stores/trace-file.svelte.js';
import { plotAxes } from '$lib/stores/plot-axes.svelte.js';
import { PRIMARY_Y_AXIS_ID } from '$lib/plot-axes.js';
import type { WebMcpPlotHost } from '$lib/webmcp-plot.js';
import { createWebMcpTools, type WebMcpHost, type WebMcpTool } from '$lib/webmcp-tools.js';

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

/** Feature-detect `document.modelContext` and register the bounded analysis tools. */
export function mountWebMcp(
	page: WebMcpPlotHost,
	context: ModelContext | null = documentModelContext()
): () => void {
	if (context === null) return () => {};

	const controller = new AbortController();
	const tools = createWebMcpTools(storeBackedHost(page));
	void registerTools(context, tools, controller.signal);
	return () => controller.abort();
}

export async function registerTools(
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

function storeBackedHost(page: WebMcpPlotHost): WebMcpHost {
	return {
		...page,
		signalCatalog: () => [
			...buildSelectorSearchIndexes(dbcFiles.selectorFiles),
			...traceFile.mf4SelectorIndexes
		],
		plottedSignals: () =>
			plotData.signals.flatMap((signal) =>
				signal.series === null ? [] : [{ ...signal, series: signal.series }]
			),
		isSignalSelected: (key) => plotData.isSignalSelected(key),
		toggleSignal: (key) => plotData.toggleSignal(key),
		dbcLibrary: () => ({
			loaded: dbcFiles.hasLoadedLibrary,
			loading: dbcFiles.isLoading
		}),
		session: () => {
			const trace = traceFile.entry;
			const nativeCount =
				trace?.mf4Catalog?.groups.reduce((count, group) => count + group.signals.length, 0) ?? 0;
			return {
				trace:
					trace === null
						? null
						: {
								name: traceFile.displayName,
								fileName: trace.file.name,
								hasRawFrames: trace.hasRawFrames,
								validMessageCount: trace.metadata.validMessageCount,
								skippedLineCount: trace.metadata.skippedLineCount,
								durationNs: trace.metadata.durationNs,
								durationMs:
									trace.metadata.durationNs === null ? null : trace.metadata.durationNs / 1_000_000,
								measurementStartMs: trace.metadata.measurementStartMs,
								mf4NativeSignalCount: nativeCount,
								warning: traceFile.warning
							},
				traceLoading: traceFile.isLoading,
				dbcLibrary: {
					loaded: dbcFiles.hasLoadedLibrary,
					loading: dbcFiles.isLoading
				},
				dbcs: dbcFiles.files.map((file) => ({
					name: file.name.replace(/\.dbc$/i, ''),
					origin: file.origin,
					messageCount: file.catalog.messages.length,
					signalCount: file.catalog.messages.reduce(
						(count, message) => count + message.signals.length,
						0
					)
				})),
				plotted: plotData.signals.map((signal) => {
					const decode = plotData.signalDecodeStatus(signal.key);
					return {
						key: signal.key,
						label: signal.label,
						unit: signal.unit,
						axis:
							plotAxes.ids.indexOf(plotAxes.assignment.get(signal.key) ?? PRIMARY_Y_AXIS_ID) + 1,
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
}
