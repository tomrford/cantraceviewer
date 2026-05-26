export type WasmTraceType = 'asc' | 'trc' | 'blf';

export type WasmDbcMessageIdentity = {
	canId: number;
	isExtended: boolean;
	sizeBytes: number;
};

export type WasmRpcPayload =
	| { op: 'openDbc'; text: string }
	| { op: 'getDbcCatalog'; handleId: string }
	| { op: 'closeDbc'; handleId: string }
	| { op: 'openTrace'; traceType: WasmTraceType; bytes: Uint8Array }
	| { op: 'getTraceMetadata'; handleId: string }
	| { op: 'closeTrace'; handleId: string }
	| {
			op: 'getSignalValues';
			dbcHandleId: string;
			traceHandleId: string;
			messageIdentity: WasmDbcMessageIdentity;
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
	transfer?: ArrayBuffer[];
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
