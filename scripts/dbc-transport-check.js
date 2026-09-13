// Executed verbatim by the packed direct, Node and browser transport smoke tests.
export async function checkDbc(client) {
	function equal(actual, expected) {
		if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			throw new Error(`DBC result mismatch: ${JSON.stringify(actual)}`);
		}
	}
	const text =
		'BO_ 42 Status: 1 ECU\n SG_ State : 0|8@1+ (1,0) [0|255] "°C € – ™" DASH\nVAL_ 42 State 0 "Arrêt";\n';
	const utf8 = new TextEncoder().encode(text);
	const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
	// Independently specified Windows-1252 bytes, including C1 punctuation.
	const legacy = Uint8Array.from(
		[...text].map((char) => ({ '€': 0x80, '–': 0x96, '™': 0x99 })[char] ?? char.charCodeAt(0))
	);
	let expected;
	for (const input of [
		text,
		utf8,
		bom,
		legacy,
		new Uint8Array([0, ...legacy, 0]).subarray(1, legacy.length + 1)
	]) {
		const { handle, catalog, warnings } = await client.openDbc(input);
		try {
			equal(catalog.messages[0].signals[0].unit, '°C € – ™');
			equal(catalog.messages[0].signals[0].valueDescriptions, [{ rawValue: 0, label: 'Arrêt' }]);
			equal(warnings, []);
			expected ??= catalog;
			equal(catalog, expected);
			if (typeof input !== 'string') equal(input.byteLength > 0, true);
		} finally {
			await client.closeDbc(handle);
		}
	}
	const partial =
		text +
		'  VAL_ 999 State 0 "private";\n\tSIG_VALTYPE_ 42 Missing : 1;\nCM_ BO_ 42 "private;\nBO_ 99 Fake: 8 ECU";\n';
	const opened = await client.openDbc(new TextEncoder().encode(partial));
	try {
		equal(opened.catalog, expected);
		equal(
			opened.warnings.map(({ category, keyword, line, column }) => ({
				category,
				keyword,
				line,
				column
			})),
			[
				{ category: 'dangling-reference', keyword: 'VAL_', line: 4, column: 3 },
				{ category: 'dangling-reference', keyword: 'SIG_VALTYPE_', line: 5, column: 2 },
				{ category: 'unsupported-record', keyword: 'CM_', line: 6, column: 1 }
			]
		);
		equal(JSON.stringify(opened.warnings).includes('private'), false);
	} finally {
		await client.closeDbc(opened.handle);
	}
	let failed = false;
	try {
		await client.openDbc('BO_ 42 Status: 1 ECU\n  SG_ private : 8|8@1+ (1,0) [0|255] "" DASH');
	} catch (error) {
		failed = true;
		equal(error.message.includes('2:3: SG_'), true);
		equal(error.message.includes('private'), false);
	}
	equal(failed, true);
}
