import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type StoredDbc = {
	id: string;
	name: string;
} & ({ bytes: Uint8Array; text?: never } | { text: string; bytes?: never });

interface CanTraceViewerDatabase extends DBSchema {
	'dbc-files': {
		key: string;
		value: StoredDbc;
	};
}

const DATABASE_NAME = 'cantraceviewer';
const DATABASE_VERSION = 1;
const DBC_STORE_NAME = 'dbc-files';

export async function listStoredDbcs(): Promise<StoredDbc[]> {
	if (!isIndexedDbAvailable()) return [];
	const database = await openDatabase();
	return database.getAll(DBC_STORE_NAME);
}

export async function putStoredDbcs(dbcs: StoredDbc[]): Promise<void> {
	if (!isIndexedDbAvailable()) return;
	const database = await openDatabase();
	const transaction = database.transaction(DBC_STORE_NAME, 'readwrite');
	const store = transaction.objectStore(DBC_STORE_NAME);
	for (const dbc of dbcs) {
		store.put(dbc);
	}
	await transaction.done;
}

export async function deleteStoredDbc(id: string): Promise<void> {
	if (!isIndexedDbAvailable()) return;
	const database = await openDatabase();
	await database.delete(DBC_STORE_NAME, id);
}

export async function resetStoredDbcs(): Promise<void> {
	if (!isIndexedDbAvailable()) return;

	const database = await databasePromise?.catch(() => null);
	database?.close();
	databasePromise = null;
	await deleteDB(DATABASE_NAME);
}

function isIndexedDbAvailable(): boolean {
	return typeof indexedDB !== 'undefined' && typeof globalThis.crypto?.subtle !== 'undefined';
}

export async function storedDbcId(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

let databasePromise: Promise<IDBPDatabase<CanTraceViewerDatabase>> | null = null;

function openDatabase(): Promise<IDBPDatabase<CanTraceViewerDatabase>> {
	databasePromise ??= openDB<CanTraceViewerDatabase>(DATABASE_NAME, DATABASE_VERSION, {
		upgrade(database) {
			database.createObjectStore(DBC_STORE_NAME, { keyPath: 'id' });
		},
		blocking() {
			const closing = databasePromise;
			databasePromise = null;
			void closing?.then((database) => database.close());
		},
		terminated() {
			databasePromise = null;
		}
	});
	return databasePromise;
}
