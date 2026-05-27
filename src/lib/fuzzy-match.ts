import MiniSearch from 'minisearch';

type SearchDocument<T> = {
	id: number;
	item: T;
	searchText: string;
};

export function rankedFuzzySearch<T>(
	items: T[],
	query: string,
	getSearchText: (item: T) => string
): T[] {
	const normalizedQuery = normalizeSearchText(query);
	if (normalizedQuery.length === 0) return items;

	const documents = items.map<SearchDocument<T>>((item, id) => ({
		id,
		item,
		searchText: normalizeSearchText(getSearchText(item))
	}));
	const miniSearch = new MiniSearch<SearchDocument<T>>({
		fields: ['searchText'],
		storeFields: ['item']
	});

	miniSearch.addAll(documents);

	return miniSearch
		.search(normalizedQuery, {
			prefix: true,
			fuzzy: (term) => (term.length >= 3 ? 0.3 : false),
			combineWith: 'AND'
		})
		.map((result) => documents[result.id as number].item);
}

function normalizeSearchText(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ' ');
}
