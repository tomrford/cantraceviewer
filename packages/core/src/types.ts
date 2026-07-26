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
	unsupportedMux: boolean;
	receivers: string[];
	valueDescriptions: DbcValueDescription[];
};

export type DbcMessage = {
	name: string;
	dbcId: number;
	canId: number;
	isExtended: boolean;
	isFd: boolean;
	sizeBytes: number;
	transmitter: string;
	signals: DbcSignal[];
};

/** Shape pinned by the `serializes_parsed_catalog` test in wasm/src/dbc/catalog.rs. */
export type ParsedDbc = {
	messages: DbcMessage[];
};

export type TraceMetadata = {
	measurementStartMs: number | null;
	validMessageCount: number;
	skippedLineCount: number;
	durationNs: number | null;
};

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
};

export type TraceType = 'asc' | 'trc' | 'blf' | 'mf4';

declare const DbcHandleBrand: unique symbol;
declare const TraceHandleBrand: unique symbol;

/**
 * Opaque DBC handle. It has no readable fields: it only identifies one parsed DBC inside the
 * client that issued it, until that handle or its client is closed. Handles are safe to spread and
 * to store in deep-reactive stores, and every copy shares one lifetime.
 */
export type DbcHandle = {
	readonly [DbcHandleBrand]: true;
};

/** Opaque trace handle, with the same identity and lifetime rules as {@link DbcHandle}. */
export type TraceHandle = {
	readonly [TraceHandleBrand]: true;
};

/** Everything one `openDbc` call produces. The catalog is plain data and outlives the handle. */
export type OpenDbcResult = {
	handle: DbcHandle;
	catalog: ParsedDbc;
};

/** Everything one `openTrace` call produces. Every field except `handle` is plain data. */
export type OpenTraceResult = {
	handle: TraceHandle;
	metadata: TraceMetadata;
	/** True when the trace carries raw CAN frames that a DBC can decode. */
	hasRawFrames: boolean;
	/** Signals the trace itself already carries decoded; MF4 only, otherwise null. */
	mf4Catalog: Mf4SignalCatalog | null;
	/** DBC sources embedded in the trace file; MF4 only, otherwise empty. */
	embeddedDbcs: EmbeddedDbc[];
	/** Non-fatal parse diagnostics; MF4 only, otherwise empty. */
	warnings: string[];
};

export type DbcMessageIdentity = Pick<DbcMessage, 'canId' | 'isExtended' | 'sizeBytes'>;
