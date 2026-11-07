// Page-level UI orchestration: trace opening (file, drop, demo preset), trace
// session setup, the walkthrough and which overlay is open.
// Handlers run outside React render, so they read current state with getState().
import { toast } from 'sonner';

import {
	adjacentWalkthroughStep,
	WALKTHROUGH_VERSION,
	type WalkthroughStep
} from '@/lib/walkthrough';
import { addTransientDbcs, removeDbcFile, resetDbcLibrary } from '@/store/dbc-files';
import { assignToNewAxis, resetAxes } from '@/store/plot-axes';
import {
	clearSelectedSignals,
	deselectDbcFile,
	isSignalSelected,
	signalDecodeStatus,
	toggleSignal
} from '@/store/plot-data';
import { resetPreferences, setPreference } from '@/store/preferences';
import { appStore, update, type AppState } from '@/store/store';
import { loadTraceFile } from '@/store/trace-file';

type WalkthroughStepId = WalkthroughStep['id'];

export function openHelp(): void {
	update({ settingsOpen: false, helpOpen: true });
}

export function setHelpOpen(helpOpen: boolean): void {
	update({ helpOpen });
}

export function setPaletteOpen(paletteOpen: boolean): void {
	update({ paletteOpen });
}

export function setSettingsOpen(settingsOpen: boolean): void {
	update({ settingsOpen });
}

export function setSignalSelectorOpen(open: boolean): void {
	writeSelectorOpen(open);
}

export function openSignalSelector(): void {
	writeSelectorOpen(true, { settingsOpen: false });
}

export function openPalette(): void {
	writeSelectorOpen(false, { settingsOpen: false, paletteOpen: true });
}

export function openSettings(): void {
	writeSelectorOpen(false, { settingsOpen: true });
}

type OverlayPatch = Partial<Pick<AppState, 'settingsOpen' | 'paletteOpen'>>;

// The walkthrough follows the selector, so a step change carries the overlays in its own write.
function writeSelectorOpen(signalSelectorOpen: boolean, overlays: OverlayPatch = {}): void {
	const step = appStore.getState().walkthroughStepId;
	if (signalSelectorOpen && step === 'library') {
		void showWalkthroughStep('add-dbc', overlays);
	} else if (!signalSelectorOpen && (step === 'add-dbc' || step === 'signals')) {
		void showWalkthroughStep('library', overlays);
	} else {
		update({ ...overlays, signalSelectorOpen });
	}
}

export function advanceWalkthroughAfterDbcAdded(): void {
	if (appStore.getState().walkthroughStepId === 'add-dbc') void showWalkthroughStep('signals');
}

export function advanceWalkthroughAfterSignalToggle(): void {
	if (appStore.getState().walkthroughStepId === 'signals') void showWalkthroughStep('controls');
}

export function startWalkthrough(): void {
	void showWalkthroughStep('trace');
}

// The panel unmounts, the overlays settle for a frame, then the next step measures its target.
async function showWalkthroughStep(
	stepId: WalkthroughStepId,
	overlays: OverlayPatch = {}
): Promise<void> {
	update({
		walkthroughStepId: null,
		settingsOpen: false,
		signalSelectorOpen: stepId === 'add-dbc' || stepId === 'signals',
		...overlays
	});
	await new Promise((resolve) => requestAnimationFrame(resolve));
	update({ walkthroughStepId: stepId });
}

export function advanceWalkthrough(): void {
	const current = appStore.getState().walkthroughStepId;
	if (!current) return;
	const next = adjacentWalkthroughStep(current, 1);
	if (next) {
		void showWalkthroughStep(next.id);
		return;
	}
	setPreference('walkthroughVersion', WALKTHROUGH_VERSION);
	update({ walkthroughStepId: null, signalSelectorOpen: false });
}

export async function startTraceSession(): Promise<void> {
	clearSelectedSignals();
	resetAxes();
	const { trace } = appStore.getState();
	await addTransientDbcs(trace?.id ?? 0, trace?.embeddedDbcs ?? []);
}

export async function deleteDbc(dbcFileId: string): Promise<void> {
	deselectDbcFile(dbcFileId);
	await removeDbcFile(dbcFileId);
}

export async function resetPersistentData(): Promise<void> {
	clearSelectedSignals();
	resetAxes();
	resetPreferences();
	await resetDbcLibrary();
}

const DEMO_PRESET = [
	{ group: 'Decoded powertrain', signal: 'VehicleSpeed', unit: 'km/h', axis: 'primary' },
	{ group: 'Decoded powertrain', signal: 'EngineSpeed', unit: 'rpm', axis: 'new' }
] as const;

export async function openTraceFile(file: File | null): Promise<void> {
	if (!file) return;
	await withTraceLock(() => loadTrace(file));
}

export function openDemoTrace(): Promise<void> {
	return withTraceLock(async () => {
		if (await loadTrace(await fetchDemoTrace())) await plotDemoSignals();
	});
}

// One open at a time; `openingTrace` holds through the post-parse work as well as the parse.
async function withTraceLock(open: () => Promise<unknown>): Promise<void> {
	if (appStore.getState().openingTrace) return;
	update({ openingTrace: true });
	// ChartGPU is the one lazy chunk: fetch it as a trace opens rather than once the plot mounts.
	void import('chartgpu').catch(() => undefined);
	try {
		await open();
	} catch (error) {
		toast.error(error instanceof Error ? error.message : 'Could not open the trace.');
	} finally {
		update({ openingTrace: false });
	}
}

/** Resolves to whether the trace opened. */
async function loadTrace(file: File): Promise<boolean> {
	if (!(await loadTraceFile(file))) return false;
	const { traceWarning } = appStore.getState();
	if (traceWarning) toast.warning(traceWarning);
	await startTraceSession();
	if (appStore.getState().walkthroughStepId === 'trace') await showWalkthroughStep('library');
	return true;
}

async function plotDemoSignals(): Promise<void> {
	const catalog = [...appStore.getState().signalByKey.values()];
	const signals = DEMO_PRESET.map((item) => {
		const matches = catalog.filter(
			(signal) =>
				signal.kind === 'mf4' &&
				signal.messageName === item.group &&
				signal.signalName === item.signal &&
				signal.format.unit === item.unit
		);
		if (matches.length !== 1) throw new Error(`Demo signal ${item.signal} is unavailable.`);
		return { key: matches[0].key, axis: item.axis };
	});
	for (const { key, axis } of signals) {
		if (!isSignalSelected(key)) await toggleSignal(key);
		if (!isSignalSelected(key)) continue;
		const { decodeError } = signalDecodeStatus(key);
		if (decodeError) throw new Error(decodeError);
		if (axis === 'new') assignToNewAxis(key);
	}
}

async function fetchDemoTrace(): Promise<File> {
	const response = await fetch('/example.mf4');
	if (!response.ok) throw new Error('Could not load the demo trace.');
	return new File([await response.blob()], 'example.mf4');
}
