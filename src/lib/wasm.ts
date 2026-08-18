import { createCanTraceClient, type CanTraceClient } from 'cantraceviewer';
import type {
	DbcHandle,
	DbcMessageIdentity,
	DecodedSignalSeries,
	OpenTraceResult,
	ParsedDbc,
	TraceHandle,
	TraceType
} from 'cantraceviewer';

export type * from 'cantraceviewer';

/** Remember one successful client. A failed create is forgotten so the next call can retry. */
export function createClientSlot<Client>(create: () => Promise<Client>): () => Promise<Client> {
	let clientPromise: Promise<Client> | null = null;
	return () => {
		if (clientPromise) return clientPromise;

		const pending = create();
		clientPromise = pending;
		void pending.catch(() => {
			// A rejected factory produced no client. Let a later user operation retry startup without
			// restarting a client that had already become fatal during normal operation.
			if (clientPromise === pending) clientPromise = null;
		});
		return pending;
	};
}

const client = createClientSlot(createCanTraceClient);

export async function openDbc(text: string): Promise<{ handle: DbcHandle; catalog: ParsedDbc }> {
	return (await client()).openDbc(text);
}

export async function closeDbc(handle: DbcHandle): Promise<void> {
	return (await client()).closeDbc(handle);
}

export async function openTrace(traceType: TraceType, bytes: Uint8Array): Promise<OpenTraceResult> {
	const buffer = bytes.buffer;
	if (
		!(buffer instanceof ArrayBuffer) ||
		bytes.byteOffset !== 0 ||
		bytes.byteLength !== buffer.byteLength
	) {
		throw new Error(
			'openTrace requires a Uint8Array over one exact ordinary ArrayBuffer; subviews and SharedArrayBuffer-backed views are not supported'
		);
	}

	return (await client()).openTrace(traceType, buffer);
}

export async function closeTrace(handle: TraceHandle): Promise<void> {
	return (await client()).closeTrace(handle);
}

export async function getSignalValues(
	dbcHandle: DbcHandle,
	traceHandle: TraceHandle,
	messageIdentity: DbcMessageIdentity,
	signalName: string
): Promise<DecodedSignalSeries> {
	return (await client()).getSignalValues(dbcHandle, traceHandle, messageIdentity, signalName);
}

export async function getMf4SignalValues(
	traceHandle: TraceHandle,
	signalId: number
): Promise<DecodedSignalSeries> {
	return (await client()).getMf4SignalValues(traceHandle, signalId);
}
