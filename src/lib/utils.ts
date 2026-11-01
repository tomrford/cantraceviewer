import { clsx, type ClassValue } from 'clsx';
import { useSyncExternalStore } from 'react';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

const subscribeNever = () => () => {};

/** Reads a browser value that never changes. Prerender and hydration get `serverValue`. */
export function useBrowserValue<T>(read: () => T, serverValue: T): T {
	return useSyncExternalStore(subscribeNever, read, () => serverValue);
}
