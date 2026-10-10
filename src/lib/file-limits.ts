import type { ParsingLimits } from 'cantraceviewer';

const MIB = 1024 * 1024;

export const APP_PARSING_LIMITS: ParsingLimits = Object.freeze({
	maxDbcBytes: 5 * MIB,
	maxTraceInputBytes: 500 * MIB,
	maxTraceDataBytes: 500 * MIB
});

export const DBC_MAX_FILE_BYTES = APP_PARSING_LIMITS.maxDbcBytes;
export const TRACE_MAX_FILE_BYTES = APP_PARSING_LIMITS.maxTraceInputBytes;

function formatBytes(bytes: number): string {
	if (bytes >= MIB && bytes % MIB === 0) {
		return `${bytes / MIB} MiB`;
	}

	return `${bytes.toLocaleString()} bytes`;
}

export function assertFileSizeWithinLimit(file: File, maxBytes: number, label: string): void {
	if (file.size <= maxBytes) return;

	throw new Error(`${label} file exceeds the ${formatBytes(maxBytes)} limit`);
}
