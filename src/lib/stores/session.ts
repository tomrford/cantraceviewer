import { dbcFiles } from './dbc-files.svelte.js';
import { plotData } from './plot-data.svelte.js';
import { resetPreferences } from './preferences.svelte.js';

export function onTraceOpened(): void {
	plotData.clearSelectedSignals();
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
