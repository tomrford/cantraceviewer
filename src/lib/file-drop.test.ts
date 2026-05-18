import { describe, expect, it } from 'vitest';
import { dbcFilesFromDrop, traceFileFromDrop } from './file-drop';

describe('file drop helpers', () => {
	it('selects one supported trace file', () => {
		expect(traceFileFromDrop([file('drive.trc')])?.name).toBe('drive.trc');
	});

	it('rejects multi-file trace drops', () => {
		expect(traceFileFromDrop([file('drive.trc'), file('other.asc')])).toBeNull();
	});

	it('ignores unsupported trace files', () => {
		expect(traceFileFromDrop([file('powertrain.dbc')])).toBeNull();
	});

	it('keeps all dropped DBC files', () => {
		const files = [file('powertrain.dbc'), file('trace.asc'), file('body.DBC')];

		expect(dbcFilesFromDrop(files).map((dropped) => dropped.name)).toEqual([
			'powertrain.dbc',
			'body.DBC'
		]);
	});
});

function file(name: string): File {
	return new File([''], name);
}
