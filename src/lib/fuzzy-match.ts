import Fuse from 'fuse.js';

export function rankedFuzzySearch<T>(
	items: T[],
	query: string,
	getSearchText: (item: T) => string | readonly string[]
): T[] {
	const normalizedQuery = normalizeSearchText(query);
	if (normalizedQuery.length === 0) return items;

	const indexedItems = items.map((item) => ({
		item,
		searchText: searchFields(getSearchText(item))
	}));

	return new Fuse(indexedItems, {
		keys: ['searchText'],
		ignoreDiacritics: true,
		ignoreLocation: false,
		includeScore: true,
		minMatchCharLength: 2,
		threshold: 0.3,
		distance: 36,
		fieldNormWeight: 1.5
	})
		.search(normalizedQuery)
		.sort(
			(left, right) =>
				searchRank(left.item.searchText, normalizedQuery) -
					searchRank(right.item.searchText, normalizedQuery) ||
				(left.score ?? 0) - (right.score ?? 0)
		)
		.map((result) => result.item.item);
}

function searchFields(searchText: string | readonly string[]): string[] {
	const fields = Array.isArray(searchText) ? searchText : [searchText];
	return fields.map(normalizeSearchText).filter(Boolean);
}

function searchRank(searchText: readonly string[], query: string): number {
	return Math.min(...searchText.map((field) => fieldRank(field, query)));
}

function fieldRank(searchText: string, query: string): number {
	if (searchText === query) return 0;
	if (searchText.startsWith(query)) return 1;
	if (searchText.includes(query)) return 2;
	return 3;
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
