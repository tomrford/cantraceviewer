import {
	shortcutEnabled,
	type ShortcutAction,
	type ShortcutState
} from '$lib/keyboard-shortcuts.js';
import { searchIndex } from '$lib/search-index.js';
import type { CrosshairId } from '$lib/plot-crosshair.js';
import type { PlotViewport } from '$lib/plot-viewport.js';
import type { SelectorSearchIndex } from '$lib/stores/dbc-files.svelte.js';

export const SEARCH_RESULT_LIMIT_MAX = 50;
export const SEARCH_RESULT_LIMIT_DEFAULT = 25;

export const WEBMCP_TOOL_NAMES = [
	'describe_session',
	'search_signals',
	'select_signals',
	'open_trace',
	'add_dbc',
	'open_signal_selector',
	'zoom_in',
	'zoom_out',
	'reset_zoom',
	'toggle_box_zoom',
	'toggle_legend',
	'place_c1',
	'place_c2',
	'clear_crosshairs',
	'export_plot',
	'open_settings',
	'show_help'
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];

export const WEBMCP_SHORTCUT_TOOLS = {
	open_trace: 'openTrace',
	open_signal_selector: 'selectSignals',
	zoom_in: 'zoomIn',
	zoom_out: 'zoomOut',
	reset_zoom: 'resetZoom',
	toggle_box_zoom: 'toggleBoxZoom',
	toggle_legend: 'toggleLegend',
	place_c1: 'placeC1',
	place_c2: 'placeC2',
	clear_crosshairs: 'clearCrosshairs',
	open_settings: 'openSettings',
	show_help: 'showHelp'
} as const satisfies Partial<Record<WebMcpToolName, ShortcutAction>>;

export type WebMcpView = {
	legendVisible: boolean;
	boxZoomEnabled: boolean;
	viewport: PlotViewport | null;
	isFitAll: boolean;
	crosshairs: ReadonlyArray<{ id: CrosshairId; x: number; y: number }>;
};

export type WebMcpHost = {
	shortcutState: () => ShortcutState;
	runShortcut: (action: ShortcutAction) => void;
	openDbcPicker: () => void;
	placeCrosshair: (id: CrosshairId, x?: number) => { x: number; y: number } | null;
	view: () => WebMcpView;
	signalCatalog: () => SelectorSearchIndex[];
	isSignalSelected: (key: string) => boolean;
	toggleSignal: (key: string) => Promise<void>;
	session: () => WebMcpSessionSnapshot;
	dbcLibrary: () => { loaded: boolean; loading: boolean };
	exportPlot: (
		destination: 'copy' | 'save',
		signal: AbortSignal
	) => Promise<Record<string, unknown>>;
};

export type WebMcpSessionSnapshot = {
	trace: {
		name: string;
		fileName: string;
		hasRawFrames: boolean;
		validMessageCount: number;
		skippedLineCount: number;
		durationNs: number | null;
		durationMs: number | null;
		measurementStartMs: number | null;
		mf4NativeSignalCount: number;
		warning: string | null;
	} | null;
	traceLoading: boolean;
	dbcLibrary: { loaded: boolean; loading: boolean };
	dbcs: Array<{
		name: string;
		origin: 'library' | 'mf4';
		messageCount: number;
		signalCount: number;
	}>;
	plotted: Array<{
		key: string;
		label: string;
		unit: string;
		decodeStatus: 'idle' | 'decoding' | 'ready' | 'error';
		decodeError: string | null;
	}>;
};

export type WebMcpTool = {
	name: WebMcpToolName;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
	execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown>;
};

type CatalogSignal = SelectorSearchIndex['signals']['items'][number]['signal'] & {
	dbcName: string;
};

const EMPTY_OBJECT_SCHEMA = {
	type: 'object',
	additionalProperties: false
} as const;

export function consumeMountRequest(
	request: number,
	lastHandled: number,
	ready: boolean
): number | null {
	if (request === 0 || request === lastHandled || !ready) return null;
	return request;
}

export function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('The operation was aborted.', 'AbortError');
}

