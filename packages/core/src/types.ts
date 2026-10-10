export type DbcValueDescription = {
	rawValue: number;
	label: string;
};

/** Bit order of a DBC signal, as declared by `@1` (intel) or `@0` (motorola). */
export type DbcEndianness = 'intel' | 'motorola';

export type DbcSignedness = 'signed' | 'unsigned';

export type DbcValueType = 'integer' | 'float32' | 'float64';

export type DbcSignal = {
	name: string;
	startBit: number;
	bitLength: number;
	endianness: DbcEndianness;
	signedness: DbcSignedness;
	factor: number;
	offset: number;
	minimum: number;
	maximum: number;
	unit: string;
	valueType: DbcValueType;
	isMultiplexer: boolean;
	/** Inclusive unsigned wire values, as decimal strings (including values above 2^53). */
	multiplex: { selector: string; ranges: { first: string; last: string }[] } | null;
	receivers: string[];
	valueDescriptions: DbcValueDescription[];
};

export type DbcMessage = {
	name: string;
	dbcId: number;
	canId: number;
	isExtended: boolean;
	isFd: boolean;
	frameFormat: 'standard-can' | 'extended-can' | 'standard-can-fd' | 'extended-can-fd' | 'j1939';
	/** Whether the message payload fits raw-frame decoding; no J1939 transport reassembly. */
	rawFrameDecodable: boolean;
	j1939: { pgn: number; sourceAddress: number; priority: number } | null;
	sizeBytes: number;
	transmitter: string;
	signals: DbcSignal[];
};

export type ParsedDbc = {
	messages: DbcMessage[];
};

export type RawSource = {
	/** One-based format channel; null when absent or unspecified (zero). */
	channel: number | null;
	direction: 'unknown' | 'rx' | 'tx';
};

export type RawMessage = Pick<DbcMessage, 'canId' | 'isExtended'> & { source: RawSource };

export type TraceMetadata = {
	/** Distinct raw data-frame identities, sorted by identifier, format, channel and direction. */
	rawMessages: RawMessage[];
	measurementStartMs: number | null;
	validMessageCount: number;
	skippedLineCount: number;
	durationNs: number | null;
};

/** Chronological samples; equal timestamps retain their source order. */
export type DecodedSignalSeries = {
	timesMs: Float64Array;
	values: Float64Array;
};

export type Mf4Signal = {
	id: number;
	name: string;
	unit: string;
};

export type Mf4SignalGroup = {
	name: string;
	signals: Mf4Signal[];
};

export type Mf4SignalCatalog = {
	groups: Mf4SignalGroup[];
};

export type EmbeddedDbc = {
	name: string;
	text: string;
	/** Original decompressed input; use for parsing to preserve byte-limit semantics. */
	bytes: Uint8Array;
};

export type TraceType = 'asc' | 'trc' | 'blf' | 'mf4';

declare const DbcHandleBrand: unique symbol;
declare const TraceHandleBrand: unique symbol;

/**
 * Opaque, client-owned DBC identity, valid until the handle or client closes.
 * Spreads and reactive proxies share the original handle's lifetime.
 */
export type DbcHandle = {
	readonly [DbcHandleBrand]: true;
};

/** Opaque trace handle, with the same identity and lifetime rules as {@link DbcHandle}. */
export type TraceHandle = {
	readonly [TraceHandleBrand]: true;
};

/** Warnings contain no source text. Positions identify the record keyword (one-based). */
export type DbcDiagnostic = {
	category: 'unsupported-record' | 'dangling-reference' | 'omitted-feature';
	keyword: string;
	line: number;
	column: number;
	message: string;
};

/** Catalog and warnings are plain data and outlive the handle. */
export type OpenDbcResult = {
	handle: DbcHandle;
	catalog: ParsedDbc;
	warnings: DbcDiagnostic[];
};

/** Every field except `handle` is plain data and outlives the handle. */
export type OpenTraceResult = {
	handle: TraceHandle;
	metadata: TraceMetadata;
	hasRawFrames: boolean;
	/** Signals the trace itself already carries decoded; MF4 only, otherwise null. */
	mf4Catalog: Mf4SignalCatalog | null;
	/** DBC sources embedded in the trace file; MF4 only, otherwise empty. */
	embeddedDbcs: EmbeddedDbc[];
	/** Non-fatal parse diagnostics; MF4 only, otherwise empty. */
	warnings: string[];
};

export type DbcMessageIdentity = Pick<DbcMessage, 'canId' | 'isExtended' | 'sizeBytes'>;
