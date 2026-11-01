export type SearchIndex<T> = {
	items: T[];
	entries: Array<{ item: T; haystack: string; identifier: string | null }>;
};

/** `getSearchIdentifier` must return lowercase hex without leading zeros, like `toString(16)`. */
export function createSearchIndex<T>(
	items: T[],
	getSearchText: (item: T) => string,
	getSearchIdentifier: (item: T) => string | null | undefined = () => null
): SearchIndex<T> {
	return {
		items,
		entries: items.map((item) => ({
			item,
			haystack: normalizeSearchText(getSearchText(item)),
			identifier: getSearchIdentifier(item) ?? null
		}))
	};
}

export function searchIndex<T>(index: SearchIndex<T>, query: string): T[] {
	const terms = normalizeSearchText(query)
		.split(/[\s\p{P}]+/u)
		.map((term) => term.replace(/^0x(?=[0-9a-f]+$)/u, ''))
		.filter(Boolean);
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
	const idTerm = canonicalHexId(term);
	if (idTerm === null) return false;
	return idTerm.length < 3 ? identifier === idTerm : identifier.includes(idTerm);
}

function normalizeSearchText(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

function canonicalHexId(text: string): string | null {
	if (!/^[0-9a-f]+$/u.test(text)) return null;
	return text.replace(/^0+/u, '') || '0';
}
