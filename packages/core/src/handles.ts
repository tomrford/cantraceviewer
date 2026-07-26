import type { DbcHandle, TraceHandle } from './types.ts';

/**
 * Client-local handle identity, shared by the synchronous direct client and the asynchronous
 * transport clients. @internal
 *
 * Each handle carries one private symbol token. The token is a primitive, so arbitrary reactive
 * proxies return it unchanged and object spreads copy it. The mutable state stays in this
 * client-local registry rather than on the handle, so proxies cannot duplicate or wrap it.
 */
const HandleToken = Symbol('CAN Trace Viewer handle token');

export type HandleKind = 'dbc' | 'trace';

type HandleFor = { dbc: DbcHandle; trace: TraceHandle };
type Carrier = { [HandleToken]?: symbol };
type Entry<Payload> = {
	closed: boolean;
	kind: HandleKind;
	payload: Payload | null;
};

/**
 * Owns the handles one client issued. `Payloads` maps each handle kind to what the client needs to
 * act on it: the direct client stores wasm-bindgen objects, the transport clients store wire IDs.
 */
export type HandleRegistry<Payloads extends Record<HandleKind, unknown>> = {
	issue<K extends HandleKind>(kind: K, payload: Payloads[K]): HandleFor[K];
	/** Payload of an owned, open handle. Throws for foreign, wrong-kind, or closed handles. */
	payload<K extends HandleKind>(kind: K, handle: HandleFor[K]): Payloads[K];
	/**
	 * Mark an owned handle closed and return its payload for cleanup, or null when it was already
	 * closed. Throws for foreign or wrong-kind handles.
	 */
	release<K extends HandleKind>(kind: K, handle: HandleFor[K]): Payloads[K] | null;
	/** Mark every live handle closed and return their payloads in issue order. */
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
			// Object spread copies this enumerable symbol while proxies preserve its primitive value.
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
