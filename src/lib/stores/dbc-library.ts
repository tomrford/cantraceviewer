export type StoredDbc = {
	name: string;
	text: string;
};

const DATABASE_NAME = 'cantraceviewer';
const DATABASE_VERSION = 1;
const DBC_STORE_NAME = 'dbc-files';

export async function listStoredDbcs(): Promise<StoredDbc[]> {
	if (!isIndexedDbAvailable()) return [];
	const database = await openDatabase();
	return requestToPromise(
		database.transaction(DBC_STORE_NAME).objectStore(DBC_STORE_NAME).getAll()
	);
}

export async function putStoredDbc(dbc: StoredDbc): Promise<void> {
	if (!isIndexedDbAvailable()) return;
	const database = await openDatabase();
	const id = await storedDbcId(dbc.text);
	await requestToPromise(
		database.transaction(DBC_STORE_NAME, 'readwrite').objectStore(DBC_STORE_NAME).put(dbc, id)
	);
}

export async function deleteStoredDbc(dbc: StoredDbc): Promise<void> {
	if (!isIndexedDbAvailable()) return;
	const database = await openDatabase();
	const id = await storedDbcId(dbc.text);
	await requestToPromise(
		database.transaction(DBC_STORE_NAME, 'readwrite').objectStore(DBC_STORE_NAME).delete(id)
	);
}

function isIndexedDbAvailable(): boolean {
	return typeof indexedDB !== 'undefined' && typeof globalThis.crypto?.subtle !== 'undefined';
}

export async function storedDbcId(text: string): Promise<string> {
	if (typeof globalThis.crypto?.subtle === 'undefined') return fallbackHashText(text);

	const bytes = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fallbackHashText(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(DBC_STORE_NAME)) {
				database.createObjectStore(DBC_STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('DBC library failed to open'));
	});
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('DBC library request failed'));
	});
}