export function describeSession(snapshot: WebMcpSessionSnapshot, view: WebMcpView) {
	return {
		trace: snapshot.trace,
		traceLoading: snapshot.traceLoading,
		dbcLibrary: snapshot.dbcLibrary,
		dbcs: snapshot.dbcs,
		plotted: snapshot.plotted.map(({ key, label, unit, decodeStatus, decodeError }) => ({
			key,
			label,
			unit,
			decodeStatus,
			decodeError
		})),
		view: {
			legendVisible: view.legendVisible,
			boxZoomEnabled: view.boxZoomEnabled,
			isFitAll: view.isFitAll,
			viewport: view.viewport,
			crosshairs: view.crosshairs
		},
		notes: [
			'This is a read-only summary. Decoded sample arrays are not returned; inspect the plot visually.',
			'open_trace and add_dbc open the browser file picker. They do not accept a filesystem path.',
			'search_signals then select_signals are the way to plot signals in batch.',
			...(snapshot.dbcLibrary.loaded
				? []
				: [
						'The saved DBC library has not finished loading. An empty dbcs list is not the final catalog.'
					])
		]
	};
}

export function searchCatalogSignals(
	indexes: SelectorSearchIndex[],
	query: string,
	isSignalSelected: (key: string) => boolean,
	limit: number,
	library: { loaded: boolean; loading: boolean } = { loaded: true, loading: false }
) {
	const cappedLimit = clampLimit(limit);
	const hits: Array<{
		key: string;
		label: string;
		messageName: string;
		signalName: string;
		arbitrationId: string | null;
		selected: boolean;
		source: string;
	}> = [];

	for (const index of indexes) {
		for (const { signal } of searchIndex(index.signals, query)) {
			hits.push({
				key: signal.key,
				label: signal.label,
				messageName: signal.messageName,
				signalName: signal.signalName,
				arbitrationId: signal.arbitrationId ?? null,
				selected: isSignalSelected(signal.key),
				source: index.dbc.name
			});
			if (hits.length >= cappedLimit) {
				return searchResult(query, cappedLimit, true, hits, library);
			}
		}
	}

	return searchResult(query, cappedLimit, false, hits, library);
}

function searchResult(
	query: string,
	limit: number,
	truncated: boolean,
	results: Array<{
		key: string;
		label: string;
		messageName: string;
		signalName: string;
		arbitrationId: string | null;
		selected: boolean;
		source: string;
	}>,
	library: { loaded: boolean; loading: boolean }
) {
	return {
		query,
		limit,
		truncated,
		results,
		libraryLoaded: library.loaded,
		libraryLoading: library.loading,
		...(library.loaded
			? {}
			: {
					note: 'The saved DBC library has not finished loading. Empty results are not a complete catalog; call describe_session or search again after dbcLibrary.loaded is true.'
				})
	};
}

export function resolveSignalRefs(indexes: SelectorSearchIndex[], refs: string[]) {
	const catalog = flattenCatalog(indexes);
	const byKey = new Map<string, CatalogSignal>();
	const byLabel = new Map<string, CatalogSignal[]>();

	for (const signal of catalog) {
		byKey.set(signal.key, signal);
		const labelKey = signal.label.toLowerCase();
		const matches = byLabel.get(labelKey);
		if (matches) matches.push(signal);
		else byLabel.set(labelKey, [signal]);
	}

	const resolved: CatalogSignal[] = [];
	const missing: string[] = [];
	const ambiguous: Array<{
		ref: string;
		matches: Array<{ key: string; label: string; source: string }>;
	}> = [];
	const seen = new Set<string>();

	for (const ref of refs) {
		const exactKey = byKey.get(ref);
		const labelMatches = exactKey ? [exactKey] : (byLabel.get(ref.toLowerCase()) ?? []);
		if (labelMatches.length === 0) {
			missing.push(ref);
			continue;
		}
		if (labelMatches.length > 1) {
			ambiguous.push({
				ref,
				matches: labelMatches.map((signal) => ({
					key: signal.key,
					label: signal.label,
					source: signal.dbcName
				}))
			});
			continue;
		}
		const signal = labelMatches[0];
		if (seen.has(signal.key)) continue;
		seen.add(signal.key);
		resolved.push(signal);
	}

	return { resolved, missing, ambiguous };
}

