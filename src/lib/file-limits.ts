const MIB = 1024 * 1024;

export const DBC_MAX_FILE_BYTES = 1 * MIB;
export const ASC_MAX_FILE_BYTES = 100 * MIB;

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
