export type StoredDbc = {
	id: string;
	name: string;
	text: string;
};

type StoredDbcValue = Omit<StoredDbc, 'id'>;

const DATABASE_NAME = 'cantraceviewer';
const DATABASE_VERSION = 1;
const DBC_STORE_NAME = 'dbc-files';

export async function listStoredDbcs(): Promise<StoredDbc[]> {
	if (!isIndexedDbAvailable()) return [];
	const database = await openDatabase();
	const transaction = database.transaction(DBC_STORE_NAME);
	const done = transactionDone(transaction);
	const store = transaction.objectStore(DBC_STORE_NAME);
	const [values, keys] = await Promise.all([
		requestToPromise(store.getAll() as IDBRequest<StoredDbcValue[]>),
		requestToPromise(store.getAllKeys())
	]);
	await done;
	return values.map((value, index) => ({ id: String(keys[index]), ...value }));
}

export async function putStoredDbcs(dbcs: StoredDbc[]): Promise<void> {
	if (!isIndexedDbAvailable() || dbcs.length === 0) return;
	const database = await openDatabase();
	const transaction = database.transaction(DBC_STORE_NAME, 'readwrite');
	const done = transactionDone(transaction);
	const store = transaction.objectStore(DBC_STORE_NAME);
	for (const { id, name, text } of dbcs) {
		store.put({ name, text } satisfies StoredDbcValue, id);
	}
	await done;
}

export async function deleteStoredDbc(id: string): Promise<void> {
	if (!isIndexedDbAvailable()) return;
	const database = await openDatabase();
	const transaction = database.transaction(DBC_STORE_NAME, 'readwrite');
	const done = transactionDone(transaction);
	transaction.objectStore(DBC_STORE_NAME).delete(id);
	await done;
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

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
	databasePromise ??= new Promise((resolve, reject) => {
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
	return databasePromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('DBC library request failed'));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = transaction.onerror = () =>
			reject(transaction.error ?? new Error('DBC library transaction failed'));
	});
}
