export type SearchIndex<T> = {
	items: T[];
	entries: Array<{ item: T; haystack: string; identifier: string | null }>;
};

export function createSearchIndex<T>(
	items: T[],
	getSearchText: (item: T) => string,
	getSearchIdentifier: (item: T) => string | null | undefined = () => null
): SearchIndex<T> {
	return {
		items,
		entries: items.map((item) => {
			const haystack = normalizeSearchText(getSearchText(item));
			const identifier = getSearchIdentifier(item);
			return {
				item,
				haystack,
				identifier: identifier == null ? null : normalizeSearchText(identifier)
			};
		})
	};
}

export function searchIndex<T>(index: SearchIndex<T>, query: string): T[] {
	const terms = tokenizeSearchText(normalizeSearchText(query));
	if (terms.length === 0) return index.items;

	return index.entries
		.filter(({ haystack, identifier }) =>
			terms.every((term) => matchSearchTerm(term, haystack, identifier))
		)
		.map(({ item }) => item);
}

function matchSearchTerm(term: string, haystack: string, identifier: string | null): boolean {
	if (haystack.includes(term)) return true;
	if (identifier === null) return false;
	return isShortHexTerm(term) ? identifier === term : identifier.includes(term);
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
