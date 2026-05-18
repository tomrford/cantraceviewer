import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type StoredDbc = {
	id: string;
	name: string;
	text: string;
};

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
	if (!isIndexedDbAvailable() || dbcs.length === 0) return;
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
	const transaction = database.transaction(DBC_STORE_NAME, 'readwrite');
	transaction.objectStore(DBC_STORE_NAME).delete(id);
	await transaction.done;
}

function isIndexedDbAvailable(): boolean {
	return typeof indexedDB !== 'undefined' && typeof globalThis.crypto?.subtle !== 'undefined';
}

export async function storedDbcId(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

let databasePromise: Promise<IDBPDatabase<CanTraceViewerDatabase>> | null = null;

function openDatabase(): Promise<IDBPDatabase<CanTraceViewerDatabase>> {
	databasePromise ??= openDB<CanTraceViewerDatabase>(DATABASE_NAME, DATABASE_VERSION, {
		upgrade(database) {
			if (database.objectStoreNames.contains(DBC_STORE_NAME)) {
				database.deleteObjectStore(DBC_STORE_NAME);
			}
			database.createObjectStore(DBC_STORE_NAME, { keyPath: 'id' });
		},
		blocking() {
			void databasePromise?.then((database) => database.close());
		},
		terminated() {
			databasePromise = null;
		}
	});
	return databasePromise;
}