export function createWebMcpTools(host: WebMcpHost): WebMcpTool[] {
	return [
		{
			name: 'describe_session',
			title: 'Describe session',
			description:
				'Read-only summary of the current CAN Trace Viewer tab: loaded trace name and duration, message counts, saved/embedded DBC files, currently plotted signal labels, and view state (viewport, legend, box zoom, crosshairs). Does not return decoded sample arrays, DBC source, WASM handles, or IndexedDB internals. Inspect the plot visually for values.',
			inputSchema: EMPTY_OBJECT_SCHEMA,
			annotations: { readOnlyHint: true },
			execute: (_input, { signal }) => {
				throwIfAborted(signal);
				return Promise.resolve(describeSession(host.session(), host.view()));
			}
		},
		{
			name: 'search_signals',
			title: 'Search signals',
			description:
				'Search the signal selector catalog with the same matching rules as the in-page selector (AND of whitespace-separated terms, name substrings, hex CAN IDs). Returns key, Message.Signal label, hex arbitration ID, source file, and whether it is currently plotted. Hard-capped; pass the key to select_signals. Does not return decoded values.',
			inputSchema: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						minLength: 1,
						description:
							'Selector search text, for example EngineSpeed, EEC1.EngineSpeed, or a hex CAN ID such as 0x18fef100.'
					},
					limit: {
						type: 'integer',
						minimum: 1,
						maximum: SEARCH_RESULT_LIMIT_MAX,
						description: `Maximum hits to return. Default ${SEARCH_RESULT_LIMIT_DEFAULT}, max ${SEARCH_RESULT_LIMIT_MAX}.`
					}
				},
				required: ['query'],
				additionalProperties: false
			},
			annotations: { readOnlyHint: true },
			execute: (input, { signal }) => {
				throwIfAborted(signal);
				const query = requiredString(input, 'query');
				if (query === null) {
					return Promise.resolve({ ok: false, error: 'query must be a non-empty string.' });
				}
				const limit = optionalInteger(input, 'limit') ?? SEARCH_RESULT_LIMIT_DEFAULT;
				return Promise.resolve(
					searchCatalogSignals(
						host.signalCatalog(),
						query,
						host.isSignalSelected,
						limit,
						host.dbcLibrary()
					)
				);
			}
		},
		{
			name: 'select_signals',
			title: 'Select signals',
			description:
				'Select, deselect, or toggle plotted signals in batch. Identify each signal by the key from search_signals or by its Message.Signal label. Does not parse files or return decoded series; decoding happens in the page and the plot updates in place. Prefer search_signals first when the key is unknown.',
			inputSchema: {
				type: 'object',
				properties: {
					signals: {
						type: 'array',
						minItems: 1,
						items: { type: 'string', minLength: 1 },
						description: 'Signal keys from search_signals, or Message.Signal labels.'
					},
					action: {
						type: 'string',
						enum: ['select', 'deselect', 'toggle'],
						description: 'select plots, deselect removes, toggle flips. Default select.'
					}
				},
				required: ['signals'],
				additionalProperties: false
			},
			execute: (input, { signal }) => applySignalSelection(host, input, signal)
		},
		shortcutTool(host, 'open_trace', 'Open trace', {
			description:
				'Open the browser file picker for a CAN trace (.asc, .trc, .blf, or .mf4). Does not accept a filesystem path. The browser agent must complete the picker; WASM parse then runs in this tab. Files stay on this device, max 500 MiB.'
		}),
		{
			name: 'add_dbc',
			title: 'Add DBC',
			description:
				'Open the signal selector and the browser file picker to add a DBC to the local library. Does not accept a filesystem path or DBC source text. The browser agent must complete the picker. Each DBC is capped at 1 MiB.',
			inputSchema: EMPTY_OBJECT_SCHEMA,
			execute: (_input, { signal }) => {
				throwIfAborted(signal);
				if (host.dbcLibrary().loading) {
					return Promise.resolve({
						ok: false,
						error: 'DBC files are still loading. Wait, then add a DBC.'
					});
				}
				host.openDbcPicker();
				return Promise.resolve({
					ok: true,
					message:
						'Opened the DBC file picker. Complete it in the browser; this tool does not take a path.'
				});
			}
		},
		shortcutTool(host, 'open_signal_selector', 'Signal selector', {
			description:
				'Open the in-page signal selector popover. Prefer search_signals and select_signals when choosing signals; use this when the human should see the selector.'
		}),
		shortcutTool(host, 'zoom_in', 'Zoom in', {
			description: 'Zoom the plot in around the current viewport centre. Same as the + shortcut.'
		}),
		shortcutTool(host, 'zoom_out', 'Zoom out', {
			description: 'Zoom the plot out around the current viewport centre. Same as the - shortcut.'
		}),
		shortcutTool(host, 'reset_zoom', 'Zoom to full extent', {
			description: 'Reset the plot to the full trace extent. Same as the 0 shortcut.'
		}),
		shortcutTool(host, 'toggle_box_zoom', 'Box zoom or drag pan', {
			description: 'Toggle box-zoom versus drag-pan on the plot. Same as the B shortcut.'
		}),
		shortcutTool(host, 'toggle_legend', 'Show or hide legend', {
			description: 'Show or hide the plot legend. Same as the L shortcut.'
		}),
		{
			name: 'place_c1',
			title: 'Place or centre C1',
			description:
				'Place crosshair C1. If timeMs is set, place it at that plot x in milliseconds (the shared time axis). If omitted, same as the 1 shortcut: pointer position when the pointer is on the plot, otherwise the current viewport centre. Does not return decoded values at the cursor.',
			inputSchema: placeCrosshairSchema('C1'),
			execute: (input, { signal }) => placeCrosshairTool(host, 1, 'placeC1', input, signal)
		},
		{
			name: 'place_c2',
			title: 'Place or centre C2',
			description:
				'Place crosshair C2. If timeMs is set, place it at that plot x in milliseconds (the shared time axis). If omitted, same as the 2 shortcut: pointer position when the pointer is on the plot, otherwise the current viewport centre. Does not return decoded values at the cursor.',
			inputSchema: placeCrosshairSchema('C2'),
			execute: (input, { signal }) => placeCrosshairTool(host, 2, 'placeC2', input, signal)
		},
		shortcutTool(host, 'clear_crosshairs', 'Clear crosshairs', {
			description: 'Clear C1 and C2 from the plot. Same as the C shortcut.'
		}),
		{
			name: 'export_plot',
			title: 'Export plot image',
			description:
				'Trigger the existing copy-to-clipboard or download of the current plot PNG. Does not return image bytes to the model.',
			inputSchema: {
				type: 'object',
				properties: {
					destination: {
						type: 'string',
						enum: ['copy', 'save'],
						description: 'copy writes the PNG to the clipboard. save starts a PNG download.'
					}
				},
				required: ['destination'],
				additionalProperties: false
			},
			execute: (input, { signal }) => {
				throwIfAborted(signal);
				const destination = optionalString(input, 'destination');
				if (destination !== 'copy' && destination !== 'save') {
					return Promise.resolve({ ok: false, error: 'destination must be "copy" or "save".' });
				}
				return host.exportPlot(destination, signal);
			}
		},
		shortcutTool(host, 'open_settings', 'Settings', {
			description: 'Open the settings popover. Same as the command-palette Settings action.'
		}),
		shortcutTool(host, 'show_help', 'Help and shortcuts', {
			description: 'Open the help dialog with keyboard shortcuts. Same as the ? shortcut.'
		})
	];
}

