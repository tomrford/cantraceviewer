export type FuzzySearchIndex<T> = {
	items: T[];
	entries: Array<{ item: T; haystack: string; tokens: string[] }>;
};

export function createFuzzySearchIndex<T>(
	items: T[],
	getSearchText: (item: T) => string
): FuzzySearchIndex<T> {
	return {
		items,
		entries: items.map((item) => {
			const haystack = normalizeSearchText(getSearchText(item));
			return { item, haystack, tokens: tokenizeSearchText(haystack) };
		})
	};
}

export function searchFuzzyIndex<T>(index: FuzzySearchIndex<T>, query: string): T[] {
	const terms = tokenizeSearchText(normalizeSearchText(query));
	if (terms.length === 0) return index.items;

	return index.entries
		.filter(({ haystack, tokens }) =>
			terms.every((term) => matchSearchTerm(term, haystack, tokens))
		)
		.map(({ item }) => item);
}

function matchSearchTerm(term: string, haystack: string, tokens: string[]): boolean {
	if (isShortHexTerm(term)) return tokens.includes(term);
	return haystack.includes(term);
}

function tokenizeSearchText(text: string): string[] {
	return text
		.split(/[\s\p{P}]+/u)
		.map(stripHexPrefix)
		.filter(Boolean);
}

function normalizeSearchText(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

function stripHexPrefix(term: string): string {
	if (term.startsWith('0x') && /^[0-9a-f]+$/u.test(term.slice(2))) return term.slice(2);
	return term;
}

function isShortHexTerm(term: string): boolean {
	return term.length > 0 && term.length < 3 && /^[0-9a-f]+$/u.test(term);
}
