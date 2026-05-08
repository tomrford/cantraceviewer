import Fuse from 'fuse.js';

export function rankedFuzzySearch<T>(
	items: T[],
	query: string,
	getSearchText: (item: T) => string
): T[] {
	const normalizedQuery = query.trim();
	if (normalizedQuery.length === 0) return items;

	const indexedItems = items.map((item) => ({
		item,
		searchText: getSearchText(item)
	}));

	return new Fuse(indexedItems, {
		keys: ['searchText'],
		ignoreLocation: true,
		includeScore: true,
		threshold: 0.35
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

function searchRank(searchText: string, query: string): number {
	const normalizedQuery = query.toLowerCase();
	const normalizedText = searchText.toLowerCase();

	if (normalizedText === normalizedQuery) return 0;
	if (normalizedText.startsWith(normalizedQuery)) return 1;
	if (normalizedText.includes(normalizedQuery)) return 2;
	return 3;
}
