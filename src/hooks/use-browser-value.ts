import { useSyncExternalStore } from 'react';

const subscribeNever = () => () => {};

/** Reads a browser value that never changes. Prerender and hydration get `serverValue`. */
export function useBrowserValue<T>(read: () => T, serverValue: T): T {
	return useSyncExternalStore(subscribeNever, read, () => serverValue);
}
