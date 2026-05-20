import type { TraceType } from './wasm';

export const TRACE_FILE_ACCEPT = '.asc,.trc,.blf,.mf4';
export const TRACE_FILE_DESCRIPTION = '.asc, .trc, .blf, or .mf4';

export function traceTypeForFileName(fileName: string): TraceType | null {
	if (/\.blf$/i.test(fileName)) return 'blf';
	if (/\.mf4$/i.test(fileName)) return 'mf4';
	if (/\.trc$/i.test(fileName)) return 'trc';
	if (/\.asc$/i.test(fileName)) return 'asc';
	return null;
}

export function isTraceFileName(fileName: string): boolean {
	return traceTypeForFileName(fileName) !== null;
}

export function displayTraceName(fileName: string): string {
	return fileName.replace(/\.(asc|trc|blf|mf4)$/i, '');
}
