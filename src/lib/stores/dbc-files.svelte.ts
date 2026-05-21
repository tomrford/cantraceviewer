import {
	closeDbc,
	getDbcCatalog,
	openDbc,
	type DbcHandle,
	type DbcMessage,
	type DbcSignal,
	type ParsedDbc
} from '$lib/wasm.js';
import {
	deleteStoredDbc,
	listStoredDbcs,
	putStoredDbcs,
	resetStoredDbcs,
	storedDbcId,
	type StoredDbc
} from './dbc-library.js';
import { DBC_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '$lib/file-limits.js';

export type DbcFileEntry = {
	id: string;
	name: string;
	handle: DbcHandle;
	catalog: ParsedDbc;
};

export type SidebarDbcFile = {
	id: string;
	name: string;
	messages: SidebarDbcMessage[];
};

export type SidebarDbcMessage = {
	key: string;
	name: string;
	signals: SidebarDbcSignal[];
};

export type SidebarDbcSignal = {
	key: string;
	label: string;
	messageName: string;
	signalName: string;
};

export type DbcSignalTarget = {
	file: DbcFileEntry;
	message: DbcMessage;
	signal: DbcSignal;
};

type DbcMessageIdentity = {
	key: string;
	canId: number;
	isExtended: boolean;
	isFd: boolean;
	fileName: string;
	messageName: string;
};

type CanIdIndex = Record<string, DbcMessageIdentity>;
type SignalTargetIndex = Record<string, DbcSignalTarget>;
type DbcCandidate = {
	entry: DbcFileEntry;
	stored: StoredDbc;
};

class DbcFilesStore {
	files = $state<DbcFileEntry[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);
	hasLoadedLibrary = $state(false);

	canIdIndex = $derived.by(() => buildCanIdIndex(this.files));
	signalTargetByKey = $derived.by(() => buildSignalTargetIndex(this.files));

	sidebarFiles = $derived.by<SidebarDbcFile[]>(() =>
		this.files.map((entry) => ({
			id: entry.id,
			name: displayDbcName(entry.name),
			messages: entry.catalog.messages.map((message) => ({
				key: messageKey(entry.id, message.name),
				name: message.name,
				signals: message.signals.map((signal) => sidebarSignal(entry.id, message, signal))
			}))
		}))
	);

	async addFiles(files: Iterable<File>): Promise<void> {
		if (this.isLoading) return;

		this.error = null;
		this.isLoading = true;
		const candidates: DbcCandidate[] = [];

		try {
			for (const file of files) {
				candidates.push(await this.openFile(file));
			}

			const entries = candidates.map((candidate) => candidate.entry);
			assertNoCanIdOverlaps(this.canIdIndex, entries);
			await putStoredDbcs(candidates.map((candidate) => candidate.stored));
			this.files = [...this.files, ...entries];
		} catch (error) {
			await closeEntries(candidates.map((candidate) => candidate.entry));
			this.error = error instanceof Error ? error.message : 'DBC load failed';
		} finally {
			this.isLoading = false;
		}
	}

	async removeFile(id: string): Promise<void> {
		const entry = this.files.find((file) => file.id === id);
		if (!entry) return;

		this.files = this.files.filter((file) => file.id !== id);
		await closeDbc(entry.handle);
		await deleteStoredDbc(entry.id);
	}

	async clear(): Promise<void> {
		const handles = this.files.map((file) => file.handle);
		this.files = [];
		await Promise.all(handles.map((handle) => closeDbc(handle)));
	}

	async resetLibrary(): Promise<void> {
		this.error = null;
		this.hasLoadedLibrary = true;
		await this.clear();
		await resetStoredDbcs();
	}

	clearError(): void {
		this.error = null;
	}

	async loadLibrary(): Promise<void> {
		if (this.hasLoadedLibrary || this.isLoading) return;

		this.error = null;
		this.isLoading = true;

		const candidates: DbcFileEntry[] = [];
		try {
			for (const dbc of await listStoredDbcs()) {
				candidates.push((await this.openStoredDbc(dbc)).entry);
			}

			assertNoCanIdOverlaps({}, candidates);
			this.files = candidates;
			this.hasLoadedLibrary = true;
		} catch {
			await closeEntries(candidates);
			await resetStoredDbcs();
			this.files = [];
			this.error = null;
			this.hasLoadedLibrary = true;
		} finally {
			this.isLoading = false;
		}
	}

	private async openFile(file: File): Promise<DbcCandidate> {
		assertFileSizeWithinLimit(file, DBC_MAX_FILE_BYTES, 'DBC');

		const text = await file.text();
		return this.openStoredDbc({ id: await storedDbcId(text), name: file.name, text });
	}

	private async openStoredDbc(dbc: StoredDbc): Promise<DbcCandidate> {
		const handle = await openDbc(dbc.text);

		try {
			const catalog = await getDbcCatalog(handle);
			return {
				entry: {
					id: dbc.id,
					name: dbc.name,
					handle,
					catalog
				},
				stored: dbc
			};
		} catch (error) {
			await closeDbc(handle);
			throw error;
		}
	}
}

function buildCanIdIndex(files: DbcFileEntry[]): CanIdIndex {
	const index: CanIdIndex = {};

	for (const entry of files) {
		for (const identity of messageIdentities(entry)) {
			index[identity.key] = identity;
		}
	}

	return index;
}

function assertNoCanIdOverlaps(existingIndex: CanIdIndex, candidates: DbcFileEntry[]): void {
	const candidateIndex: CanIdIndex = {};

	for (const entry of candidates) {
		for (const identity of messageIdentities(entry)) {
			const existing = existingIndex[identity.key] ?? candidateIndex[identity.key];

			if (existing) {
				throw new Error(
					`${displayDbcName(identity.fileName)} contains messages which overlap with those defined in existing files.`
				);
			}

			candidateIndex[identity.key] = identity;
		}
	}
}

function messageIdentities(entry: DbcFileEntry): DbcMessageIdentity[] {
	return entry.catalog.messages.map((message) => ({
		key: canIdKey(message.canId, message.isExtended),
		canId: message.canId,
		isExtended: message.isExtended,
		isFd: message.isFd,
		fileName: entry.name,
		messageName: message.name
	}));
}

function canIdKey(canId: number, isExtended: boolean): string {
	return `${isExtended ? 'extended' : 'standard'}:${canId}`;
}

export function displayDbcName(fileName: string): string {
	return fileName.replace(/\.dbc$/i, '');
}

function buildSignalTargetIndex(files: DbcFileEntry[]): SignalTargetIndex {
	const index: SignalTargetIndex = {};

	for (const file of files) {
		for (const message of file.catalog.messages) {
			for (const signal of message.signals) {
				index[signalKey(file.id, message.name, signal.name)] = { file, message, signal };
			}
		}
	}

	return index;
}

export function signalKey(dbcFileId: string, messageName: string, signalName: string): string {
	return JSON.stringify([dbcFileId, messageName, signalName]);
}

function messageKey(dbcFileId: string, messageName: string): string {
	return JSON.stringify([dbcFileId, messageName]);
}

function sidebarSignal(
	dbcFileId: string,
	message: DbcMessage,
	signal: DbcSignal
): SidebarDbcSignal {
	return {
		key: signalKey(dbcFileId, message.name, signal.name),
		label: `${message.name}.${signal.name}`,
		messageName: message.name,
		signalName: signal.name
	};
}

async function closeEntries(entries: DbcFileEntry[]): Promise<void> {
	await Promise.all(entries.map((entry) => closeDbc(entry.handle)));
}

export const dbcFiles = new DbcFilesStore();
