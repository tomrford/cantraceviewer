const DBC_EXTENSION = /\.dbc$/i;

export function isDbcFileName(fileName: string): boolean {
	return DBC_EXTENSION.test(fileName);
}

export function displayDbcName(fileName: string): string {
	return fileName.replace(DBC_EXTENSION, '');
}
