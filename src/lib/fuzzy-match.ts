import MiniSearch from 'minisearch';

type SearchDocument<T> = {
	id: number;
	item: T;
	searchFields: string[];
	searchText: string;
};

export function rankedFuzzySearch<T>(
	items: T[],
	query: string,
	getSearchText: (item: T) => string | readonly string[]
): T[] {
	const normalizedQuery = normalizeSearchText(query);
	if (normalizedQuery.length === 0) return items;

	const documents = items.map<SearchDocument<T>>((item, id) => {
		const searchFields = searchFieldsFor(getSearchText(item));
		return {
			id,
			item,
			searchFields,
			searchText: searchFields.join(' ')
		};
	});
	const literalMatches = documents
		.map((document) => ({
			document,
			rank: literalRank(document.searchFields, normalizedQuery)
		}))
		.filter((match): match is { document: SearchDocument<T>; rank: number } => match.rank !== null)
		.sort((left, right) => left.rank - right.rank || left.document.id - right.document.id)
		.map((match) => match.document);
	const literalIds = new Set(literalMatches.map((document) => document.id));
	const miniSearch = new MiniSearch<SearchDocument<T>>({
		fields: ['searchText'],
		storeFields: ['item']
	});

	miniSearch.addAll(documents);

	const searchMatches = miniSearch
		.search(normalizedQuery, {
			prefix: true,
			fuzzy: (term) => (term.length >= 3 ? 0.3 : false),
			combineWith: 'AND',
			weights: { prefix: 0.8, fuzzy: 0.25 }
		})
		.filter((result) => !literalIds.has(result.id as number))
		.map((result) => documents[result.id as number]);

	return [...literalMatches, ...searchMatches].map((document) => document.item);
}

function searchFieldsFor(searchText: string | readonly string[]): string[] {
	const fields = Array.isArray(searchText) ? searchText : [searchText];
	return fields.map(normalizeSearchText).filter(Boolean);
}

function literalRank(searchFields: readonly string[], query: string): number | null {
	const fieldRank = Math.min(
		...searchFields.map((field) => {
			if (field === query) return 0;
			if (field.startsWith(query)) return 10;
			return Number.POSITIVE_INFINITY;
		})
	);

	if (fieldRank < Number.POSITIVE_INFINITY) return fieldRank;
	if (hasMultipleTerms(query)) return null;

	const substringRank = Math.min(
		...searchFields.map((field) => {
			const index = field.indexOf(query);
			return index === -1 ? Number.POSITIVE_INFINITY : 20 + index / 1000;
		})
	);

	return substringRank < Number.POSITIVE_INFINITY ? substringRank : null;
}

function hasMultipleTerms(query: string): boolean {
	return /[\s\p{P}]+/u.test(query);
}

function normalizeSearchText(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ' ');
}
