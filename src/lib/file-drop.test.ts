import { describe, expect, it } from 'vitest';

import { dbcFilesFromDrop, refuseStrayFileDrops, traceFileFromDrop } from '@/lib/file-drop';

describe('file drop helpers', () => {
	it('selects one supported trace file', () => {
		expect(traceFileFromDrop([new File([''], 'drive.trc')])?.name).toBe('drive.trc');
		expect(traceFileFromDrop([new File([''], 'drive.MF4')])?.name).toBe('drive.MF4');
	});

	it('rejects multi-file trace drops', () => {
		expect(
			traceFileFromDrop([new File([''], 'drive.trc'), new File([''], 'other.asc')])
		).toBeNull();
	});

	it('ignores unsupported trace files', () => {
		expect(traceFileFromDrop([new File([''], 'powertrain.dbc')])).toBeNull();
	});

	it('refuses only file drags that no drop target claimed', () => {
		const target = new EventTarget();
		refuseStrayFileDrops(target as unknown as Window);
		const drag = (type: string, types: string[], claimed = false) => {
			const event = new Event(type, { cancelable: true });
			const dataTransfer = { types, dropEffect: 'copy' };
			Object.assign(event, { dataTransfer });
			if (claimed) event.preventDefault();
			target.dispatchEvent(event);
			return { prevented: event.defaultPrevented, dropEffect: dataTransfer.dropEffect };
		};

		expect(drag('dragover', ['Files'])).toEqual({ prevented: true, dropEffect: 'none' });
		expect(drag('drop', ['Files']).prevented).toBe(true);
		expect(drag('dragover', ['Files'], true).dropEffect).toBe('copy');
		expect(drag('drop', ['text/plain']).prevented).toBe(false);
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
