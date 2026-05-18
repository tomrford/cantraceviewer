import { describe, expect, it } from 'vitest';
import { dbcFilesFromDrop, traceFileFromDrop } from './file-drop';

describe('file drop helpers', () => {
	it('selects one supported trace file', () => {
		expect(traceFileFromDrop([new File([''], 'drive.trc')])?.name).toBe('drive.trc');
	});

	it('rejects multi-file trace drops', () => {
		expect(
			traceFileFromDrop([new File([''], 'drive.trc'), new File([''], 'other.asc')])
		).toBeNull();
	});

	it('ignores unsupported trace files', () => {
		expect(traceFileFromDrop([new File([''], 'powertrain.dbc')])).toBeNull();
	});

	it('keeps all dropped DBC files', () => {
		const files = [
			new File([''], 'powertrain.dbc'),
			new File([''], 'trace.asc'),
			new File([''], 'body.DBC')
		];

		expect(dbcFilesFromDrop(files).map((dropped) => dropped.name)).toEqual([
			'powertrain.dbc',
			'body.DBC'
		]);
	});
});
