// Page-level UI state and its orchestration: trace opening (file, drop, demo preset), the
// walkthrough and which overlay is open.
// Handlers run outside React render, so they read current state with getState().
import { toast } from 'sonner';
import { createStore } from 'zustand/vanilla';
import {
	adjacentWalkthroughStep,
	WALKTHROUGH_VERSION,
	type WalkthroughStep
} from '../walkthrough.js';
import { assignToNewAxis } from './plot-axes.js';
import { isSignalSelected, signalDecodeStatus, toggleSignal } from './plot-data.js';
import { setPreference } from './preferences.js';
import { onTraceOpened } from './session.js';
import { openTraceFile, traceFile } from './trace-file.js';

type WalkthroughStepId = WalkthroughStep['id'];

export const appShell = createStore(() => ({
	openingTrace: false,
	signalSelectorOpen: false,
	settingsOpen: false,
	helpOpen: false,
	paletteOpen: false,
	walkthroughStepId: null as WalkthroughStepId | null
}));

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

const DEMO_PRESET = [
	{ group: 'Decoded powertrain', signal: 'VehicleSpeed', unit: 'km/h', axis: 'primary' },
	{ group: 'Decoded powertrain', signal: 'EngineSpeed', unit: 'rpm', axis: 'new' }
] as const;

export function openDemoTrace(): Promise<void> {
	return openTrace(fetchDemoTrace, DEMO_PRESET);
}

export async function openTrace(
	source: File | null | (() => Promise<File>),
	preset?: typeof DEMO_PRESET
): Promise<void> {
	if (!source || appShell.getState().openingTrace) return;
	appShell.setState({ openingTrace: true });
	// ChartGPU is the one lazy chunk: fetch it as a trace opens rather than once the plot mounts.
	void import('chartgpu').catch(() => undefined);
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
	if (!response.ok) throw new Error('Could not load the demo trace.');
	return new File([await response.blob()], 'example.mf4');
}
