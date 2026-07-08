import {
	closeDbc,
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
import { assertTextFileContent } from '$lib/file-preflight.js';
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

export type SelectorDbcFile = {
	id: string;
	name: string;
	messages: SelectorDbcMessage[];
};

export type SelectorDbcMessage = {
	key: string;
	name: string;
	signals: SelectorDbcSignal[];
};

export type SelectorDbcSignal = {
	key: string;
	label: string;
	messageName: string;
	signalName: string;
};

export type SelectorFilterOptions = {
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
type SelectorSearchEntry = {
	messageKey: string;
	signal: SelectorDbcSignal;
};
type SelectorSearchIndex = {
	dbc: SelectorDbcFile;
	signals: FuzzySearchIndex<SelectorSearchEntry>;
};

class DbcFilesStore {
	files = $state<DbcFileEntry[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);
	hasLoadedLibrary = $state(false);

	signalTargetByKey = $derived.by(() => buildSignalTargetIndex(this.files));

	selectorFiles = $derived.by<SelectorDbcFile[]>(() =>
		this.files.map((entry) => ({
			id: entry.id,
			name: displayDbcName(entry.name),
			messages: entry.catalog.messages.map((message) => ({
				key: selectorMessageKey(entry.id, message),
				name: message.name,
				signals: message.signals.map((signal) => selectorSignal(entry.id, message, signal))
			}))
		}))
	);

	private selectorSearchIndexes = $derived.by<SelectorSearchIndex[]>(() =>
		buildSelectorSearchIndexes(this.selectorFiles)
	);

	isSelectorFilterActive(filter: SelectorFilterOptions): boolean {
		return normalizeSelectorQuery(filter.query).length > 0 || filter.activeOnly;
	}

	visibleSelectorTree(filter: SelectorFilterOptions): SelectorDbcFile[] {
		const query = normalizeSelectorQuery(filter.query);
		const isFiltering = this.isSelectorFilterActive(filter);

		return this.selectorSearchIndexes.flatMap((index) => {
			const signalsByMessage: Record<string, SelectorDbcSignal[]> = {};
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
		const seenIds: Record<string, true> = {};
		for (const file of this.files) {
			seenIds[file.id] = true;
		}

		try {
			for (const file of files) {
				const stored = await this.storedFile(file);
				if (seenIds[stored.id]) continue;

				seenIds[stored.id] = true;
				candidates.push(await this.openStoredDbc(stored));
			}

			const entries = candidates.map((candidate) => candidate.entry);
			if (entries.length > 0) {
				await putStoredDbcs(candidates.map((candidate) => candidate.stored));
				this.files = [...this.files, ...entries];
			}
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
		const failedNames: string[] = [];
		try {
			for (const dbc of await listStoredDbcs()) {
				try {
					candidates.push((await this.openStoredDbc(dbc)).entry);
				} catch {
					failedNames.push(dbc.name);
				}
			}

			this.files = candidates;
			this.error = failedNames.length > 0 ? failedStoredDbcMessage(failedNames) : null;
		} catch {
			await closeEntries(candidates);
			this.files = [];
			this.error = 'Saved DBC library could not be read.';
		} finally {
			this.hasLoadedLibrary = true;
			this.isLoading = false;
		}
	}

	private async storedFile(file: File): Promise<StoredDbc> {
		assertDbcFileName(file);
		assertFileSizeWithinLimit(file, DBC_MAX_FILE_BYTES, 'DBC');

		const bytes = new Uint8Array(await file.arrayBuffer());
		assertTextFileContent(bytes, 'DBC');
		const text = new TextDecoder().decode(bytes);
		return { id: await storedDbcId(text), name: file.name, text };
	}

	private async openStoredDbc(dbc: StoredDbc): Promise<DbcCandidate> {
		const { handle, catalog } = await openDbc(dbc.text);

		try {
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

function failedStoredDbcMessage(names: string[]): string {
	if (names.length === 1) {
		return `Saved DBC "${names[0]}" failed to load.`;
	}

	return `${names.length} saved DBC files failed to load: ${names.join(', ')}.`;
}

function assertDbcFileName(file: File): void {
	if (/\.dbc$/i.test(file.name)) return;

	throw new Error('Unsupported DBC file type. Open .dbc.');
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
				index[signalIdentityKey(file.id, message, signal.name)] = {
					file,
					message,
					signal
				};
			}
		}
	}

	return index;
}

function buildSelectorSearchIndexes(files: SelectorDbcFile[]): SelectorSearchIndex[] {
	return files.map((dbc) => {
		const signals = dbc.messages.flatMap<SelectorSearchEntry>((message) =>
			message.signals.map((signal) => ({ messageKey: message.key, signal }))
		);

		return {
			dbc,
			signals: createFuzzySearchIndex(signals, ({ signal }) => signal.label)
		};
	});
}

function normalizeSelectorQuery(query: string): string {
	return query.trim().toLowerCase();
}

export function signalIdentityKey(
	dbcFileId: string,
	message: DbcMessageIdentity,
	signalName: string
): string {
	return JSON.stringify([dbcFileId, messageIdentityKey(message), signalName]);
}

function selectorMessageKey(dbcFileId: string, message: DbcMessage): string {
	return JSON.stringify([dbcFileId, messageIdentityKey(message)]);
}

function selectorSignal(
	dbcFileId: string,
	message: DbcMessage,
	signal: DbcSignal
): SelectorDbcSignal {
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
