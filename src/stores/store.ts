// The single app store. Read with `useAppStore(selector)` in components or `appStore.getState()`
// elsewhere; write with `update(patch)`, which recomputes whatever the patch invalidated before
// anyone is notified.
// Actions live beside it by domain: trace-file, dbc-files, plot-data, plot-axes, plot-view,
// preferences, app-shell and session.
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { PRIMARY_Y_AXIS_ID, type YAxisId } from '@/lib/plot/plot-axes';
import type { LegendCrosshairMode, PlotCrosshair } from '@/lib/plot/plot-crosshair';
import type { LegendOrderMode } from '@/lib/plot/plot-signal-order';
import { FULL_Y_WINDOW, type PlotYWindow } from '@/lib/plot/plot-viewport';
import type { WalkthroughStep } from '@/lib/walkthrough';
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
} from '@/stores/derive';

export type ThemePreference = 'system' | 'light' | 'dark';
export type TimestampMode = 'relative' | 'absolute';

export type PersistedPreferences = {
	theme: ThemePreference;
	timestampMode: TimestampMode;
	legendOrder: LegendOrderMode;
	walkthroughVersion: number;
};

/** What actions write, through `update`. */
type SourceState = PersistedPreferences & {
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
	traceError: string | null;

	// DBC library
	dbcFiles: DbcFileEntry[];
	dbcLoading: boolean;
	dbcError: string | null;
	hasLoadedLibrary: boolean;

	// Plotted signals
	selected: ReadonlyMap<string, SelectedSignalState>;

	// Axes
	axisIds: readonly YAxisId[];
	/** Signal key -> non-primary axis; unassigned signals sit on the primary axis. */
	axisAssignment: ReadonlyMap<string, YAxisId>;

	// Plot view
	viewportMode: ViewportMode;
	yWindow: PlotYWindow;
	crosshairs: PlotCrosshair[];
	legendCrosshairMode: LegendCrosshairMode;
	boxZoomEnabled: boolean;
	legendVisible: boolean;
};

/** Computed by `withDerived` on each write. */
type DerivedState = ReturnType<typeof traceState> &
	ReturnType<typeof catalogState> &
	ReturnType<typeof signalsState> &
	ReturnType<typeof viewportState> & { plotModel: PlotModelState };

export type AppState = SourceState & DerivedState;

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

function withDerived(prev: AppState, patch: Partial<SourceState>): AppState {
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

export function useAppStore<T>(selector: (s: AppState) => T): T {
	return useStore(appStore, selector);
}

export function update(patch: Partial<SourceState>): void {
	store.setState(withDerived(store.getState(), patch), true);
}
