import type {
	DbcMessageIdentity,
	EmbeddedDbc,
	Mf4SignalCatalog,
	ParsedDbc,
	TraceMetadata,
	TraceType
} from './types.ts';

export type WireError = { name: string; message: string };

export type WorkerRequestBody =
	| { op: 'openDbc'; text: string }
	| { op: 'closeDbc'; dbcId: number }
	| { op: 'openTrace'; traceType: TraceType; buffer: ArrayBuffer }
	| { op: 'closeTrace'; traceId: number }
	| {
			op: 'getSignalValues';
			dbcId: number;
			traceId: number;
			messageIdentity: DbcMessageIdentity;
			signalName: string;
	  }
	| { op: 'getMf4SignalValues'; traceId: number; signalId: number }
	| { op: 'closeClient' };

export type WorkerRequest = WorkerRequestBody & { id: number };

export type WireOpenDbc = { dbcId: number; catalog: ParsedDbc };

export type WireOpenTrace = {
	traceId: number;
	metadata: TraceMetadata;
	hasRawFrames: boolean;
	mf4Catalog: Mf4SignalCatalog | null;
	embeddedDbcs: EmbeddedDbc[];
	warnings: string[];
};

export type SeriesPayload = {
	buffer: ArrayBuffer;
	timesByteOffset: number;
	timesLength: number;
	valuesByteOffset: number;
	valuesLength: number;
};

export type WorkerOkResult = WireOpenDbc | WireOpenTrace | SeriesPayload | null;

export type WorkerResponse =
	| { type: 'ready' }
	| { type: 'boot-error'; error: WireError }
	| { type: 'ok'; id: number; result: WorkerOkResult }
	| { type: 'error'; id: number; error: WireError };
