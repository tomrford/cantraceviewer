// Page-level UI state and its orchestration: trace opening (file, drop, demo preset), keyboard
// shortcuts, the walkthrough and which overlay is open.
// Handlers run outside React render, so they read current state with getState().
import { toast } from 'sonner';
import { createStore } from 'zustand/vanilla';
import { TRACE_MAX_FILE_BYTES } from '../file-limits.js';
import {
	detectShortcutPlatform,
	overridesBrowserShortcut,
	shortcutEnabled,
	shortcutFromEvent,
	shortcutSuppressedBySurface,
	type ShortcutAction,
	type ShortcutPlatform,
	type ShortcutState
} from '../keyboard-shortcuts.js';
import {
	adjacentWalkthroughStep,
	WALKTHROUGH_VERSION,
	type WalkthroughStep
} from '../walkthrough.js';
import { mountWebMcp } from '../webmcp.js';
import { loadDbcLibrary } from './dbc-files.js';
import { assignToNewAxis } from './plot-axes.js';
import { isSignalSelected, plotData, signalDecodeStatus, toggleSignal } from './plot-data.js';
import {
	clearCrosshairs,
	placeCrosshair,
	plotView,
	resetZoom,
	toggleBoxZoom,
	toggleLegend,
	zoomBy
} from './plot-view.js';
import { connectPreferences, setPreference } from './preferences.js';
import { onTraceOpened } from './session.js';
import { openTraceFile, traceFile } from './trace-file.js';

export type WalkthroughStepId = WalkthroughStep['id'];

export const TRACE_INPUT_ID = 'trace-file-input';

export const appShell = createStore(() => ({
	shortcutPlatform: 'other' as ShortcutPlatform,
	webgpuSupported: null as boolean | null,
	openingTrace: false,
	traceDropActive: false,
	signalSelectorOpen: false,
	settingsOpen: false,
	helpOpen: false,
	paletteOpen: false,
	signalSearchFocusRequest: 0,
	walkthroughStepId: null as WalkthroughStepId | null
}));

/** Called once from the App mount effect; returns the teardown. */
export function connectAppShell(): () => void {
	appShell.setState({
		webgpuSupported: 'gpu' in navigator,
		shortcutPlatform: detectShortcutPlatform(`${navigator.platform} ${navigator.userAgent}`)
	});
	const disconnectPreferences = connectPreferences();
	void loadDbcLibrary();
	const unmountWebMcp = mountWebMcp();
	window.addEventListener('keydown', handleShortcutKey);
	return () => {
		window.removeEventListener('keydown', handleShortcutKey);
		unmountWebMcp();
		disconnectPreferences();
	};
}

export type ShortcutInputs = {
	traceBusy: boolean;
	hasPlottable: boolean;
	isFitAll: boolean;
	canPlaceCrosshair: boolean;
	hasCrosshairs: boolean;
};

export function deriveShortcutState(inputs: ShortcutInputs): ShortcutState {
	return {
		traceLoading: inputs.traceBusy,
		plotControlsDisabled: !inputs.hasPlottable || inputs.traceBusy,
		canResetZoom: inputs.hasPlottable && !inputs.isFitAll,
		canPlaceCrosshair: inputs.canPlaceCrosshair,
		hasCrosshairs: inputs.hasCrosshairs
	};
}

export function isTraceBusy(): boolean {
	return appShell.getState().openingTrace || traceFile.getState().isLoading;
}

function handleShortcutKey(event: KeyboardEvent): void {
	const action = shortcutFromEvent(event, appShell.getState().shortcutPlatform);
	if (action === null) return;

	if (overridesBrowserShortcut(action)) event.preventDefault();

	if (shortcutSuppressedBySurface(event.target instanceof Element ? event.target : null)) return;
	const view = plotView.getState();
	const state = deriveShortcutState({
		traceBusy: isTraceBusy(),
		hasPlottable: plotData.getState().hasPlottableSignals,
		isFitAll: view.isFitAll,
		canPlaceCrosshair: view.activeViewport !== null,
		hasCrosshairs: view.crosshairs.length > 0
	});
	if (!shortcutEnabled(action, state)) return;

	runShortcut(action);
	event.preventDefault();
}

export function runShortcut(action: ShortcutAction): void {
	switch (action) {
		case 'openTrace':
			chooseTraceFile();
			break;
		case 'selectSignals':
			appShell.setState({ settingsOpen: false });
			setSignalSelectorOpen(true);
			appShell.setState((s) => ({ signalSearchFocusRequest: s.signalSearchFocusRequest + 1 }));
			break;
		case 'showPalette':
			appShell.setState({ settingsOpen: false });
			setSignalSelectorOpen(false);
			appShell.setState({ paletteOpen: true });
			break;
		case 'openSettings':
			setSignalSelectorOpen(false);
			appShell.setState({ settingsOpen: true });
			break;
		case 'showHelp':
			openHelp();
			break;
		case 'zoomIn':
			zoomBy(0.5);
			break;
		case 'zoomOut':
			zoomBy(2);
			break;
		case 'resetZoom':
			resetZoom();
			break;
		case 'toggleBoxZoom':
			toggleBoxZoom();
			break;
		case 'toggleLegend':
			toggleLegend();
			break;
		case 'placeC1':
			placeCrosshair(1);
			break;
		case 'placeC2':
			placeCrosshair(2);
			break;
		case 'clearCrosshairs':
			clearCrosshairs();
			break;
	}
}

