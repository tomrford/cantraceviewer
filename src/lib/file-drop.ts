import type { DragEvent as ReactDragEvent } from 'react';

import { isDbcFileName } from '@/lib/dbc-file-types';
import { traceTypeForFileName } from '@/lib/trace-file-types';

export function filesFromDrop(event: ReactDragEvent): File[] {
	return Array.from(event.dataTransfer.files);
}

export function hasDraggedFiles(event: ReactDragEvent): boolean {
	return event.dataTransfer.types.includes('Files');
}

export function dragLeftCurrentTarget(event: ReactDragEvent): boolean {
	return !event.currentTarget.contains(event.relatedTarget as Node | null);
}

/**
 * Refuses file drags that no drop target claimed. Left alone, the browser opens a file dropped on
 * the header, a dialog backdrop or a toast in place of the app, discarding the open trace.
 * Drop targets run first and call `preventDefault`, so this only sees what they declined.
 */
export function refuseStrayFileDrops(target: Pick<Window, 'addEventListener'> = window): void {
	const refuse = (event: DragEvent) => {
		if (event.defaultPrevented || !event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'none';
	};
	target.addEventListener('dragover', refuse);
	target.addEventListener('drop', refuse);
}

export function traceFileFromDrop(files: File[]): File | null {
	return files.length === 1 && traceTypeForFileName(files[0].name) !== null ? files[0] : null;
}

export function dbcFilesFromDrop(files: File[]): File[] {
	return files.filter((file) => isDbcFileName(file.name));
}
