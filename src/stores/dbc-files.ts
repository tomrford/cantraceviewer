import { isDbcFileName } from '@/lib/dbc-file-types';
import {
	deleteStoredDbc,
	listStoredDbcs,
	putStoredDbcs,
	resetStoredDbcs,
	storedDbcId,
	type StoredDbc
} from '@/lib/dbc-library';
import { DBC_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '@/lib/file-limits';
import { closeDbc, openDbc, type EmbeddedDbc } from '@/lib/wasm';
import type { DbcFileEntry } from '@/stores/derive';
import { appStore, update } from '@/stores/store';

let libraryOperation = Promise.resolve();

export function addDbcFiles(files: Iterable<File>): Promise<void> {
	if (appStore.getState().dbcLoading) return Promise.resolve();
	return runLibraryOperation(() => importFiles(files));
}

export async function removeDbcFile(id: string): Promise<void> {
	const entry = appStore.getState().dbcFiles.find((file) => file.id === id);
	if (!entry) return;

	update({ dbcFiles: appStore.getState().dbcFiles.filter((file) => file.id !== id) });
	await closeDbc(entry.handle);
	if (entry.origin === 'library') await deleteStoredDbc(entry.id);
}

export function addTransientDbcs(ownerTraceId: number, dbcs: EmbeddedDbc[]): Promise<void> {
	return runLibraryOperation(() => importTransientDbcs(ownerTraceId, dbcs));
}

export async function clearDbcFiles(): Promise<void> {
	const removed = appStore.getState().dbcFiles;
	update({ dbcFiles: [] });
	await closeEntries(removed);
}

export function resetDbcLibrary(): Promise<void> {
	return runLibraryOperation(async () => {
		update({ dbcError: null, hasLoadedLibrary: true });
		await clearDbcFiles();
		await resetStoredDbcs();
	});
}

export function clearDbcError(): void {
	update({ dbcError: null });
}

export function loadDbcLibrary(): Promise<void> {
	const { hasLoadedLibrary, dbcLoading } = appStore.getState();
	if (hasLoadedLibrary || dbcLoading) return Promise.resolve();
	return runLibraryOperation(readLibrary);
}

async function importFiles(files: Iterable<File>): Promise<void> {
	update({ dbcError: null });
	const stored: StoredDbc[] = [];
	const entries: DbcFileEntry[] = [];
	const seenIds = new Set(appStore.getState().dbcFiles.map((file) => file.id));

	try {
		for (const file of files) {
			const dbc = await storedFile(file);
			if (seenIds.has(dbc.id)) continue;

			seenIds.add(dbc.id);
			entries.push(await openStoredDbc(dbc));
			stored.push(dbc);
		}

		if (entries.length > 0) {
			await putStoredDbcs(stored);
			update({ dbcFiles: [...appStore.getState().dbcFiles, ...entries] });
		}
	} catch (error) {
		await closeEntries(entries);
		update({ dbcError: error instanceof Error ? error.message : 'DBC load failed' });
	}
}

async function importTransientDbcs(ownerTraceId: number, dbcs: EmbeddedDbc[]): Promise<void> {
	update({ dbcError: null });
	const { dbcFiles } = appStore.getState();
	const removed = dbcFiles.filter((file) => file.origin === 'mf4');
	if (removed.length > 0) {
		update({ dbcFiles: dbcFiles.filter((file) => file.origin !== 'mf4') });
		await closeEntries(removed);
	}
	const entries: DbcFileEntry[] = [];
	try {
		for (const [index, dbc] of dbcs.entries()) {
			const stored = { id: `mf4:${ownerTraceId}:${index}`, name: dbc.name, bytes: dbc.bytes };
			entries.push(await openStoredDbc(stored, 'mf4'));
		}
		update({ dbcFiles: [...appStore.getState().dbcFiles, ...entries] });
	} catch (error) {
		await closeEntries(entries);
		update({ dbcError: error instanceof Error ? error.message : 'Embedded DBC load failed' });
	}
}

async function readLibrary(): Promise<void> {
	update({ dbcError: null });

	const candidates: DbcFileEntry[] = [];
	const failures: string[] = [];
	const transient = () => appStore.getState().dbcFiles.filter((file) => file.origin === 'mf4');
	try {
		for (const dbc of await listStoredDbcs()) {
			try {
				candidates.push(await openStoredDbc(dbc));
			} catch (error) {
				failures.push(error instanceof Error ? error.message : `${dbc.name}: DBC load failed`);
			}
		}

		update({
			dbcFiles: [...candidates, ...transient()],
			dbcError: failures.length > 0 ? failures.join('\n') : null
		});
	} catch {
		await closeEntries(candidates);
		update({ dbcFiles: transient(), dbcError: 'Saved DBC library could not be read.' });
	} finally {
		update({ hasLoadedLibrary: true });
	}
}

// Order reads, imports and resets, including persistent writes and newer trace DBCs.
// Keep the loading gate held until the last queued operation has finished.
function runLibraryOperation(action: () => Promise<void>): Promise<void> {
	update({ dbcLoading: true });
	const operation = libraryOperation.then(action, action);
	libraryOperation = operation;
	return operation.finally(() => {
		if (libraryOperation === operation) update({ dbcLoading: false });
	});
}

async function storedFile(file: File): Promise<StoredDbc> {
	if (!isDbcFileName(file.name)) throw new Error('Unsupported DBC file type. Open .dbc.');
	assertFileSizeWithinLimit(file, DBC_MAX_FILE_BYTES, 'DBC');

	const bytes = new Uint8Array(await file.arrayBuffer());
	return { id: await storedDbcId(bytes), name: file.name, bytes };
}

async function openStoredDbc(
	dbc: StoredDbc,
	origin: DbcFileEntry['origin'] = 'library'
): Promise<DbcFileEntry> {
	const { handle, catalog, warnings } = await openDbc(dbc.bytes ?? dbc.text).catch((error) => {
		throw new Error(`${dbc.name}: ${error instanceof Error ? error.message : 'DBC load failed'}`);
	});

	return { id: dbc.id, name: dbc.name, handle, catalog, warnings, origin };
}

async function closeEntries(entries: DbcFileEntry[]): Promise<void> {
	await Promise.all(entries.map((entry) => closeDbc(entry.handle)));
}
