import {
	closeDbc,
	getDbcCatalog,
	openDbc,
	type DbcHandle,
	type DbcMessage,
	type DbcMessageIdentity,
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
import {
	createFuzzySearchIndex,
	searchFuzzyIndex,
	type FuzzySearchIndex
} from '$lib/fuzzy-match.js';

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

export type SidebarFilterOptions = {
	query: string;
	activeOnly: boolean;
	isSignalSelected: (key: string) => boolean;
};

export type DbcSignalTarget = {
	file: DbcFileEntry;
	message: DbcMessage;
	signal: DbcSignal;
};

type SignalTargetIndex = Record<string, DbcSignalTarget>;
type DbcCandidate = {
	entry: DbcFileEntry;
	stored: StoredDbc;
};
type SidebarSearchEntry = {
	messageKey: string;
	signal: SidebarDbcSignal;
};
type SidebarSearchIndex = {
	dbc: SidebarDbcFile;
	signals: FuzzySearchIndex<SidebarSearchEntry>;
};

class DbcFilesStore {
	files = $state<DbcFileEntry[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);
	hasLoadedLibrary = $state(false);

	signalTargetByKey = $derived.by(() => buildSignalTargetIndex(this.files));

	sidebarFiles = $derived.by<SidebarDbcFile[]>(() =>
		this.files.map((entry) => ({
			id: entry.id,
			name: displayDbcName(entry.name),
			messages: entry.catalog.messages.map((message) => ({
				key: sidebarMessageKey(entry.id, message),
				name: message.name,
				signals: message.signals.map((signal) => sidebarSignal(entry.id, message, signal))
			}))
		}))
	);

	private sidebarSearchIndexes = $derived.by<SidebarSearchIndex[]>(() =>
		buildSidebarSearchIndexes(this.sidebarFiles)
	);

	isSidebarFilterActive(filter: SidebarFilterOptions): boolean {
		return normalizeSidebarQuery(filter.query).length > 0 || filter.activeOnly;
	}

	visibleSidebarTree(filter: SidebarFilterOptions): SidebarDbcFile[] {
		const query = normalizeSidebarQuery(filter.query);
		const isFiltering = this.isSidebarFilterActive(filter);

		return this.sidebarSearchIndexes.flatMap((index) => {
			const signalsByMessage: Record<string, SidebarDbcSignal[]> = {};
			const visibleSignals = searchFuzzyIndex(index.signals, query).filter(
				({ signal }) => !filter.activeOnly || filter.isSignalSelected(signal.key)
			);

			for (const { messageKey, signal } of visibleSignals) {
				signalsByMessage[messageKey] ??= [];
				signalsByMessage[messageKey].push(signal);
			}

			const messages = index.dbc.messages
				.map((message) => ({
					...message,
					signals: signalsByMessage[message.key] ?? []
				}))
				.filter((message) => message.signals.length > 0);

			if (isFiltering && messages.length === 0) return [];

			return [{ ...index.dbc, messages }];
		});
	}

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
			assertUniqueMessageIdentities(dbc.name, catalog);
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

function assertUniqueMessageIdentities(fileName: string, catalog: ParsedDbc): void {
	const seen: Record<string, true> = {};

	for (const message of catalog.messages) {
		const key = messageIdentityKey(message);
		if (seen[key]) {
			throw new Error(
				`${displayDbcName(fileName)} contains multiple messages with the same CAN ID, frame format, and payload length.`
			);
		}

		seen[key] = true;
	}
}

export function messageIdentityKey(message: DbcMessageIdentity): string {
	return `${message.isExtended ? 'extended' : 'standard'}:${message.canId}:${message.sizeBytes}`;
}

export function displayDbcName(fileName: string): string {
	return fileName.replace(/\.dbc$/i, '');
}

function buildSignalTargetIndex(files: DbcFileEntry[]): SignalTargetIndex {
	const index: SignalTargetIndex = {};

	for (const file of files) {
		for (const message of file.catalog.messages) {
			for (const signal of message.signals) {
				index[signalIdentityKey(file.id, message, signal.name)] = { file, message, signal };
			}
		}
	}

	return index;
}

function buildSidebarSearchIndexes(files: SidebarDbcFile[]): SidebarSearchIndex[] {
	return files.map((dbc) => {
		const signals = dbc.messages.flatMap<SidebarSearchEntry>((message) =>
			message.signals.map((signal) => ({ messageKey: message.key, signal }))
		);

		return {
			dbc,
			signals: createFuzzySearchIndex(signals, ({ signal }) => signal.label)
		};
	});
}

function normalizeSidebarQuery(query: string): string {
	return query.trim().toLowerCase();
}

export function signalIdentityKey(
	dbcFileId: string,
	message: DbcMessageIdentity,
	signalName: string
): string {
	return JSON.stringify([dbcFileId, messageIdentityKey(message), signalName]);
}

function sidebarMessageKey(dbcFileId: string, message: DbcMessage): string {
	return JSON.stringify([dbcFileId, messageIdentityKey(message)]);
}

function sidebarSignal(
	dbcFileId: string,
	message: DbcMessage,
	signal: DbcSignal
): SidebarDbcSignal {
	return {
		key: signalIdentityKey(dbcFileId, message, signal.name),
		label: `${message.name}.${signal.name}`,
		messageName: message.name,
		signalName: signal.name
	};
}

async function closeEntries(entries: DbcFileEntry[]): Promise<void> {
	await Promise.all(entries.map((entry) => closeDbc(entry.handle)));
}

export const dbcFiles = new DbcFilesStore();
