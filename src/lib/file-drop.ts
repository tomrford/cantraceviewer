import { isTraceFileName } from './trace-file-types';

// Structural so both native and React drag events fit.
type DropEvent = { dataTransfer: DataTransfer | null };
type LeaveEvent = { relatedTarget: EventTarget | null; currentTarget: EventTarget | null };

export function filesFromDrop(event: DropEvent): File[] {
	return Array.from(event.dataTransfer?.files ?? []);
}

export function hasDraggedFiles(event: DropEvent): boolean {
	return event.dataTransfer?.types.includes('Files') ?? false;
}

export function dragLeftCurrentTarget(event: LeaveEvent): boolean {
	const nextTarget = event.relatedTarget;
	return !(
		nextTarget instanceof Node &&
		event.currentTarget instanceof Node &&
		event.currentTarget.contains(nextTarget)
	);
}

export function traceFileFromDrop(files: Iterable<File>): File | null {
	const droppedFiles = Array.from(files);
	if (droppedFiles.length !== 1) return null;

	return isTraceFileName(droppedFiles[0].name) ? droppedFiles[0] : null;
}

export function dbcFilesFromDrop(files: Iterable<File>): File[] {
	return Array.from(files).filter((file) => /\.dbc$/i.test(file.name));
}
