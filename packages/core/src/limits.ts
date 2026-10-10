/** Byte limits for one client. These do not bound catalogues, decoded series or total memory. */
export type ParsingLimits = Readonly<{
	/** Per standalone DBC input and per decompressed embedded DBC attachment. */
	maxDbcBytes: number;
	/** Per complete ASC, TRC, BLF or MF4 input. */
	maxTraceInputBytes: number;
	/** Per MF4 data-group stream or complete BLF object stream, including uncompressed data. */
	maxTraceDataBytes: number;
}>;

export const DEFAULT_PARSING_LIMITS: ParsingLimits = Object.freeze({
	maxDbcBytes: 1024 * 1024,
	maxTraceInputBytes: 500 * 1024 * 1024,
	maxTraceDataBytes: 500 * 1024 * 1024
});

export function snapshotLimits(input: ParsingLimits = DEFAULT_PARSING_LIMITS): ParsingLimits {
	if (typeof input !== 'object' || input === null) {
		throw new Error('Parsing limits must be a complete limits record');
	}
	const limits = {
		maxDbcBytes: input.maxDbcBytes,
		maxTraceInputBytes: input.maxTraceInputBytes,
		maxTraceDataBytes: input.maxTraceDataBytes
	};
	for (const [name, value] of Object.entries(limits)) {
		if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) {
			throw new Error(`${name} must be an integer from 1 to 4294967295 bytes`);
		}
	}
	return Object.freeze(limits);
}

export function assertByteLimit(bytes: number, limit: number, label: string): void {
	if (bytes > limit) throw new Error(`${label} exceeds the ${limit} byte limit`);
}

export function dbcBytes(input: Uint8Array | string, limit: number): Uint8Array {
	if (typeof input === 'string') assertByteLimit(input.length, limit, 'DBC input');
	const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
	assertByteLimit(bytes.byteLength, limit, 'DBC input');
	return bytes;
}
