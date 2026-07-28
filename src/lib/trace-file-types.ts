import type { TraceType } from './wasm';

const TRACE_FILE_FORMATS = [
	{ type: 'asc', extension: '.asc', name: 'ASC' },
	{ type: 'trc', extension: '.trc', name: 'TRC' },
	{ type: 'blf', extension: '.blf', name: 'BLF' },
	{ type: 'mf4', extension: '.mf4', name: 'MF4' }
] as const satisfies readonly {
	type: TraceType;
	extension: string;
	name: string;
}[];

export const TRACE_FILE_ACCEPT = TRACE_FILE_FORMATS.map(({ extension }) => extension).join(',');
export const TRACE_FILE_DESCRIPTION = formatList(
	TRACE_FILE_FORMATS.map(({ extension }) => extension)
);
export const TRACE_FILE_FORMAT_NAMES = formatList(TRACE_FILE_FORMATS.map(({ name }) => name));

export function traceTypeForFileName(fileName: string): TraceType | null {
	const lowerName = fileName.toLowerCase();
	return TRACE_FILE_FORMATS.find(({ extension }) => lowerName.endsWith(extension))?.type ?? null;
}

export function isTraceFileName(fileName: string): boolean {
	return traceTypeForFileName(fileName) !== null;
}

export function displayTraceName(fileName: string): string {
	const lowerName = fileName.toLowerCase();
	const format = TRACE_FILE_FORMATS.find(({ extension }) => lowerName.endsWith(extension));
	return format ? fileName.slice(0, -format.extension.length) : fileName;
}

function formatList(items: readonly string[]): string {
	return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`;
}
