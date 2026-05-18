import { isTraceFileName } from './trace-file-types';

export function filesFromDrop(event: DragEvent): File[] {
	return Array.from(event.dataTransfer?.files ?? []);
}

export function hasDraggedFiles(event: DragEvent): boolean {
	return event.dataTransfer?.types.includes('Files') ?? false;
}

export function dragLeftCurrentTarget(event: DragEvent): boolean {
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
