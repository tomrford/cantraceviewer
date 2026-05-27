type SearchDocument = {
	id: number;
	searchText: string;
};

let miniSearchPromise: Promise<typeof import('minisearch')> | null = null;

export function preloadFuzzySearch(): void {
	void loadMiniSearch();
}

export async function rankedFuzzySearch<T>(
	items: T[],
	query: string,
	getSearchText: (item: T) => string
): Promise<T[]> {
	const trimmedQuery = query.trim();
	if (trimmedQuery.length === 0) return items;

	const { default: MiniSearch } = await loadMiniSearch();
	const documents = items.map<SearchDocument>((item, id) => ({
		id,
		searchText: getSearchText(item)
	}));
	const miniSearch = new MiniSearch<SearchDocument>({
		fields: ['searchText'],
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
		.map((result) => items[result.id as number]);
}

function loadMiniSearch(): Promise<typeof import('minisearch')> {
	miniSearchPromise ??= import('minisearch');
	return miniSearchPromise;
}

function tokenizeSearchText(text: string): string[] {
	return Array.from(
		new Set(
			text
				.trim()
				.split(/[\s\p{P}]+/u)
				.flatMap((term) => [term, ...camelCaseTerms(term)])
				.filter(Boolean)
		)
	);
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
