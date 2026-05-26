import { z } from 'zod';

export const DbcValueDescriptionSchema = z.object({
	rawValue: z.number(),
	label: z.string()
});

export const DbcSignalSchema = z.object({
	name: z.string(),
	startBit: z.number(),
	bitLength: z.number(),
	endianness: z.string(),
	signedness: z.string(),
	factor: z.number(),
	offset: z.number(),
	minimum: z.number(),
	maximum: z.number(),
	unit: z.string(),
	valueType: z.string(),
	unsupportedMux: z.boolean(),
	receivers: z.array(z.string()),
	valueDescriptions: z.array(DbcValueDescriptionSchema)
});

export const DbcMessageSchema = z.object({
	name: z.string(),
	dbcId: z.number(),
	canId: z.number(),
	isExtended: z.boolean(),
	isFd: z.boolean(),
	sizeBytes: z.number(),
	transmitter: z.string(),
	signals: z.array(DbcSignalSchema)
});

export const ParsedDbcSchema = z.object({
	messages: z.array(DbcMessageSchema)
});

export const TraceMetadataSchema = z.object({
	measurementStartMs: z.number().nullable(),
	validMessageCount: z.number(),
	durationNs: z.number().nullable()
});

export const TraceTypeSchema = z.enum(['asc', 'trc', 'blf']);
export const DbcMessageIdentitySchema = DbcMessageSchema.pick({
	canId: true,
	isExtended: true,
	sizeBytes: true
});

export type DbcValueDescription = z.infer<typeof DbcValueDescriptionSchema>;
export type DbcSignal = z.infer<typeof DbcSignalSchema>;
export type DbcMessage = z.infer<typeof DbcMessageSchema>;
export type DbcMessageIdentity = z.infer<typeof DbcMessageIdentitySchema>;
export type ParsedDbc = z.infer<typeof ParsedDbcSchema>;
export type TraceMetadata = z.infer<typeof TraceMetadataSchema>;
export type TraceType = z.infer<typeof TraceTypeSchema>;

export type DecodedSignalSeries = {
	timesMs: Float64Array;
	values: Float64Array;
};

export type WasmRpcPayload =
	| { op: 'openDbc'; text: string }
	| { op: 'getDbcCatalog'; handleId: string }
	| { op: 'closeDbc'; handleId: string }
	| { op: 'openTrace'; traceType: TraceType; bytes: Uint8Array }
	| { op: 'getTraceMetadata'; handleId: string }
	| { op: 'closeTrace'; handleId: string }
	| {
			op: 'getSignalValues';
			dbcHandleId: string;
			traceHandleId: string;
			messageIdentity: DbcMessageIdentity;
			signalName: string;
	  };

export type WasmWorkerRequest = WasmRpcPayload & { id: string };

export type WasmWorkerSync = {
	type: 'sync';
};

export type WasmWorkerReady = {
	type: 'ready';
};

export type WasmWorkerBootFailed = {
	type: 'boot-failed';
	error: string;
};

export type WasmWorkerSuccess = {
	id: string;
	ok: true;
	result: unknown;
};

export type WasmWorkerFailure = {
	id: string;
	ok: false;
	error: string;
};

export type WasmWorkerMessage =
	| WasmWorkerSync
	| WasmWorkerReady
	| WasmWorkerBootFailed
	| WasmWorkerSuccess
	| WasmWorkerFailure;
