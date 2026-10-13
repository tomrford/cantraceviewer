import { traceFile } from './trace-file.svelte.js';
import type { RawMessage, RawSource } from '#lib/wasm.js';
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
} from '#lib/wasm.js';
import {
	deleteStoredDbc,
	listStoredDbcs,
	putStoredDbcs,
	resetStoredDbcs,
	storedDbcId,
	type StoredDbc
} from './dbc-library.js';
import { DBC_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '#lib/file-limits.js';
import { createSearchIndex, searchIndex, type SearchIndex } from '#lib/search-index.js';

export type DbcOrigin = 'library' | 'mf4' | 'demo';

export type DbcFileEntry = {
	id: string;
	name: string;
	handle: DbcHandle;
	catalog: ParsedDbc;
	warnings: DbcDiagnostic[];
	origin: DbcOrigin;
};

export type SelectorDbcFile = {
	id: string;
	name: string;
	messages: SelectorDbcMessage[];
	kind: 'dbc' | 'mf4-native';
	transient: boolean;
	badge?: string;
};

type SelectorDbcMessage = {
	key: string;
	name: string;
	sourceLabel?: string;
	sourceBadges?: string[];
	signals: SelectorDbcSignal[];
};

type SelectorDbcSignal = {
	unavailableReason?: string;
	key: string;
	label: string;
	messageName: string;
	signalName: string;
	arbitrationId?: string;
};

type SelectorFilterOptions = {
	hideUnavailable?: boolean;
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
	badge?: string;
};

type SelectorTreeMessage = {
	key: string;
	name: string;
	sourceLabel?: string;
	sourceBadges?: string[];
	expanded: boolean;
	signals: SelectorDbcSignal[];
};

export type DbcSignalTarget = {
	unavailableReason?: string;
	source?: RawSource;
	sourceBadges?: string[];
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

	signalTargetByKey = $derived.by(() =>
		buildSignalTargetIndex(this.files, this.rawMessagesById, traceFile.entry !== null)
	);

	selectorFiles = $derived.by<SelectorDbcFile[]>(() =>
		this.files.map((entry) => ({
			id: entry.id,
			name: displayDbcName(entry.name),
			kind: 'dbc',
			transient: isTransientOrigin(entry.origin),
			badge: originBadge(entry.origin),
			messages: entry.catalog.messages.flatMap((message) =>
				sourceOptions(message, this.rawMessagesById).map((source) => ({
					key: selectorMessageKey(entry.id, message, source),
					name: message.name,
					sourceLabel: sourceLabel(source),
					sourceBadges: sourceBadges(source, sourceOptions(message, this.rawMessagesById)),
					signals: message.signals.map((signal) => ({
						...selectorSignal(entry.id, message, signal, source),
						unavailableReason: messageUnavailableReason(
							message,
							this.rawMessagesById,
							traceFile.entry !== null
						)
					}))
				}))
			)
		}))
	);

	private selectorSearchIndexes = $derived.by<SelectorSearchIndex[]>(() =>
		buildSelectorSearchIndexes(this.selectorFiles)
	);

	private isSelectorFilterActive(filter: SelectorFilterOptions): boolean {
		return (
			normalizeSelectorQuery(filter.query).length > 0 ||
			filter.activeOnly ||
			!!filter.hideUnavailable
		);
	}

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
				({ signal }) =>
					(!filter.activeOnly || filter.isSignalSelected(signal.key)) &&
					(!filter.hideUnavailable || !signal.unavailableReason)
			);

			for (const { messageKey, signal } of visibleSignals) {
				signalsByMessage[messageKey] ??= [];
				signalsByMessage[messageKey].push(signal);
			}

			const messages = index.dbc.messages
				.map((message) => ({
					...message,
					expanded: filter.expandedMessageKeys.has(message.key),
					signals: signalsByMessage[message.key] ?? []
				}))
				.filter((message) => message.signals.length > 0);

			if (messages.length === 0) return [];

			return [
				{
					...index.dbc,
					expanded: filter.expandedDbcIds.has(index.dbc.id),
					messages: !filter.expandedDbcIds.has(index.dbc.id)
						? []
						: messages.map((message) => ({
								...message,
								signals: message.expanded ? message.signals : []
							}))
				}
			];
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
				if (seenIds[stored.id]) {
					await this.promoteDemoDbc(stored);
					continue;
				}

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
		switch (entry.origin) {
			case 'library':
				await deleteStoredDbc(entry.id);
				break;
			case 'mf4':
			case 'demo':
				break;
			default: {
				const unexpected: never = entry.origin;
				return unexpected;
			}
		}
	}

	addTransientDbcs(ownerTraceId: number, dbcs: EmbeddedDbc[]): Promise<void> {
		return this.runLibraryOperation(() => this.importTransientDbcs(ownerTraceId, dbcs));
	}

	private async importTransientDbcs(ownerTraceId: number, dbcs: EmbeddedDbc[]): Promise<void> {
		this.error = null;
		await this.clearTransientDbcs();
		const entries: DbcFileEntry[] = [];
		try {
			for (const [index, dbc] of dbcs.entries()) {
				const stored = {
					id: `mf4:${ownerTraceId}:${index}`,
					name: dbc.name,
					bytes: dbc.bytes
				};
				entries.push((await this.openStoredDbc(stored, 'mf4')).entry);
			}
			this.files = [...this.files, ...entries];
		} catch (error) {
			await closeEntries(entries);
			this.error = error instanceof Error ? error.message : 'Embedded DBC load failed';
		}
	}

	addDemoDbc(file: File): Promise<void> {
		return this.runLibraryOperation(() => this.importDemoDbc(file));
	}

	dropDemoDbcs(): Promise<void> {
		return this.runLibraryOperation(() => this.removeDemoDbcs());
	}

	async clearTransientDbcs(): Promise<void> {
		const removed = this.files.filter((file) => isTransientOrigin(file.origin));
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
		const failures: string[] = [];
		try {
			for (const dbc of await listStoredDbcs()) {
				try {
					candidates.push((await this.openStoredDbc(dbc)).entry);
				} catch (error) {
					failures.push(error instanceof Error ? error.message : `${dbc.name}: DBC load failed`);
				}
			}

			this.files = [...candidates, ...this.files.filter((file) => isTransientOrigin(file.origin))];
			this.error = failures.length > 0 ? failures.join('\n') : null;
		} catch {
			await closeEntries(candidates);
			this.files = this.files.filter((file) => isTransientOrigin(file.origin));
			this.error = 'Saved DBC library could not be read.';
		} finally {
			this.hasLoadedLibrary = true;
		}
	}

	// Order reads, imports and resets, including persistent writes and newer trace DBCs.
	// Keep the loading gate held until the last queued operation has finished.
	private runLibraryOperation(action: () => Promise<void>): Promise<void> {
		this.isLoading = true;
		const operation = this.libraryOperation.then(action, action);
		this.libraryOperation = operation;
		return operation.finally(() => {
			if (this.libraryOperation === operation) this.isLoading = false;
		});
	}

	private async importDemoDbc(file: File): Promise<void> {
		this.error = null;
		let opened: DbcFileEntry | null = null;
		try {
			const stored = await this.storedFile(file);
			if (this.files.some((entry) => entry.id === stored.id)) return;

			opened = (await this.openStoredDbc(stored, 'demo')).entry;
			this.files = [...this.files, opened];
			opened = null;
		} catch (error) {
			if (opened) await closeDbc(opened.handle);
			this.error = error instanceof Error ? error.message : 'DBC load failed';
		}
	}

	private async removeDemoDbcs(): Promise<void> {
		const removed = this.files.filter((file) => file.origin === 'demo');
		if (removed.length === 0) return;
		const removedIds = new Set(removed.map((file) => file.id));
		this.files = this.files.filter((file) => !removedIds.has(file.id));
		await closeEntries(removed);
	}

	private async promoteDemoDbc(stored: StoredDbc): Promise<void> {
		const existing = this.files.find((entry) => entry.id === stored.id);
		if (!existing) return;

		switch (existing.origin) {
			case 'demo':
				await putStoredDbcs([stored]);
				existing.name = stored.name;
				existing.origin = 'library';
				return;
			case 'library':
			case 'mf4':
				return;
			default: {
				const unexpected: never = existing.origin;
				return unexpected;
			}
		}
	}

	private async storedFile(file: File): Promise<StoredDbc> {
		assertDbcFileName(file);
		assertFileSizeWithinLimit(file, DBC_MAX_FILE_BYTES, 'DBC');

		const bytes = new Uint8Array(await file.arrayBuffer());
		return { id: await storedDbcId(bytes), name: file.name, bytes };
	}

	private async openStoredDbc(
		dbc: StoredDbc,
		origin: DbcFileEntry['origin'] = 'library'
	): Promise<DbcCandidate> {
		const { handle, catalog, warnings } = await openDbc(dbc.bytes ?? dbc.text).catch((error) => {
			throw new Error(`${dbc.name}: ${error instanceof Error ? error.message : 'DBC load failed'}`);
		});

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
	}
}

