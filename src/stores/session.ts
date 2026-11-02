import { addTransientDbcs, removeDbcFile, resetDbcLibrary } from '@/stores/dbc-files';
import { resetAxes } from '@/stores/plot-axes';
import { clearSelectedSignals, deselectDbcFile } from '@/stores/plot-data';
import { resetPreferences } from '@/stores/preferences';
import { appStore } from '@/stores/store';

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
