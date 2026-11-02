import type { DragEvent } from 'react';
import { isDbcFileName } from './dbc-file-types';
import { traceTypeForFileName } from './trace-file-types';

export function filesFromDrop(event: DragEvent): File[] {
	return Array.from(event.dataTransfer.files);
}

export function hasDraggedFiles(event: DragEvent): boolean {
	return event.dataTransfer.types.includes('Files');
}

export function dragLeftCurrentTarget(event: DragEvent): boolean {
	return !event.currentTarget.contains(event.relatedTarget as Node | null);
}

export function traceFileFromDrop(files: File[]): File | null {
	return files.length === 1 && traceTypeForFileName(files[0].name) !== null ? files[0] : null;
}

export function dbcFilesFromDrop(files: File[]): File[] {
	return files.filter((file) => isDbcFileName(file.name));
}