function isTransientOrigin(origin: DbcOrigin): boolean {
	switch (origin) {
		case 'library':
			return false;
		case 'mf4':
		case 'demo':
			return true;
		default: {
			const unexpected: never = origin;
			return unexpected;
		}
	}
}

function originBadge(origin: DbcOrigin): string | undefined {
	switch (origin) {
		case 'library':
			return undefined;
		case 'mf4':
			return 'MF4';
		case 'demo':
			return 'Example';
		default: {
			const unexpected: never = origin;
			return unexpected;
		}
	}
}

function assertDbcFileName(file: File): void {
	if (/\.dbc$/i.test(file.name)) return;

	throw new Error('Unsupported DBC file type. Open .dbc.');
}

function messageIdentityKey(message: DbcMessageIdentity): string {
	return `${message.isExtended ? 'extended' : 'standard'}:${message.canId}:${message.sizeBytes}`;
}

function displayDbcName(fileName: string): string {
	return fileName.replace(/\.dbc$/i, '');
}

function buildSignalTargetIndex(
	files: DbcFileEntry[],
	rawMessages: Map<string, RawMessage[]>,
	traceLoaded: boolean
): SignalTargetIndex {
	const index: SignalTargetIndex = {};

	for (const file of files) {
		for (const message of file.catalog.messages) {
			for (const source of sourceOptions(message, rawMessages)) {
				for (const signal of message.signals) {
					index[signalIdentityKey(file.id, message, signal.name, source)] = {
						unavailableReason: messageUnavailableReason(message, rawMessages, traceLoaded),
						file,
						message,
						signal,
						source,
						sourceBadges: sourceBadges(source, sourceOptions(message, rawMessages))
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
		messageName: message.name,
		signalName: signal.name,
		arbitrationId: message.canId.toString(16)
	};
}

function sourceOptions(
	message: DbcMessage,
	rawMessages: Map<string, RawMessage[]>
): (RawSource | undefined)[] {
	const matches = rawMessages.get(rawMessageIdentityKey(message)) ?? [];
	return matches.length ? matches.map((raw) => raw.source) : [undefined];
}

function messageUnavailableReason(
	message: DbcMessage,
	rawMessages: Map<string, RawMessage[]>,
	traceLoaded: boolean
): string | undefined {
	if (message.rawFrameDecodable === false) return 'Plotting not yet supported';
	if (traceLoaded && !rawMessages.has(rawMessageIdentityKey(message)))
		return 'Not present in this trace';
	return undefined;
}

function rawMessageIdentityKey(message: Pick<DbcMessageIdentity, 'canId' | 'isExtended'>): string {
	return `${message.canId}:${message.isExtended}`;
}

function sourceBadges(source: RawSource | undefined, sources: (RawSource | undefined)[]): string[] {
	if (!source || sources.length < 2) return [];
	const badges: string[] = [];
	if (new Set(sources.map((item) => item?.channel)).size > 1) {
		badges.push(source.channel === null ? 'Unknown channel' : String(source.channel));
	}
	if (new Set(sources.map((item) => item?.direction)).size > 1) {
		badges.push({ unknown: 'Unknown direction', rx: 'Rx', tx: 'Tx' }[source.direction]);
	}
	return badges;
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
