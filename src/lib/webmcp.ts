import {
	capturePlotImage,
	copyPlotImage,
	plotImageFilename,
	savePlotImage
} from '$lib/plot-image-export.js';
import { buildSelectorSearchIndexes, dbcFiles } from '$lib/stores/dbc-files.svelte.js';
import { plotData } from '$lib/stores/plot-data.svelte.js';
import { traceFile } from '$lib/stores/trace-file.svelte.js';
import {
	createWebMcpTools,
	throwIfAborted,
	type WebMcpHost,
	type WebMcpTool
} from '$lib/webmcp-tools.js';
import type { CrosshairId } from '$lib/plot-crosshair.js';
import type { ShortcutAction, ShortcutState } from '$lib/keyboard-shortcuts.js';
import type { PlotViewport } from '$lib/plot-viewport.js';

export type { WebMcpTool, WebMcpToolName } from '$lib/webmcp-tools.js';
export { WEBMCP_SHORTCUT_TOOLS, WEBMCP_TOOL_NAMES } from '$lib/webmcp-tools.js';

/** Page-owned actions the tools cannot read from stores alone. */
export type WebMcpPageHost = {
	shortcutState: () => ShortcutState;
	runShortcut: (action: ShortcutAction) => void;
	openDbcPicker: () => void;
	placeCrosshair: (id: CrosshairId, x?: number) => { x: number; y: number } | null;
	view: () => {
		legendVisible: boolean;
		boxZoomEnabled: boolean;
		viewport: PlotViewport | null;
		isFitAll: boolean;
		crosshairs: ReadonlyArray<{ id: CrosshairId; x: number; y: number }>;
	};
};

type ModelContext = {
	registerTool: (
		tool: {
			name: string;
			title?: string;
			description: string;
			inputSchema?: object;
			execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown>;
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

/**
 * Feature-detect `document.modelContext` and register the draft tool set.
 * Aborting the returned controller unregisters every tool.
 */
export function mountWebMcp(
	page: WebMcpPageHost,
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

function storeBackedHost(page: WebMcpPageHost): WebMcpHost {
	return {
		...page,
		signalCatalog: () => [
			...buildSelectorSearchIndexes(dbcFiles.selectorFiles),
			...traceFile.mf4SelectorIndexes
		],
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
				plotted: plotData.signals.map((item) => {
					const decode = plotData.signalDecodeStatus(item.key);
					return {
						key: item.key,
						label: item.label,
						unit: item.unit,
						decodeStatus: decode.isDecoding
							? ('decoding' as const)
							: decode.decodeError !== null
								? ('error' as const)
								: item.series !== null
									? ('ready' as const)
									: ('idle' as const),
						decodeError: decode.decodeError
					};
				})
			};
		},
		exportPlot: (destination, signal) => exportPlotFromDom(destination, signal)
	};
}

async function exportPlotFromDom(
	destination: 'copy' | 'save',
	signal: AbortSignal
): Promise<Record<string, unknown>> {
	throwIfAborted(signal);
	if (typeof document === 'undefined') {
		return { ok: false, error: 'Plot export is only available in the browser.' };
	}

	const root = document.querySelector<HTMLElement>('[data-plot-export-root]');
	if (root === null) {
		return {
			ok: false,
			error: 'No plot is on screen. Open a trace and select signals first.'
		};
	}

	try {
		const image = capturePlotImage(root);
		throwIfAborted(signal);
		if (destination === 'copy') {
			await copyPlotImage(image);
			throwIfAborted(signal);
			return {
				ok: true,
				destination,
				message: 'Copied the current plot image to the clipboard. Image bytes are not returned.'
			};
		}

		const filename = plotImageFilename(traceFile.displayName);
		await savePlotImage(image, filename);
		throwIfAborted(signal);
		return {
			ok: true,
			destination,
			filename,
			message: `Triggered download of ${filename}. Image bytes are not returned.`
		};
	} catch (error) {
		throwIfAborted(signal);
		return {
			ok: false,
			error: error instanceof Error ? error.message : 'Plot export failed.'
		};
	}
}