function shortcutTool(
	host: WebMcpHost,
	name: keyof typeof WEBMCP_SHORTCUT_TOOLS,
	title: string,
	body: { description: string }
): WebMcpTool {
	const action = WEBMCP_SHORTCUT_TOOLS[name];
	return {
		name,
		title,
		description: body.description,
		inputSchema: EMPTY_OBJECT_SCHEMA,
		execute: (_input, { signal }) => {
			throwIfAborted(signal);
			return Promise.resolve(runGatedShortcut(host, action));
		}
	};
}

export function runGatedShortcut(
	host: Pick<WebMcpHost, 'shortcutState' | 'runShortcut'>,
	action: ShortcutAction
) {
	const state = host.shortcutState();
	if (!shortcutEnabled(action, state)) {
		return { ok: false as const, action, error: shortcutDisabledMessage(action, state) };
	}
	host.runShortcut(action);
	return { ok: true as const, action };
}

export function shortcutDisabledMessage(action: ShortcutAction, state: ShortcutState): string {
	switch (action) {
		case 'openTrace':
			return 'A trace is already loading.';
		case 'zoomIn':
		case 'zoomOut':
		case 'toggleBoxZoom':
		case 'toggleLegend':
			return 'Open a trace and plot at least one signal first.';
		case 'resetZoom':
			return state.plotControlsDisabled
				? 'Open a trace and plot at least one signal first.'
				: 'The plot is already at full extent.';
		case 'placeC1':
		case 'placeC2':
			return state.plotControlsDisabled
				? 'Open a trace and plot at least one signal first.'
				: 'The plot has no viewport yet.';
		case 'clearCrosshairs':
			return state.plotControlsDisabled
				? 'Open a trace and plot at least one signal first.'
				: 'No crosshairs are placed.';
		default:
			return `${action} is not available.`;
	}
}

