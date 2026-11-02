import { useState, type DragEvent } from 'react';
import { dragLeftCurrentTarget, filesFromDrop, hasDraggedFiles } from '#lib/file-drop.js';

/** Tracks a file drag over an element and hands dropped files to `onFiles`. */
export function useFileDrop(onFiles: (files: File[]) => void) {
	const [dropActive, setDropActive] = useState(false);

	function handleDrag(event: DragEvent) {
		if (!hasDraggedFiles(event)) return;
		event.preventDefault();
		setDropActive(true);
	}

	function handleDragLeave(event: DragEvent) {
		if (dragLeftCurrentTarget(event)) setDropActive(false);
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		setDropActive(false);
		onFiles(filesFromDrop(event));
	}

	return {
		dropActive,
		dropHandlers: {
			onDragEnter: handleDrag,
			onDragOver: handleDrag,
			onDragLeave: handleDragLeave,
			onDrop: handleDrop
		}
	};
}
