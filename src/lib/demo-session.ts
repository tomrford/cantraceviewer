import {
	DBC_MAX_FILE_BYTES,
	TRACE_MAX_FILE_BYTES,
	assertFileSizeWithinLimit
} from './file-limits.js';
import { dbcFiles, type DbcSignalTarget } from './stores/dbc-files.svelte.js';
import { plotData } from './stores/plot-data.svelte.js';
import { onTraceOpened } from './stores/session.js';
import { traceFile } from './stores/trace-file.svelte.js';

export const DEMO_TRACE_URL = '/example.asc';
export const DEMO_DBC_URL = '/example.dbc';
const DEMO_TRACE_NAME = 'example.asc';
const DEMO_DBC_NAME = 'example.dbc';
const DEMO_SIGNAL_NAMES = ['vehicle_speed', 'engine_rpm'] as const;

export async function fetchDemoFiles(): Promise<{ trace: File; dbc: File }> {
	const [trace, dbc] = await Promise.all([
		fetchStaticFile(DEMO_TRACE_URL, DEMO_TRACE_NAME, TRACE_MAX_FILE_BYTES, 'Trace'),
		fetchStaticFile(DEMO_DBC_URL, DEMO_DBC_NAME, DBC_MAX_FILE_BYTES, 'DBC')
	]);
	return { trace, dbc };
}

export async function loadDemoFiles(
	trace: File,
	dbc: File,
	isCurrent: () => boolean = () => true
): Promise<boolean> {
	if (!isCurrent() || traceFile.isLoading) return false;
	if (!(await traceFile.openFile(trace))) return false;

	const opened = traceFile.entry;
	if (!isCurrent() || opened === null) return false;

	await onTraceOpened();
	if (!isCurrent() || traceFile.entry !== opened) return false;

	await dbcFiles.addDemoDbc(dbc);
	if (!isCurrent() || traceFile.entry !== opened) {
		await dbcFiles.dropDemoDbcs();
		return false;
	}
	if (dbcFiles.error) return false;

	await selectDemoSignals();
	return isCurrent() && traceFile.entry === opened && dbcFiles.error === null;
}

async function selectDemoSignals(): Promise<void> {
	for (const name of DEMO_SIGNAL_NAMES) {
		const key = keyForDemoSignal(dbcFiles.signalTargetByKey, name);
		if (key && !plotData.isSignalSelected(key)) await plotData.toggleSignal(key);
	}
}

function keyForDemoSignal(targets: Record<string, DbcSignalTarget>, name: string): string | null {
	let fallback: string | null = null;
	for (const [key, target] of Object.entries(targets)) {
		if (target.signal.name !== name || target.unavailableReason) continue;

		switch (target.file.origin) {
			case 'demo':
				return key;
			case 'library':
			case 'mf4':
				fallback ??= key;
				break;
			default: {
				const unexpected: never = target.file.origin;
				return unexpected;
			}
		}
	}
	return fallback;
}

async function fetchStaticFile(
	path: string,
	name: string,
	maxBytes: number,
	label: string
): Promise<File> {
	const response = await fetch(path);
	if (!response.ok) throw new Error(`Could not load ${name}.`);

	const declared = response.headers.get('content-length');
	if (declared !== null) {
		const size = Number(declared);
		if (!Number.isFinite(size)) throw new Error(`Could not load ${name}.`);
		assertFileSizeWithinLimit({ size }, maxBytes, label);
	}

	const bytes = await readBodyWithinLimit(response, maxBytes, label);
	const file = new File([bytes], name);
	assertFileSizeWithinLimit(file, maxBytes, label);
	return file;
}

async function readBodyWithinLimit(
	response: Response,
	maxBytes: number,
	label: string
): Promise<Uint8Array<ArrayBuffer>> {
	const reader = response.body?.getReader();
	if (!reader) {
		const buffer = new Uint8Array(await response.arrayBuffer());
		assertFileSizeWithinLimit({ size: buffer.byteLength }, maxBytes, label);
		return buffer;
	}

	const chunks: Uint8Array[] = [];
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		received += value.byteLength;
		if (received > maxBytes) {
			await reader.cancel();
			assertFileSizeWithinLimit({ size: received }, maxBytes, label);
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
