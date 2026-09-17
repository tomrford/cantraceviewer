import { traceFile } from './trace-file.svelte.js';
import {
	closeDbc,
	openDbc,
	type DbcHandle,
	type DbcDiagnostic,
	type DbcMessage,
	type DbcMessageIdentity,
	type DbcSignal,
	type EmbeddedDbc,
	type ParsedDbc
} from '$lib/wasm.js';
import type { RawMessage, RawSource } from '$lib/wasm.js';
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
import { createSearchIndex, searchIndex, type SearchIndex } from '$lib/search-index.js';

export type DbcFileEntry = {
	id: string;
	name: string;
	handle: DbcHandle;
	catalog: ParsedDbc;
	warnings: DbcDiagnostic[];
	origin: 'library' | 'mf4';
};

export type SelectorDbcFile = {
	id: string;
	name: string;
	messages: SelectorDbcMessage[];
	kind: 'dbc' | 'mf4-native';
	transient: boolean;
};

type SelectorDbcMessage = {
	key: string;
	name: string;
	signals: SelectorDbcSignal[];
};

type SelectorDbcSignal = {
	key: string;
	label: string;
	messageName: string;
	signalName: string;
	arbitrationId?: string;
};

type SelectorFilterOptions = {
	query: string;
	activeOnly: boolean;
	isSignalSelected: (key: string) => boolean;
	expandedDbcIds: ReadonlySet<string>;
	expandedMessageKeys: ReadonlySet<string>;
};

type SelectorTreeDbc = {
	id: string;
	name: string;
	expanded: boolean;
	messages: SelectorTreeMessage[];
	kind: 'dbc' | 'mf4-native';
	transient: boolean;
};

type SelectorTreeMessage = {
	key: string;
	name: string;
	expanded: boolean;
	signals: SelectorDbcSignal[];
};

