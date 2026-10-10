export async function checkParsingLimits(createClient, transfer = true) {
	const dbc = 'CM_ "é € 😀 \ud800 \udc00";';
	const trace = new TextEncoder().encode('base hex timestamps absolute\n0.001 1 120 Rx d 1 01\n');
	const limits = {
		maxDbcBytes: new TextEncoder().encode(dbc).byteLength,
		maxTraceInputBytes: trace.byteLength,
		maxTraceDataBytes: 64
	};
	const pending = createClient(limits);
	limits.maxDbcBytes = 1;
	const client = await pending;
	try {
		const opened = await client.openDbc(dbc);
		await client.closeDbc(opened.handle);
		let rejected = false;
		try {
			await client.openDbc(dbc + ' ');
		} catch (error) {
			rejected = error.message.includes('byte limit');
		}
		if (!rejected) throw new Error('configured DBC limit was not enforced');
		const oversized = new Uint8Array(trace.byteLength + 1);
		rejected = false;
		try {
			await client.openTrace('asc', transfer ? oversized.buffer : oversized);
		} catch (error) {
			rejected = error.message.includes('byte limit');
		}
		if (!rejected || oversized.byteLength === 0)
			throw new Error('trace preflight consumed an oversized input');
		const parsed = await client.openTrace('asc', transfer ? trace.buffer : trace);
		if (parsed.metadata.validMessageCount !== 1)
			throw new Error('exact trace boundary was rejected');
		await client.closeTrace(parsed.handle);
	} finally {
		await client.close();
	}
}

export async function checkDbc(client, transfer = true) {
	function equal(actual, expected) {
		if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			throw new Error(`DBC result mismatch: ${JSON.stringify(actual)}`);
		}
	}
	const text =
		'BO_ 42 Status: 1 ECU\n SG_ State : 0|8@1+ (1,0) [0|255] "°C € – ™" DASH\nVAL_ 42 State 0 "Arrêt";\n';
	const utf8 = new TextEncoder().encode(text);
	const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
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

	const wide = await client.openDbc(
		'BO_ 291 FD: 64 ECU\n SG_ Raw : 0|512@1+ (1,0) [0|0] "" DASH\n SG_ Scalar : 504|8@1+ (2,-1) [0|509] "" DASH'
	);
	try {
		equal(
			wide.catalog.messages[0].signals.map(({ name }) => name),
			['Scalar']
		);
		equal(
			wide.warnings.map(({ category, keyword, line, column }) => ({
				category,
				keyword,
				line,
				column
			})),
			[{ category: 'omitted-feature', keyword: 'SG_', line: 2, column: 2 }]
		);
		const payload = [...Array(63).fill('00'), '2a'].join(' ');
		const bytes = new TextEncoder().encode(
			`base hex timestamps absolute\n0.001 CANFD 1 Rx 123 - 1 0 15 64 ${payload}`
		);
		const trace = await client.openTrace('asc', transfer ? bytes.buffer : bytes);
		try {
			equal(trace.metadata.validMessageCount, 1);
			equal(trace.metadata.skippedLineCount, 0);
			const series = await client.getSignalValues(
				wide.handle,
				trace.handle,
				{ canId: 291, isExtended: false, sizeBytes: 64 },
				'Scalar'
			);
			equal(Array.from(series.timesMs), [1]);
			equal(Array.from(series.values), [83]);
		} finally {
			await client.closeTrace(trace.handle);
		}
	} finally {
		await client.closeDbc(wide.handle);
	}

	const mux = await client.openDbc(
		'BO_ 291 Nested: 4 ECU\n SG_ Root M : 0|8@1+ (10,7) [0|255] "" ECU\n SG_ Child m2M : 8|8@1- (2,100) [0|255] "" ECU\n SG_ Data m3 : 23|16@0- (0.5,-10) [0|0] "" ECU\nSG_MUL_VAL_ 291 Child Root 2-2;\nSG_MUL_VAL_ 291 Data Child 3-5, 9-9;\nBA_DEF_ BO_ "VFrameFormat" INT 0 15;\nBA_DEF_DEF_ "VFrameFormat" 0;\nBA_ "VFrameFormat" BO_ 291 14;'
	);
	const bytes = new TextEncoder().encode(
		'base hex timestamps absolute\n0.001 1 123 Rx d 4 02 03 00 64\n0.002 CANFD 1 Rx 123 - 1 0 4 4 01 03 00 64\n0.003 CANFD 1 Rx 123 - 1 0 4 4 02 03 00 64\n0.004 CANFD 1 Rx 123 - 1 0 4 4 02 05 ff 9c'
	);
	const trace = await client.openTrace('asc', transfer ? bytes.buffer : bytes);
	try {
		const message = mux.catalog.messages[0];
		equal(message.frameFormat, 'standard-can-fd');
		equal(message.rawFrameDecodable, true);
		equal(message.signals[1].isMultiplexer, true);
		equal(message.signals[2].multiplex, {
			selector: 'Child',
			ranges: [
				{ first: '3', last: '5' },
				{ first: '9', last: '9' }
			]
		});
		const series = await client.getSignalValues(
			mux.handle,
			trace.handle,
			{ canId: 291, isExtended: false, sizeBytes: 4 },
			'Data'
		);
		equal(Array.from(series.timesMs), [3, 4]);
		equal(Array.from(series.values), [40, -60]);
	} finally {
		await client.closeTrace(trace.handle);
		await client.closeDbc(mux.handle);
	}
}
