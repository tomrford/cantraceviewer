// The single app store. Read with `useStore(appStore, selector)` or `appStore.getState()`; write
// with `update(patch)`, which recomputes whatever the patch invalidated before anyone is notified.
// Actions live beside it by domain: trace-file, dbc-files, plot-data, plot-axes, plot-view,
// preferences, app-shell and session.
import { createStore, type StoreApi } from 'zustand/vanilla';
import { PRIMARY_Y_AXIS_ID, type YAxisId } from '#lib/plot-axes.js';
import type { LegendCrosshairMode, PlotCrosshair } from '#lib/plot-crosshair.js';
import type { LegendOrderMode } from '#lib/plot-signal-order.js';
import {
	FULL_Y_WINDOW,
	type PlotAxisRange,
	type PlotViewport,
	type PlotYWindow
} from '#lib/plot-viewport.js';
import type { WalkthroughStep } from '#lib/walkthrough.js';
import {
	catalogState,
	modelState,
	readoutMode,
	signalsState,
	traceState,
	viewportState,
	type DbcFileEntry,
	type PlotModelState,
	type SelectedSignalState,
	type TraceFileEntry,
	type ViewportMode
} from './derive.js';

export type ThemePreference = 'system' | 'light' | 'dark';
export type TimestampMode = 'relative' | 'absolute';

export type PersistedPreferences = {
	theme: ThemePreference;
	timestampMode: TimestampMode;
	legendOrder: LegendOrderMode;
	walkthroughVersion: number;
};

export type AppState = PersistedPreferences & {
	// Page UI
	systemDark: boolean;
	openingTrace: boolean;
	signalSelectorOpen: boolean;
	settingsOpen: boolean;
	helpOpen: boolean;
	paletteOpen: boolean;
	walkthroughStepId: WalkthroughStep['id'] | null;

	// Open trace
	trace: TraceFileEntry | null;
	traceLoading: boolean;
	traceError: string | null;
	/** Derived from `trace`. */
	traceName: string;
	traceWarning: string | null;
	mf4SignalTargetByKey: ReturnType<typeof traceState>['mf4SignalTargetByKey'];
	mf4SelectorIndexes: ReturnType<typeof traceState>['mf4SelectorIndexes'];

	// DBC library
	dbcFiles: DbcFileEntry[];
	dbcLoading: boolean;
	dbcError: string | null;
	hasLoadedLibrary: boolean;
	/** Derived from `dbcFiles` and `trace`. */
	signalTargetByKey: ReturnType<typeof catalogState>['signalTargetByKey'];
	selectorFiles: ReturnType<typeof catalogState>['selectorFiles'];
	selectorSearchIndexes: ReturnType<typeof catalogState>['selectorSearchIndexes'];

	// Plotted signals
	selected: ReadonlyMap<string, SelectedSignalState>;
	/** Derived from `selected`, the catalogues and `legendOrder`. */
	signals: ReturnType<typeof signalsState>['signals'];
	hasPlottableSignals: boolean;

	// Axes
	axisIds: readonly YAxisId[];
	/** Signal key -> non-primary axis; unassigned signals sit on the primary axis. */
	axisAssignment: ReadonlyMap<string, YAxisId>;
	/** Derived from `signals`, the axes and `trace`. */
	plotModel: PlotModelState;

	// Plot view
	viewportMode: ViewportMode;
	yWindow: PlotYWindow;
	/** Derived from the mode, Y window and plot model. */
	activeViewport: PlotViewport | null;
	isFitAll: boolean;
	/** Non-primary fit ranges with the Y window applied, plus the primary from `activeViewport`. */
	axisRanges: ReadonlyMap<YAxisId, PlotAxisRange>;
	crosshairs: PlotCrosshair[];
	legendCrosshairMode: LegendCrosshairMode;
	boxZoomEnabled: boolean;
	legendVisible: boolean;
};

export const FIT: ViewportMode = { mode: 'fit' };

