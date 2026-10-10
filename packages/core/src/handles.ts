import type { DbcHandle, TraceHandle } from './types.ts';

const HandleToken = Symbol('CAN Trace Viewer handle token');

export type HandleKind = 'dbc' | 'trace';

type HandleFor = { dbc: DbcHandle; trace: TraceHandle };
type Carrier = { [HandleToken]?: symbol };
type Entry<Payload> = {
	closed: boolean;
	kind: HandleKind;
	payload: Payload | null;
};

export type HandleRegistry<Payloads extends Record<HandleKind, unknown>> = {
	issue<K extends HandleKind>(kind: K, payload: Payloads[K]): HandleFor[K];
	payload<K extends HandleKind>(kind: K, handle: HandleFor[K]): Payloads[K];
	release<K extends HandleKind>(kind: K, handle: HandleFor[K]): Payloads[K] | null;
	releaseAll(): Payloads[HandleKind][];
};

export function createHandleRegistry<
	Payloads extends Record<HandleKind, unknown>
>(): HandleRegistry<Payloads> {
	type AnyPayload = Payloads[HandleKind];
	const entries = new Map<symbol, Entry<AnyPayload>>();

	function entryFor(kind: HandleKind, handle: unknown): Entry<AnyPayload> {
		const token = (handle as Carrier)[HandleToken];
		const entry = token ? entries.get(token) : undefined;
		if (!entry || entry.kind !== kind) {
			throw new Error(`${kind} handle does not belong to this client`);
		}
		return entry;
	}

	return {
		issue(kind, payload) {
			const token = Symbol(`CAN Trace Viewer ${kind} handle`);
			entries.set(token, { closed: false, kind, payload: payload as AnyPayload });
			return { [HandleToken]: token } as unknown as HandleFor[typeof kind];
		},
		payload(kind, handle) {
			const entry = entryFor(kind, handle);
			if (entry.closed) throw new Error(`${kind} handle is closed`);
			return entry.payload as Payloads[typeof kind];
		},
		release(kind, handle) {
			const entry = entryFor(kind, handle);
			if (entry.closed) return null;
			entry.closed = true;
			const payload = entry.payload as Payloads[typeof kind];
			entry.payload = null;
			return payload;
		},
		releaseAll() {
			const payloads: AnyPayload[] = [];
			for (const entry of entries.values()) {
				if (entry.closed) continue;
				entry.closed = true;
				payloads.push(entry.payload as AnyPayload);
				entry.payload = null;
			}
			return payloads;
		}
	};
}
