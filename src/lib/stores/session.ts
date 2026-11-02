import { addTransientDbcs, removeDbcFile, resetDbcLibrary } from './dbc-files.js';
import { resetAxes } from './plot-axes.js';
import { clearSelectedSignals, deselectDbcFile } from './plot-data.js';
import { resetPreferences } from './preferences.js';
import { appStore } from './store.js';

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