/**
 * Held until `connectPreferences()` runs. Hydration still matches the prerendered markup after it
 * has run, because `useStore` reads the initial state for its server snapshot.
 */
export const DEFAULT_PREFERENCES: PersistedPreferences = {
	theme: 'system',
	timestampMode: 'relative',
	legendOrder: 'selection',
	walkthroughVersion: 0
};

function withDerived(prev: AppState, patch: Partial<AppState>): AppState {
	const next = { ...prev, ...patch };

	if (next.trace !== prev.trace) Object.assign(next, traceState(next.trace));

	// The signal catalogue.
	if (next.dbcFiles !== prev.dbcFiles || next.trace !== prev.trace) {
		Object.assign(next, catalogState(next.dbcFiles, next.trace));
	}

	// The plotted signals.
	if (
		next.selected !== prev.selected ||
		next.signalTargetByKey !== prev.signalTargetByKey ||
		next.mf4SignalTargetByKey !== prev.mf4SignalTargetByKey ||
		next.legendOrder !== prev.legendOrder
	) {
		Object.assign(
			next,
			signalsState(
				next.selected,
				next.signalTargetByKey,
				next.mf4SignalTargetByKey,
				next.legendOrder
			)
		);
	}

	// Nothing plottable any more: drop crosshairs and box zoom and return to the full extent.
	if (prev.hasPlottableSignals && !next.hasPlottableSignals) {
		next.crosshairs = [];
		next.boxZoomEnabled = false;
		next.viewportMode = FIT;
		next.yWindow = FULL_Y_WINDOW;
	}

	// The plot model.
	if (
		next.signals !== prev.signals ||
		next.axisIds !== prev.axisIds ||
		next.axisAssignment !== prev.axisAssignment ||
		next.trace !== prev.trace
	) {
		next.plotModel = modelState(
			next.signals,
			next.axisIds,
			next.axisAssignment,
			next.trace,
			prev.plotModel
		);
	}

	// The viewport and axis ranges.
	if (
		next.viewportMode !== prev.viewportMode ||
		next.yWindow !== prev.yWindow ||
		next.plotModel.fullDomain !== prev.plotModel.fullDomain ||
		next.plotModel.secondaryFitRanges !== prev.plotModel.secondaryFitRanges
	) {
		Object.assign(next, viewportState(next.viewportMode, next.yWindow, next.plotModel));
	}

	if (
		next.crosshairs !== prev.crosshairs ||
		next.legendCrosshairMode !== prev.legendCrosshairMode
	) {
		next.legendCrosshairMode = readoutMode(next.crosshairs, next.legendCrosshairMode);
	}

	return next;
}

function initialState(): AppState {
	const axisIds = [PRIMARY_Y_AXIS_ID];
	const axisAssignment = new Map<string, YAxisId>();
	const plotModel = modelState([], axisIds, axisAssignment, null, null);
	return {
		...DEFAULT_PREFERENCES,
		systemDark: false,
		openingTrace: false,
		signalSelectorOpen: false,
		settingsOpen: false,
		helpOpen: false,
		paletteOpen: false,
		walkthroughStepId: null,

		trace: null,
		traceLoading: false,
		traceError: null,
		...traceState(null),

		dbcFiles: [],
		dbcLoading: false,
		dbcError: null,
		hasLoadedLibrary: false,
		...catalogState([], null),

		selected: new Map(),
		signals: [],
		hasPlottableSignals: false,

		axisIds,
		axisAssignment,
		plotModel,

		viewportMode: FIT,
		yWindow: FULL_Y_WINDOW,
		...viewportState(FIT, FULL_Y_WINDOW, plotModel),
		crosshairs: [],
		legendCrosshairMode: 'c1',
		boxZoomEnabled: false,
		legendVisible: true
	};
}

const store = createStore<AppState>()(initialState);

export const appStore: Omit<StoreApi<AppState>, 'setState'> = store;

export function update(patch: Partial<AppState>): void {
	store.setState(withDerived(store.getState(), patch), true);
}