export type DbcSignalTarget = {
	source?: RawSource;
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
export type SelectorSearchIndex = {
	dbc: SelectorDbcFile;
	signals: SearchIndex<SelectorSearchEntry>;
};

class DbcFilesStore {
	files = $state<DbcFileEntry[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);
	hasLoadedLibrary = $state(false);
	private libraryOperation = Promise.resolve();

	private rawMessagesById = $derived(
		Map.groupBy(traceFile.entry?.metadata.rawMessages ?? [], rawMessageIdentityKey)
	);

	signalTargetByKey = $derived.by(() => buildSignalTargetIndex(this.files, this.rawMessagesById));

	selectorFiles = $derived.by<SelectorDbcFile[]>(() =>
		this.files.map((entry) => ({
			id: entry.id,
			name: displayDbcName(entry.name),
			kind: 'dbc',
			transient: entry.origin === 'mf4',
			messages: entry.catalog.messages.flatMap((message) =>
				sourceOptions(message, this.rawMessagesById).map((source) => ({
					key: selectorMessageKey(entry.id, message, source),
					name: message.name + sourceLabel(source),
					signals: message.signals.map((signal) =>
						selectorSignal(entry.id, message, signal, source)
					)
				}))
			)
		}))
	);

	private selectorSearchIndexes = $derived.by<SelectorSearchIndex[]>(() =>
		buildSelectorSearchIndexes(this.selectorFiles)
	);

	private isSelectorFilterActive(filter: SelectorFilterOptions): boolean {
		return normalizeSelectorQuery(filter.query).length > 0 || filter.activeOnly;
	}

	// The returned tree is the single source of what the selector renders:
	// collapsed nodes carry empty children so collapsed content never mounts,
	// and expansion flips arrive as part of the same tree swap as the data.
	visibleSelectorTree(
		filter: SelectorFilterOptions,
		additionalIndexes: SelectorSearchIndex[] = []
	): SelectorTreeDbc[] {
		const query = normalizeSelectorQuery(filter.query);
		const selectorFiles = [...this.selectorFiles, ...additionalIndexes.map((index) => index.dbc)];
		if (!this.isSelectorFilterActive(filter)) {
			return selectorFiles.map((dbc) => {
				if (!filter.expandedDbcIds.has(dbc.id)) return { ...dbc, expanded: false, messages: [] };

				return {
					...dbc,
					expanded: true,
					messages: dbc.messages
						.filter((message) => message.signals.length > 0)
						.map((message) =>
							filter.expandedMessageKeys.has(message.key)
								? { ...message, expanded: true }
								: { ...message, expanded: false, signals: [] }
						)
				};
			});
		}

		const indexes = [...this.selectorSearchIndexes, ...additionalIndexes];
		return indexes.flatMap((index) => {
			const signalsByMessage: Record<string, SelectorDbcSignal[]> = {};
			const visibleSignals = searchIndex(index.signals, query).filter(
				({ signal }) => !filter.activeOnly || filter.isSignalSelected(signal.key)
			);

			for (const { messageKey, signal } of visibleSignals) {
				signalsByMessage[messageKey] ??= [];
				signalsByMessage[messageKey].push(signal);
			}

			const messages = index.dbc.messages
				.map((message) => ({
					...message,
					expanded: true,
					signals: signalsByMessage[message.key] ?? []
				}))
				.filter((message) => message.signals.length > 0);

			if (messages.length === 0) return [];

			return [{ ...index.dbc, expanded: true, messages }];
		});
	}

	addFiles(files: Iterable<File>): Promise<void> {
		if (this.isLoading) return Promise.resolve();
		return this.runLibraryOperation(() => this.importFiles(files));
	}

	private async importFiles(files: Iterable<File>): Promise<void> {
		this.error = null;
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
		}
	}

	async removeFile(id: string): Promise<void> {
		const entry = this.files.find((file) => file.id === id);
		if (!entry) return;

		this.files = this.files.filter((file) => file.id !== id);
		await closeDbc(entry.handle);
		if (entry.origin === 'library') await deleteStoredDbc(entry.id);
	}

	async addTransientDbcs(ownerTraceId: number, dbcs: EmbeddedDbc[]): Promise<void> {
		this.error = null;
		await this.clearTransientDbcs();
		const entries: DbcFileEntry[] = [];
		try {
			for (const [index, dbc] of dbcs.entries()) {
				const stored = {
					id: `mf4:${ownerTraceId}:${index}`,
					name: dbc.name,
					text: dbc.text
				};
				entries.push((await this.openStoredDbc(stored, 'mf4')).entry);
			}
			this.files = [...this.files, ...entries];
		} catch (error) {
			await closeEntries(entries);
			this.error = error instanceof Error ? error.message : 'Embedded DBC load failed';
		}
	}

	async clearTransientDbcs(): Promise<void> {
		const removed = this.files.filter((file) => file.origin === 'mf4');
		if (removed.length === 0) return;
		const removedIds = new Set(removed.map((file) => file.id));
		this.files = this.files.filter((file) => !removedIds.has(file.id));
		await closeEntries(removed);
	}

	async clear(): Promise<void> {
		const handles = this.files.map((file) => file.handle);
		this.files = [];
		await Promise.all(handles.map((handle) => closeDbc(handle)));
	}

	resetLibrary(): Promise<void> {
		return this.runLibraryOperation(async () => {
			this.error = null;
			this.hasLoadedLibrary = true;
			await this.clear();
			await resetStoredDbcs();
		});
	}

	clearError(): void {
		this.error = null;
	}

	loadLibrary(): Promise<void> {
		if (this.hasLoadedLibrary || this.isLoading) return Promise.resolve();
		return this.runLibraryOperation(() => this.readLibrary());
	}

	private async readLibrary(): Promise<void> {
		this.error = null;

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

			this.files = [...candidates, ...this.files.filter((file) => file.origin === 'mf4')];
			this.error = failedNames.length > 0 ? failedStoredDbcMessage(failedNames) : null;
		} catch {
			await closeEntries(candidates);
			this.files = this.files.filter((file) => file.origin === 'mf4');
			this.error = 'Saved DBC library could not be read.';
		} finally {
			this.hasLoadedLibrary = true;
		}
	}

	// Reset runs after an in-flight read/import, including its persistent writes.
	// Keep the loading gate held until the last queued operation has finished.
	private runLibraryOperation(action: () => Promise<void>): Promise<void> {
		this.isLoading = true;
		const operation = this.libraryOperation.then(action, action);
		this.libraryOperation = operation;
		return operation.finally(() => {
			if (this.libraryOperation === operation) this.isLoading = false;
		});
	}

	private async storedFile(file: File): Promise<StoredDbc> {
		assertDbcFileName(file);
		assertFileSizeWithinLimit(file, DBC_MAX_FILE_BYTES, 'DBC');

		const bytes = new Uint8Array(await file.arrayBuffer());
		assertTextFileContent(bytes, 'DBC');
		return { id: await storedDbcId(bytes), name: file.name, bytes };
	}

	private async openStoredDbc(
		dbc: StoredDbc,
		origin: DbcFileEntry['origin'] = 'library'
	): Promise<DbcCandidate> {
		const { handle, catalog, warnings } = await openDbc(dbc.bytes ?? dbc.text).catch((error) => {
			throw new Error(`${dbc.name}: ${error instanceof Error ? error.message : 'DBC load failed'}`);
		});

		try {
			assertUniqueMessageIdentities(dbc.name, catalog);
			return {
				entry: {
					id: dbc.id,
					name: dbc.name,
					handle,
					catalog,
					warnings,
					origin
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

function messageIdentityKey(message: DbcMessageIdentity): string {
	return `${message.isExtended ? 'extended' : 'standard'}:${message.canId}:${message.sizeBytes}`;
}

function displayDbcName(fileName: string): string {
	return fileName.replace(/\.dbc$/i, '');
}

function buildSignalTargetIndex(
	files: DbcFileEntry[],
	rawMessages: Map<string, RawMessage[]>
): SignalTargetIndex {
	const index: SignalTargetIndex = {};

	for (const file of files) {
		for (const message of file.catalog.messages) {
			for (const source of sourceOptions(message, rawMessages)) {
				for (const signal of message.signals) {
					index[signalIdentityKey(file.id, message, signal.name, source)] = {
						file,
						message,
						signal,
						source
					};
				}
			}
		}
	}

	return index;
}

export function buildSelectorSearchIndexes(files: SelectorDbcFile[]): SelectorSearchIndex[] {
	return files.map((dbc) => {
		const signals = dbc.messages.flatMap<SelectorSearchEntry>((message) =>
			message.signals.map((signal) => ({ messageKey: message.key, signal }))
		);

		return {
			dbc,
			signals: createSearchIndex(
				signals,
				({ signal }) => signal.label,
				({ signal }) => signal.arbitrationId
			)
		};
	});
}

function normalizeSelectorQuery(query: string): string {
	return query.trim().toLowerCase();
}

export function signalIdentityKey(
	dbcFileId: string,
	message: DbcMessageIdentity,
	signalName: string,
	source?: RawSource
): string {
	return JSON.stringify([
		dbcFileId,
		messageIdentityKey(message),
		signalName,
		...(source ? [source.channel, source.direction] : [])
	]);
}

function selectorMessageKey(dbcFileId: string, message: DbcMessage, source?: RawSource): string {
	return JSON.stringify([
		dbcFileId,
		messageIdentityKey(message),
		...(source ? [source.channel, source.direction] : [])
	]);
}

function selectorSignal(
	dbcFileId: string,
	message: DbcMessage,
	signal: DbcSignal,
	source?: RawSource
): SelectorDbcSignal {
	const label = `${message.name}.${signal.name}${sourceLabel(source)}`;

	return {
		key: signalIdentityKey(dbcFileId, message, signal.name, source),
		label,
		messageName: message.name + sourceLabel(source),
		signalName: signal.name,
		arbitrationId: message.canId.toString(16)
	};
}

function sourceOptions(
	message: DbcMessage,
	rawMessages: Map<string, RawMessage[]>
): (RawSource | undefined)[] {
	if (message.rawFrameDecodable === false) return [];
	const matches = rawMessages.get(rawMessageIdentityKey(message)) ?? [];
	return matches.length > 1 ? matches.map((raw) => raw.source) : [undefined];
}

function rawMessageIdentityKey(message: Pick<DbcMessageIdentity, 'canId' | 'isExtended'>): string {
	return `${message.canId}:${message.isExtended}`;
}

export function sourceLabel(source?: RawSource): string {
	if (!source) return '';
	const channel = source.channel === null ? 'Unknown channel' : `Channel ${source.channel}`;
	const direction = { unknown: 'unknown direction', rx: 'Rx', tx: 'Tx' }[source.direction];
	return ` [${channel} · ${direction}]`;
}

async function closeEntries(entries: DbcFileEntry[]): Promise<void> {
	await Promise.all(entries.map((entry) => closeDbc(entry.handle)));
}

export const dbcFiles = new DbcFilesStore();