async function applySignalSelection(
	host: WebMcpHost,
	input: object,
	signal: AbortSignal
): Promise<Record<string, unknown>> {
	throwIfAborted(signal);
	const refs = stringArray(input, 'signals');
	if (refs === null) {
		return { ok: false, error: 'signals must be a non-empty array of strings.' };
	}
	const action = optionalString(input, 'action') ?? 'select';
	if (action !== 'select' && action !== 'deselect' && action !== 'toggle') {
		return { ok: false, error: 'action must be "select", "deselect", or "toggle".' };
	}

	const { resolved, missing, ambiguous } = resolveSignalRefs(host.signalCatalog(), refs);
	const changed: Array<{ key: string; label: string; selected: boolean; changed: boolean }> = [];

	for (const item of resolved) {
		throwIfAborted(signal);
		const selected = host.isSignalSelected(item.key);
		const shouldSelect = action === 'toggle' ? !selected : action === 'select';
		if (selected === shouldSelect) {
			changed.push({ key: item.key, label: item.label, selected, changed: false });
			continue;
		}
		await host.toggleSignal(item.key);
		changed.push({
			key: item.key,
			label: item.label,
			selected: shouldSelect,
			changed: true
		});
	}

	return {
		ok: missing.length === 0 && ambiguous.length === 0,
		action,
		changed,
		missing,
		ambiguous
	};
}

function placeCrosshairTool(
	host: WebMcpHost,
	id: CrosshairId,
	action: Extract<ShortcutAction, 'placeC1' | 'placeC2'>,
	input: object,
	signal: AbortSignal
) {
	throwIfAborted(signal);
	const gated = runGatedShortcut(
		{
			shortcutState: host.shortcutState,
			runShortcut: () => undefined
		},
		action
	);
	if (!gated.ok) return Promise.resolve(gated);

	const timeMs = optionalNumber(input, 'timeMs');
	if (timeMs === undefined) {
		host.runShortcut(action);
		const placed = host.view().crosshairs.find((crosshair) => crosshair.id === id) ?? null;
		return Promise.resolve({
			ok: true,
			id,
			placement: 'pointer-or-centre',
			note: 'Placed at the pointer if it is on the plot, otherwise the viewport centre (same as the shortcut).',
			crosshair: placed
		});
	}

	const placed = host.placeCrosshair(id, timeMs);
	if (placed === null) {
		return Promise.resolve({
			ok: false,
			error: shortcutDisabledMessage(action, host.shortcutState())
		});
	}
	return Promise.resolve({
		ok: true,
		id,
		placement: 'timeMs',
		crosshair: { id, ...placed }
	});
}

function placeCrosshairSchema(label: string) {
	return {
		type: 'object',
		properties: {
			timeMs: {
				type: 'number',
				description: `Plot x for ${label}, in milliseconds on the shared time axis. Omit to use the shortcut placement (pointer or viewport centre).`
			}
		},
		additionalProperties: false
	};
}

function flattenCatalog(indexes: SelectorSearchIndex[]): CatalogSignal[] {
	const signals: CatalogSignal[] = [];
	for (const index of indexes) {
		for (const { signal } of index.signals.items) {
			signals.push({ ...signal, dbcName: index.dbc.name });
		}
	}
	return signals;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit)) return SEARCH_RESULT_LIMIT_DEFAULT;
	return Math.min(SEARCH_RESULT_LIMIT_MAX, Math.max(1, Math.floor(limit)));
}

function asRecord(input: object): Record<string, unknown> {
	return input as Record<string, unknown>;
}

function requiredString(input: object, key: string): string | null {
	const value = asRecord(input)[key];
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function optionalString(input: object, key: string): string | undefined {
	const value = asRecord(input)[key];
	return typeof value === 'string' ? value : undefined;
}

function optionalInteger(input: object, key: string): number | undefined {
	const value = asRecord(input)[key];
	return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function optionalNumber(input: object, key: string): number | undefined {
	const value = asRecord(input)[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(input: object, key: string): string[] | null {
	const value = asRecord(input)[key];
	if (!Array.isArray(value) || value.length === 0) return null;
	if (!value.every((item) => typeof item === 'string' && item.length > 0)) return null;
	return value;
}
