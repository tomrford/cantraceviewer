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

/** @internal */
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

/** @internal */
export function assertByteLimit(bytes: number, limit: number, label: string): void {
	if (bytes > limit) throw new Error(`${label} exceeds the ${limit} byte limit`);
}

/** Count TextEncoder's UTF-8 bytes without allocating an encoded copy. @internal */
export function assertDbcLimit(input: Uint8Array | string, limit: number): void {
	if (typeof input !== 'string') {
		assertByteLimit(input.byteLength, limit, 'DBC input');
		return;
	}
	let bytes = 0;
	for (let index = 0; index < input.length; index++) {
		const code = input.charCodeAt(index);
		if (code < 0x80) bytes++;
		else if (code < 0x800) bytes += 2;
		else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			input.charCodeAt(index + 1) >= 0xdc00 &&
			input.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4;
			index++;
		} else bytes += 3;
		assertByteLimit(bytes, limit, 'DBC input');
	}
}
