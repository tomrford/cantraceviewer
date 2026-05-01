export const SIGNAL_COLORS = [
	'#38bdf8',
	'#fb7185',
	'#4ade80',
	'#facc15',
	'#a78bfa',
	'#2dd4bf',
	'#f472b6',
	'#fb923c',
	'#60a5fa',
	'#bef264',
	'#f87171',
	'#22d3ee',
	'#c084fc',
	'#fde047',
	'#34d399',
	'#f9a8d4',
	'#818cf8',
	'#fdba74',
	'#a3e635',
	'#67e8f9',
	'#e879f9',
	'#86efac',
	'#fda4af',
	'#7dd3fc',
	'#d9f99d',
	'#f0abfc',
	'#6ee7b7',
	'#c4b5fd',
	'#fcd34d',
	'#93c5fd'
];

export function createSignalColorAssigner(palette: readonly string[] = SIGNAL_COLORS) {
	const indexBySignalKey = new Map<string, number>();

	return {
		colorFor(key: string): string {
			const existing = indexBySignalKey.get(key);
			if (existing !== undefined) return palette[existing % palette.length];

			const index = lowestAvailableIndex(indexBySignalKey);
			indexBySignalKey.set(key, index);
			return palette[index % palette.length];
		},
		clear(): void {
			indexBySignalKey.clear();
		},
		release(key: string): void {
			indexBySignalKey.delete(key);
		}
	};
}

function lowestAvailableIndex(indexBySignalKey: Map<string, number>): number {
	const usedIndexes = new Set(indexBySignalKey.values());
	for (let index = 0; ; index += 1) {
		if (!usedIndexes.has(index)) return index;
	}
}
