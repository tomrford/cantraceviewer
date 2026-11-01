import type { ParsingLimits } from 'cantraceviewer';

const MIB = 1024 * 1024;

export const APP_PARSING_LIMITS: ParsingLimits = Object.freeze({
	maxDbcBytes: 5 * MIB,
	maxTraceInputBytes: 500 * MIB,
	maxTraceDataBytes: 500 * MIB
});

export const DBC_MAX_FILE_BYTES = APP_PARSING_LIMITS.maxDbcBytes;
export const TRACE_MAX_FILE_BYTES = APP_PARSING_LIMITS.maxTraceInputBytes;

export function assertFileSizeWithinLimit(file: File, maxBytes: number, label: string): void {
	if (file.size <= maxBytes) return;

	throw new Error(`${label} file exceeds the ${maxBytes / MIB} MiB limit`);
}
