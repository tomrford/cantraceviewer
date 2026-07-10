import { dbcFiles } from './dbc-files.svelte.js';
import { plotData } from './plot-data.svelte.js';
import { resetPreferences } from './preferences.svelte.js';
import { traceFile } from './trace-file.svelte.js';

export async function onTraceOpened(): Promise<void> {
	plotData.clearSelectedSignals();
	const trace = traceFile.entry;
	await dbcFiles.addTransientDbcs(trace?.id ?? 0, trace?.embeddedDbcs ?? []);
}

export async function onDbcRemoved(dbcFileId: string): Promise<void> {
	plotData.deselectDbcFile(dbcFileId);
	await dbcFiles.removeFile(dbcFileId);
}

export async function onResetPersistentData(): Promise<void> {
	plotData.clearSelectedSignals();
	resetPreferences();
	await dbcFiles.resetLibrary();
}
