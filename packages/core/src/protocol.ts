/** Private wire protocol between an asynchronous client and its worker. @internal */
import type {
	DbcMessageIdentity,
	EmbeddedDbc,
	Mf4SignalCatalog,
	ParsedDbc,
	TraceMetadata,
	TraceType
} from './types.ts';

/** Serializable error envelope. The client rebuilds an Error preserving name and message. */
export type WireError = { name: string; message: string };

/** Request bodies. The client stamps a monotonically increasing `id`; IDs are never recycled. */
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

/** Wire form of `OpenDbcResult`: the opaque handle becomes a worker-local id. */
export type WireOpenDbc = { dbcId: number; catalog: ParsedDbc };

/** Wire form of `OpenTraceResult`: the opaque handle becomes a worker-local id. */
export type WireOpenTrace = {
	traceId: number;
	metadata: TraceMetadata;
	hasRawFrames: boolean;
	mf4Catalog: Mf4SignalCatalog | null;
	embeddedDbcs: EmbeddedDbc[];
	warnings: string[];
};

/** Two Float64Array views reconstructed over one transferred ArrayBuffer. */
export type SeriesPayload = {
	buffer: ArrayBuffer;
	timesByteOffset: number;
	timesLength: number;
	valuesByteOffset: number;
	valuesLength: number;
};

export type WorkerResponse =
	| { type: 'ready' }
	| { type: 'boot-error'; error: WireError }
	| { type: 'ok'; id: number; result: unknown }
	| { type: 'error'; id: number; error: WireError };