export function chooseTraceFile(): void {
	document.getElementById(TRACE_INPUT_ID)?.click();
}

export function openHelp(): void {
	appShell.setState({ settingsOpen: false, helpOpen: true });
}

export function setSignalSelectorOpen(open: boolean): void {
	appShell.setState({ signalSelectorOpen: open });
	const step = appShell.getState().walkthroughStepId;
	if (open && step === 'library') {
		void showWalkthroughStep('add-dbc');
	} else if (!open && (step === 'add-dbc' || step === 'signals')) {
		void showWalkthroughStep('library');
	}
}

export function handleDbcAdded(): void {
	if (appShell.getState().walkthroughStepId === 'add-dbc') void showWalkthroughStep('signals');
}

export function handleSignalToggle(): void {
	if (appShell.getState().walkthroughStepId === 'signals') void showWalkthroughStep('controls');
}

export function startWalkthrough(): void {
	void showWalkthroughStep('trace');
}

// The panel unmounts, the overlays settle for a frame, then the next step measures its target.
async function showWalkthroughStep(stepId: WalkthroughStepId): Promise<void> {
	appShell.setState({
		walkthroughStepId: null,
		settingsOpen: false,
		signalSelectorOpen: stepId === 'add-dbc' || stepId === 'signals'
	});
	await new Promise((resolve) => requestAnimationFrame(resolve));
	appShell.setState({ walkthroughStepId: stepId });
}

export function advanceWalkthrough(): void {
	const current = appShell.getState().walkthroughStepId;
	if (!current) return;
	const next = adjacentWalkthroughStep(current, 1);
	if (next) {
		void showWalkthroughStep(next.id);
		return;
	}
	setPreference('walkthroughVersion', WALKTHROUGH_VERSION);
	appShell.setState({ walkthroughStepId: null, signalSelectorOpen: false });
}

type DemoPreset = Readonly<{
	group: string;
	signal: string;
	unit: string;
	axis: 'primary' | 'new';
}>;

const DEMO_PRESET: readonly DemoPreset[] = [
	{ group: 'Decoded powertrain', signal: 'VehicleSpeed', unit: 'km/h', axis: 'primary' },
	{ group: 'Decoded powertrain', signal: 'EngineSpeed', unit: 'rpm', axis: 'new' }
];

export function openDemoTrace(): Promise<void> {
	return openTrace(fetchDemoTrace, DEMO_PRESET);
}

export async function openTrace(
	source: File | null | (() => Promise<File>),
	preset?: readonly DemoPreset[]
): Promise<void> {
	if (!source || isTraceBusy()) return;
	appShell.setState({ openingTrace: true });
	try {
		const file = typeof source === 'function' ? await source() : source;
		if (!(await openTraceFile(file))) return;
		const { entry: opened, warning } = traceFile.getState();
		const stillOpen = () => traceFile.getState().entry === opened;
		if (warning) toast.warning(warning);
		await onTraceOpened();
		if (!stillOpen()) return;
		if (appShell.getState().walkthroughStepId === 'trace') await showWalkthroughStep('library');
		if (!preset || !stillOpen()) return;

		const targets = [...traceFile.getState().mf4SignalTargetByKey];
		const signals = preset.map((item) => {
			const matches = targets.filter(
				([, target]) =>
					target.group.name === item.group &&
					target.signal.name === item.signal &&
					target.signal.unit === item.unit
			);
			if (matches.length !== 1) throw new Error(`Demo signal ${item.signal} is unavailable.`);
			return { key: matches[0][0], axis: item.axis };
		});
		for (const { key, axis } of signals) {
			if (!stillOpen()) return;
			if (!isSignalSelected(key)) await toggleSignal(key);
			if (!stillOpen()) return;
			if (!isSignalSelected(key)) continue;
			const { decodeError } = signalDecodeStatus(key);
			if (decodeError) throw new Error(decodeError);
			if (axis === 'new') assignToNewAxis(key);
		}
	} catch (error) {
		toast.error(error instanceof Error ? error.message : 'Could not open the trace.');
	} finally {
		appShell.setState({ openingTrace: false });
	}
}

async function fetchDemoTrace(): Promise<File> {
	const response = await fetch('/example.mf4');
	if (!response.ok || !response.body) throw new Error('Could not load the demo trace.');
	const limitError = () =>
		new Error(`Trace file exceeds the ${TRACE_MAX_FILE_BYTES / 1024 / 1024} MiB limit`);
	if (Number(response.headers.get('content-length')) > TRACE_MAX_FILE_BYTES) {
		await response.body.cancel();
		throw limitError();
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		if (received > TRACE_MAX_FILE_BYTES) {
			await reader.cancel();
			throw limitError();
		}
		chunks.push(value);
	}
	return new File(chunks, 'example.mf4');
}
