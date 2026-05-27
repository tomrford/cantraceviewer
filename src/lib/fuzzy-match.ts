import Fuse from 'fuse.js';

type IndexedItem<T> = {
	item: T;
	index: number;
	searchText: string[];
};

export function rankedFuzzySearch<T>(
	items: T[],
	query: string,
	getSearchText: (item: T) => string | readonly string[]
): T[] {
	const normalizedQuery = normalizeSearchText(query);
	if (normalizedQuery.length === 0) return items;

	const indexedItems = items.map((item, index) => ({
		item,
		index,
		searchText: searchFields(getSearchText(item))
	}));
	const deterministicMatches = indexedItems
		.map((item) => ({
			item,
			rank: deterministicRank(item.searchText, normalizedQuery)
		}))
		.filter((match): match is { item: IndexedItem<T>; rank: number } => match.rank !== null)
		.sort((left, right) => left.rank - right.rank || left.item.index - right.item.index)
		.map((match) => match.item);
	const deterministicItems = new Set(deterministicMatches);
	const fuzzyMatches = shouldFuzzyMatch(normalizedQuery)
		? fuzzySearch(indexedItems, normalizedQuery).filter((item) => !deterministicItems.has(item))
		: [];

	return [...deterministicMatches, ...fuzzyMatches].map((result) => result.item);
}

function fuzzySearch<T>(indexedItems: IndexedItem<T>[], normalizedQuery: string): IndexedItem<T>[] {
	return new Fuse(indexedItems, {
		keys: ['searchText'],
		ignoreDiacritics: true,
		ignoreLocation: true,
		includeScore: true,
		threshold: 0.3,
		fieldNormWeight: 1.5
	})
		.search(normalizedQuery)
		.sort((left, right) => (left.score ?? 0) - (right.score ?? 0))
		.map((result) => result.item);
}

function searchFields(searchText: string | readonly string[]): string[] {
	const fields = Array.isArray(searchText) ? searchText : [searchText];
	return fields.map(normalizeSearchText).filter(Boolean);
}

function deterministicRank(searchText: readonly string[], query: string): number | null {
	const queryWords = query.split(' ');
	const searchWords = searchText.flatMap((field) => field.split(' '));
	const fieldRank = Math.min(
		...searchText.map((field) => {
			if (field === query) return 0;
			if (field.startsWith(query)) return 10;
			return Number.POSITIVE_INFINITY;
		})
	);

	if (fieldRank < Number.POSITIVE_INFINITY) return fieldRank;
	if (queryWords.every((word) => searchWords.some((searchWord) => searchWord.startsWith(word)))) {
		return 20;
	}
	if (queryWords.length > 1) return null;

	const substringRank = Math.min(
		...searchText.map((field) => {
			const index = field.indexOf(query);
			return index === -1 ? Number.POSITIVE_INFINITY : 30 + index / 1000;
		})
	);

	return substringRank < Number.POSITIVE_INFINITY ? substringRank : null;
}

function shouldFuzzyMatch(query: string): boolean {
	return query.length >= 3 && !query.includes(' ');
}

function normalizeSearchText(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}
