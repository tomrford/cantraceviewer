import type { TraceType } from './wasm.js';

const TRACE_TYPES = ['asc', 'trc', 'blf', 'mf4'] as const satisfies readonly TraceType[];
const TRACE_EXTENSIONS = TRACE_TYPES.map((type) => `.${type}`);

export const TRACE_FILE_ACCEPT = TRACE_EXTENSIONS.join(',');
export const TRACE_FILE_DESCRIPTION = formatList(TRACE_EXTENSIONS);
export const TRACE_FILE_FORMAT_NAMES = formatList(TRACE_TYPES.map((type) => type.toUpperCase()));

export function traceTypeForFileName(fileName: string): TraceType | null {
	const lowerName = fileName.toLowerCase();
	return TRACE_TYPES.find((type) => lowerName.endsWith(`.${type}`)) ?? null;
}

export function displayTraceName(fileName: string): string {
	const type = traceTypeForFileName(fileName);
	return type ? fileName.slice(0, -`.${type}`.length) : fileName;
}

function formatList(items: readonly string[]): string {
	return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`;
}
