import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Total signals across DBC messages or MF4 channel groups. */
export function countSignals(owners: readonly { signals: readonly unknown[] }[]): number {
	return owners.reduce((count, owner) => count + owner.signals.length, 0);
}
