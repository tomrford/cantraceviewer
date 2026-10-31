import { createStore } from 'zustand/vanilla';
import { traceFile, type TraceFileEntry } from './trace-file.js';
import {
	closeDbc,
	openDbc,
	type DbcDiagnostic,
	type DbcHandle,
	type DbcMessage,
	type DbcMessageIdentity,
	type DbcSignal,
	type EmbeddedDbc,
	type ParsedDbc,
	type RawMessage,
	type RawSource
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
import {
	buildSelectorSearchIndexes,
	type SelectorDbcFile,
	type SelectorListSignal,
	type SelectorSearchIndex
} from '#lib/selector-list.js';

export type DbcFileEntry = {
	id: string;
	name: string;
	handle: DbcHandle;
	catalog: ParsedDbc;
	warnings: DbcDiagnostic[];
	origin: 'library' | 'mf4';
};

export type DbcSignalTarget = {
	unavailableReason?: string;
	source?: RawSource;
	sourceBadges?: string[];
	file: DbcFileEntry;
	message: DbcMessage;
	signal: DbcSignal;
};

export type DbcFilesState = {
	files: DbcFileEntry[];
	isLoading: boolean;
	error: string | null;
	hasLoadedLibrary: boolean;
	/** Derived from `files` and the open trace on every write. */
	signalTargetByKey: Readonly<Record<string, DbcSignalTarget>>;
	selectorFiles: SelectorDbcFile[];
	selectorSearchIndexes: SelectorSearchIndex[];
};

type RawMessagesById = Map<string, RawMessage[]>;
type DbcCandidate = { entry: DbcFileEntry; stored: StoredDbc };

export const dbcFiles = createStore<DbcFilesState>()(() => ({
	...catalogState([], null),
	isLoading: false,
	error: null,
	hasLoadedLibrary: false
}));

traceFile.subscribe(({ entry }, previous) => {
	if (entry !== previous.entry) dbcFiles.setState(catalogState(dbcFiles.getState().files, entry));
});

let libraryOperation = Promise.resolve();

export function addDbcFiles(files: Iterable<File>): Promise<void> {
	if (dbcFiles.getState().isLoading) return Promise.resolve();
	return runLibraryOperation(() => importFiles(files));
}

export async function removeDbcFile(id: string): Promise<void> {
	const entry = dbcFiles.getState().files.find((file) => file.id === id);
	if (!entry) return;

	setFiles(dbcFiles.getState().files.filter((file) => file.id !== id));
	await closeDbc(entry.handle);
	if (entry.origin === 'library') await deleteStoredDbc(entry.id);
}

export function addTransientDbcs(ownerTraceId: number, dbcs: EmbeddedDbc[]): Promise<void> {
	return runLibraryOperation(() => importTransientDbcs(ownerTraceId, dbcs));
}

export async function clearTransientDbcs(): Promise<void> {
	const { files } = dbcFiles.getState();
	const removed = files.filter((file) => file.origin === 'mf4');
	if (removed.length === 0) return;
	setFiles(files.filter((file) => file.origin !== 'mf4'));
	await closeEntries(removed);
}

export async function clearDbcFiles(): Promise<void> {
	const removed = dbcFiles.getState().files;
	setFiles([]);
	await closeEntries(removed);
}

export function resetDbcLibrary(): Promise<void> {
	return runLibraryOperation(async () => {
		dbcFiles.setState({ error: null, hasLoadedLibrary: true });
		await clearDbcFiles();
		await resetStoredDbcs();
	});
}

export function clearDbcError(): void {
	dbcFiles.setState({ error: null });
}

export function loadDbcLibrary(): Promise<void> {
	const { hasLoadedLibrary, isLoading } = dbcFiles.getState();
	if (hasLoadedLibrary || isLoading) return Promise.resolve();
	return runLibraryOperation(readLibrary);
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

export function sourceLabel(source?: RawSource): string {
	if (!source) return '';
	const channel = source.channel === null ? 'Unknown channel' : `Channel ${source.channel}`;
	const direction = { unknown: 'unknown direction', rx: 'Rx', tx: 'Tx' }[source.direction];
	return ` [${channel} · ${direction}]`;
}

function setFiles(files: DbcFileEntry[], patch: Partial<DbcFilesState> = {}): void {
	dbcFiles.setState({ ...catalogState(files, traceFile.getState().entry), ...patch });
}

function catalogState(files: DbcFileEntry[], trace: TraceFileEntry | null) {
	const rawMessages = Map.groupBy(trace?.metadata.rawMessages ?? [], rawMessageIdentityKey);
	const traceLoaded = trace !== null;
	const selectorFiles = files.map<SelectorDbcFile>((entry) => ({
		id: entry.id,
		name: entry.name.replace(/\.dbc$/i, ''),
		kind: 'dbc',
		transient: entry.origin === 'mf4',
		messages: entry.catalog.messages.flatMap((message) => {
			const sources = sourceOptions(message, rawMessages);
			const unavailableReason = messageUnavailableReason(message, rawMessages, traceLoaded);
			return sources.map((source) => ({
				key: selectorMessageKey(entry.id, message, source),
				name: message.name,
				sourceLabel: sourceLabel(source),
				sourceBadges: sourceBadges(source, sources),
				signals: message.signals.map((signal) => ({
					...selectorSignal(entry.id, message, signal, source),
					unavailableReason
				}))
			}));
		})
	}));

	return {
		files,
		signalTargetByKey: buildSignalTargetIndex(files, rawMessages, traceLoaded),
		selectorFiles,
		selectorSearchIndexes: buildSelectorSearchIndexes(selectorFiles)
	};
}

async function importFiles(files: Iterable<File>): Promise<void> {
	dbcFiles.setState({ error: null });
	const candidates: DbcCandidate[] = [];
	const seenIds = new Set(dbcFiles.getState().files.map((file) => file.id));

	try {
		for (const file of files) {
			const stored = await storedFile(file);
			if (seenIds.has(stored.id)) continue;

			seenIds.add(stored.id);
			candidates.push(await openStoredDbc(stored));
		}

		if (candidates.length > 0) {
			await putStoredDbcs(candidates.map((candidate) => candidate.stored));
			setFiles([...dbcFiles.getState().files, ...candidates.map((candidate) => candidate.entry)]);
		}
	} catch (error) {
		await closeEntries(candidates.map((candidate) => candidate.entry));
		dbcFiles.setState({ error: error instanceof Error ? error.message : 'DBC load failed' });
	}
}

async function importTransientDbcs(ownerTraceId: number, dbcs: EmbeddedDbc[]): Promise<void> {
	dbcFiles.setState({ error: null });
	await clearTransientDbcs();
	const entries: DbcFileEntry[] = [];
	try {
		for (const [index, dbc] of dbcs.entries()) {
			const stored = { id: `mf4:${ownerTraceId}:${index}`, name: dbc.name, bytes: dbc.bytes };
			entries.push((await openStoredDbc(stored, 'mf4')).entry);
		}
		setFiles([...dbcFiles.getState().files, ...entries]);
	} catch (error) {
		await closeEntries(entries);
		dbcFiles.setState({
			error: error instanceof Error ? error.message : 'Embedded DBC load failed'
		});
	}
}

async function readLibrary(): Promise<void> {
	dbcFiles.setState({ error: null });

	const candidates: DbcFileEntry[] = [];
	const failures: string[] = [];
	const transient = () => dbcFiles.getState().files.filter((file) => file.origin === 'mf4');
	try {
		for (const dbc of await listStoredDbcs()) {
			try {
				candidates.push((await openStoredDbc(dbc)).entry);
			} catch (error) {
				failures.push(error instanceof Error ? error.message : `${dbc.name}: DBC load failed`);
			}
		}

		setFiles([...candidates, ...transient()], {
			error: failures.length > 0 ? failures.join('\n') : null
		});
	} catch {
		await closeEntries(candidates);
		setFiles(transient(), { error: 'Saved DBC library could not be read.' });
	} finally {
		dbcFiles.setState({ hasLoadedLibrary: true });
	}
}

// Order reads, imports and resets, including persistent writes and newer trace DBCs.
// Keep the loading gate held until the last queued operation has finished.
function runLibraryOperation(action: () => Promise<void>): Promise<void> {
	dbcFiles.setState({ isLoading: true });
	const operation = libraryOperation.then(action, action);
	libraryOperation = operation;
	return operation.finally(() => {
		if (libraryOperation === operation) dbcFiles.setState({ isLoading: false });
	});
}

async function storedFile(file: File): Promise<StoredDbc> {
	if (!/\.dbc$/i.test(file.name)) throw new Error('Unsupported DBC file type. Open .dbc.');
	assertFileSizeWithinLimit(file, DBC_MAX_FILE_BYTES, 'DBC');

	const bytes = new Uint8Array(await file.arrayBuffer());
	return { id: await storedDbcId(bytes), name: file.name, bytes };
}

async function openStoredDbc(
	dbc: StoredDbc,
	origin: DbcFileEntry['origin'] = 'library'
): Promise<DbcCandidate> {
	const { handle, catalog, warnings } = await openDbc(dbc.bytes ?? dbc.text).catch((error) => {
		throw new Error(`${dbc.name}: ${error instanceof Error ? error.message : 'DBC load failed'}`);
	});

	return { entry: { id: dbc.id, name: dbc.name, handle, catalog, warnings, origin }, stored: dbc };
}

async function closeEntries(entries: DbcFileEntry[]): Promise<void> {
	await Promise.all(entries.map((entry) => closeDbc(entry.handle)));
}

function messageIdentityKey(message: DbcMessageIdentity): string {
	return `${message.isExtended ? 'extended' : 'standard'}:${message.canId}:${message.sizeBytes}`;
}

function rawMessageIdentityKey(message: Pick<DbcMessageIdentity, 'canId' | 'isExtended'>): string {
	return `${message.canId}:${message.isExtended}`;
}

function buildSignalTargetIndex(
	files: DbcFileEntry[],
	rawMessages: RawMessagesById,
	traceLoaded: boolean
): Record<string, DbcSignalTarget> {
	const index: Record<string, DbcSignalTarget> = {};

	for (const file of files) {
		for (const message of file.catalog.messages) {
			const sources = sourceOptions(message, rawMessages);
			const unavailableReason = messageUnavailableReason(message, rawMessages, traceLoaded);
			for (const source of sources) {
				for (const signal of message.signals) {
					index[signalIdentityKey(file.id, message, signal.name, source)] = {
						unavailableReason,
						file,
						message,
						signal,
						source,
						sourceBadges: sourceBadges(source, sources)
					};
				}
			}
		}
	}

	return index;
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
): SelectorListSignal {
	return {
		key: signalIdentityKey(dbcFileId, message, signal.name, source),
		label: `${message.name}.${signal.name}${sourceLabel(source)}`,
		messageName: message.name,
		signalName: signal.name,
		arbitrationId: message.canId.toString(16)
	};
}

function sourceOptions(
	message: DbcMessage,
	rawMessages: RawMessagesById
): (RawSource | undefined)[] {
	const matches = rawMessages.get(rawMessageIdentityKey(message)) ?? [];
	return matches.length ? matches.map((raw) => raw.source) : [undefined];
}

function messageUnavailableReason(
	message: DbcMessage,
	rawMessages: RawMessagesById,
	traceLoaded: boolean
): string | undefined {
	if (message.rawFrameDecodable === false) return 'Plotting not yet supported';
	if (traceLoaded && !rawMessages.has(rawMessageIdentityKey(message)))
		return 'Not present in this trace';
	return undefined;
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
