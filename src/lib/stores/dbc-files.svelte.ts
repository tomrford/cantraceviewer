import {
	closeDbc,
	openDbc,
	type DbcHandle,
	type DbcMessage,
	type DbcMessageIdentity,
	type DbcSignal,
	type EmbeddedDbc,
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
	searchText: string;
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
	signals: FuzzySearchIndex<SelectorSearchEntry>;
	signalsByArbitrationId: Record<string, SelectorSearchEntry[]>;
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
			kind: 'dbc',
			transient: entry.origin === 'mf4',
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
			const visibleSignals = searchSelectorIndex(index, query).filter(
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

			this.files = [...candidates, ...this.files.filter((file) => file.origin === 'mf4')];
			this.error = failedNames.length > 0 ? failedStoredDbcMessage(failedNames) : null;
		} catch {
			await closeEntries(candidates);
			this.files = this.files.filter((file) => file.origin === 'mf4');
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

	private async openStoredDbc(
		dbc: StoredDbc,
		origin: DbcFileEntry['origin'] = 'library'
	): Promise<DbcCandidate> {
		const { handle, catalog } = await openDbc(dbc.text);

		try {
			assertUniqueMessageIdentities(dbc.name, catalog);
			return {
				entry: {
					id: dbc.id,
					name: dbc.name,
					handle,
					catalog,
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

export function buildSelectorSearchIndexes(files: SelectorDbcFile[]): SelectorSearchIndex[] {
	return files.map((dbc) => {
		const signals = dbc.messages.flatMap<SelectorSearchEntry>((message) =>
			message.signals.map((signal) => ({ messageKey: message.key, signal }))
		);
		const signalsByArbitrationId: Record<string, SelectorSearchEntry[]> = {};
		for (const entry of signals) {
			const arbitrationId = entry.signal.arbitrationId;
			if (arbitrationId === undefined) continue;

			signalsByArbitrationId[arbitrationId] ??= [];
			signalsByArbitrationId[arbitrationId].push(entry);
		}

		return {
			dbc,
			signals: createFuzzySearchIndex(signals, ({ signal }) => signal.searchText),
			signalsByArbitrationId
		};
	});
}

function normalizeSelectorQuery(query: string): string {
	return query.trim().toLowerCase();
}

function hexDigits(term: string): string {
	return term.startsWith('0x') ? term.slice(2) : term;
}

function isHexIdTerm(term: string): boolean {
	const digits = hexDigits(term);
	return digits.length > 0 && /^[0-9a-f]+$/u.test(digits);
}

function normalizeArbitrationId(term: string): string {
	const digits = hexDigits(term);
	if (digits.length === 0 || !/^[0-9a-f]+$/u.test(digits)) return '';
	return digits.replace(/^0+/u, '') || '0';
}

const MIN_ARBITRATION_ID_SUBSTRING_LENGTH = 3;

function searchEntryKeys(entries: SelectorSearchEntry[]): Record<string, true> {
	const keys: Record<string, true> = {};
	for (const entry of entries) keys[entry.signal.key] = true;
	return keys;
}

function arbitrationIdHits(index: SelectorSearchIndex, term: string): SelectorSearchEntry[] {
	const raw = hexDigits(term);
	if (raw.length === 0) return [];

	const exactId = normalizeArbitrationId(term);
	const hits: SelectorSearchEntry[] = [];
	const seen: Record<string, true> = {};
	const add = (entries: SelectorSearchEntry[] | undefined): void => {
		if (entries === undefined) return;
		for (const entry of entries) {
			if (seen[entry.signal.key]) continue;
			seen[entry.signal.key] = true;
			hits.push(entry);
		}
	};

	add(index.signalsByArbitrationId[exactId]);
	if (raw.length < MIN_ARBITRATION_ID_SUBSTRING_LENGTH) return hits;

	for (const [arbitrationId, entries] of Object.entries(index.signalsByArbitrationId)) {
		if (arbitrationId === exactId) continue;
		if (
			arbitrationId.includes(raw) ||
			(exactId.length >= MIN_ARBITRATION_ID_SUBSTRING_LENGTH && arbitrationId.includes(exactId))
		) {
			add(entries);
		}
	}

	return hits;
}

// Hex IDs stay out of MiniSearch. One- and two-digit hex terms stay exact so
// prefixes such as "1" or "18" do not match every J1939-style ID.
function searchSelectorIndex(index: SelectorSearchIndex, query: string): SelectorSearchEntry[] {
	const terms = query.split(/[\s\p{P}]+/u).filter(Boolean);
	if (terms.length === 0) return index.signals.items;

	const nameTerms: string[] = [];
	const idTerms: string[] = [];
	for (const term of terms) {
		if (isHexIdTerm(term)) idTerms.push(term);
		else nameTerms.push(term);
	}

	const matchesForIdTerm = (term: string): SelectorSearchEntry[] => {
		const nameHits = searchFuzzyIndex(index.signals, term);
		const idHits = arbitrationIdHits(index, term);
		if (idHits.length === 0) return nameHits;

		const seen = searchEntryKeys(nameHits);
		const extra = idHits.filter((entry) => !seen[entry.signal.key]);
		return extra.length === 0 ? nameHits : [...nameHits, ...extra];
	};

	if (nameTerms.length === 0) {
		const [first, ...rest] = idTerms.map(matchesForIdTerm);
		if (first === undefined) return [];

		const required = rest.map(searchEntryKeys);
		return first.filter((entry) => required.every((matches) => matches[entry.signal.key]));
	}

	const nameMatches = searchFuzzyIndex(index.signals, nameTerms.join(' '));
	if (idTerms.length === 0) return nameMatches;

	const required = idTerms.map((term) => searchEntryKeys(matchesForIdTerm(term)));
	return nameMatches.filter((entry) => required.every((matches) => matches[entry.signal.key]));
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
	const label = `${message.name}.${signal.name}`;

	return {
		key: signalIdentityKey(dbcFileId, message, signal.name),
		label,
		messageName: message.name,
		signalName: signal.name,
		searchText: label,
		arbitrationId: message.canId.toString(16)
	};
}

async function closeEntries(entries: DbcFileEntry[]): Promise<void> {
	await Promise.all(entries.map((entry) => closeDbc(entry.handle)));
}

export const dbcFiles = new DbcFilesStore();
