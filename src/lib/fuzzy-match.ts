export function fuzzyIncludes(text: string, query: string): boolean {
	const tokens = query.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return true;

	const normalizedText = normalizeForFuzzyMatch(text);
	return tokens.every((token) => fuzzySubsequence(normalizedText, normalizeForFuzzyMatch(token)));
}

function normalizeForFuzzyMatch(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function fuzzySubsequence(text: string, query: string): boolean {
	if (query.length === 0) return true;

	let textIndex = 0;
	for (const queryChar of query) {
		textIndex = text.indexOf(queryChar, textIndex);
		if (textIndex === -1) return false;
		textIndex += 1;
	}

	return true;
}
