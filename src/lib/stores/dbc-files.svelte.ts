import {
	closeDbc,
	getDbcCatalog,
	openDbc,
	type DbcMessage,
	type DbcSignal,
	type DbcHandle,
	type ParsedDbc
} from '$lib/wasm.js';
import { DBC_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '$lib/file-limits.js';

export type DbcFileEntry = {
	id: string;
	file: File;
	handle: DbcHandle;
	catalog: ParsedDbc;
};

export type SidebarDbcFile = {
	id: string;
	name: string;
	signals: SidebarDbcSignal[];
};

export type SidebarDbcSignal = {
	key: string;
	label: string;
	messageName: string;
	signalName: string;
};

type DbcMessageIdentity = {
	key: string;
	canId: number;
	isExtended: boolean;
	fileName: string;
	messageName: string;
};

type CanIdIndex = Record<string, DbcMessageIdentity>;

class DbcFilesStore {
	files = $state<DbcFileEntry[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);

	canIdIndex = $derived.by(() => buildCanIdIndex(this.files));

	sidebarFiles = $derived.by<SidebarDbcFile[]>(() =>
		this.files.map((entry) => ({
			id: entry.id,
			name: displayDbcName(entry.file.name),
			signals: entry.catalog.messages.flatMap((message) =>
				message.signals.map((signal) => sidebarSignal(entry.id, message, signal))
			)
		}))
	);

	async addFiles(files: Iterable<File>): Promise<void> {
		this.error = null;
		this.isLoading = true;
		const candidates: DbcFileEntry[] = [];

		try {
			for (const file of files) {
				candidates.push(await this.openFile(file));
			}

			assertNoCanIdOverlaps(this.canIdIndex, candidates);
			this.files = [...this.files, ...candidates];
		} catch (error) {
			await closeEntries(candidates);
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
	}

	async clear(): Promise<void> {
		const handles = this.files.map((file) => file.handle);
		this.files = [];
		await Promise.all(handles.map((handle) => closeDbc(handle)));
	}

	clearError(): void {
		this.error = null;
	}

	private async openFile(file: File): Promise<DbcFileEntry> {
		assertFileSizeWithinLimit(file, DBC_MAX_FILE_BYTES, 'DBC');

		const text = await file.text();
		const handle = await openDbc(text);

		try {
			const catalog = await getDbcCatalog(handle);
			return {
				id: crypto.randomUUID(),
				file,
				handle,
				catalog
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
		fileName: entry.file.name,
		messageName: message.name
	}));
}

function canIdKey(canId: number, isExtended: boolean): string {
	return `${isExtended ? 'extended' : 'standard'}:${canId}`;
}

function displayDbcName(fileName: string): string {
	return fileName.replace(/\.dbc$/i, '');
}

export function signalKey(dbcFileId: string, messageName: string, signalName: string): string {
	return JSON.stringify([dbcFileId, messageName, signalName]);
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
