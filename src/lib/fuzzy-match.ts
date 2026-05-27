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
	const trimmedQuery = query.trim();
	if (trimmedQuery.length === 0) return items;

	const documents = items.map<SearchDocument<T>>((item, id) => ({
		id,
		item,
		searchText: normalizeSearchText(getSearchText(item))
	}));
	const miniSearch = new MiniSearch<SearchDocument<T>>({
		fields: ['searchText'],
		storeFields: ['item'],
		tokenize: tokenizeSearchText,
		processTerm: normalizeSearchTerm
	});

	miniSearch.addAll(documents);

	return miniSearch
		.search(trimmedQuery, {
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
		.trim()
		.replace(/\s+/g, ' ');
}

function tokenizeSearchText(text: string): string[] {
	return text
		.split(/[\s\p{P}]+/u)
		.flatMap((term) => [term, ...camelCaseTerms(term)])
		.filter(Boolean);
}

function camelCaseTerms(term: string): string[] {
	return term.split(/(?<=[\p{Ll}\p{Nd}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u);
}

function normalizeSearchTerm(term: string): string {
	return term
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}
