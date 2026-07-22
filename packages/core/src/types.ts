export type DbcValueDescription = {
	rawValue: number;
	label: string;
};

export type DbcSignal = {
	name: string;
	startBit: number;
	bitLength: number;
	endianness: string;
	signedness: string;
	factor: number;
	offset: number;
	minimum: number;
	maximum: number;
	unit: string;
	valueType: string;
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

/** Opaque DBC handle. */
export type DbcHandle = {
	readonly [DbcHandleBrand]: true;
	readonly id: number;
};

/** Opaque trace handle. */
export type TraceHandle = {
	readonly [TraceHandleBrand]: true;
	readonly id: number;
	readonly metadata: TraceMetadata;
	readonly hasRawFrames: boolean;
	readonly mf4Catalog: Mf4SignalCatalog | null;
	readonly embeddedDbcs: EmbeddedDbc[];
	readonly warnings: string[];
};

export type DbcMessageIdentity = Pick<DbcMessage, 'canId' | 'isExtended' | 'sizeBytes'>;
