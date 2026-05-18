export function filesFromDrop(event: DragEvent): File[] {
	return Array.from(event.dataTransfer?.files ?? []);
}

export function hasDraggedFiles(event: DragEvent): boolean {
	return event.dataTransfer?.types.includes('Files') ?? false;
}

export function traceFileFromDrop(files: Iterable<File>): File | null {
	const droppedFiles = Array.from(files);
	if (droppedFiles.length !== 1) return null;

	return isTraceFile(droppedFiles[0]) ? droppedFiles[0] : null;
}

export function dbcFilesFromDrop(files: Iterable<File>): File[] {
	return Array.from(files).filter(isDbcFile);
}

function isTraceFile(file: File): boolean {
	return /\.(asc|trc|blf)$/i.test(file.name);
}

function isDbcFile(file: File): boolean {
	return /\.dbc$/i.test(file.name);
}
