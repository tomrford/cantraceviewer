import { domToBlob } from 'modern-screenshot';
import { toast } from 'sonner';

import { appStore } from '#lib/stores/store.js';

const EXPORT_BRAND = 'cantraceviewer.com';

export type ImageDestination = 'copy' | 'save';

export async function exportPlotImage(
	root: HTMLElement,
	destination: ImageDestination
): Promise<void> {
	try {
		const image = capturePlotImage(root);
		if (destination === 'copy') {
			await copyPlotImage(image);
			toast.success('Image copied to clipboard.');
		} else {
			await savePlotImage(image, plotImageFilename(appStore.getState().traceName));
		}
	} catch (error) {
		console.error('Plot image export failed.', error);
		toast.error(destination === 'copy' ? 'Could not copy image.' : 'Could not save image.');
	}
}

async function capturePlotImage(root: HTMLElement): Promise<Blob> {
	return domToBlob(root, {
		scale: window.devicePixelRatio || 1,
		filter: (node) => !(node instanceof Element && node.hasAttribute('data-export-ignore')),
		onCloneNode: addExportBrand
	});
}

async function copyPlotImage(image: Promise<Blob>): Promise<void> {
	if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
		throw new Error('Image copying is not supported by this browser.');
	}

	await navigator.clipboard.write([
		new ClipboardItem({
			'image/png': image
		})
	]);
}

async function savePlotImage(image: Promise<Blob>, filename: string): Promise<void> {
	const blob = await image;
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.download = filename;
	link.href = url;
	link.hidden = true;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function plotImageFilename(traceName: string): string {
	const baseName = traceName.trim() || 'cantraceviewer';
	return `${baseName}-current-view.png`;
}

function addExportBrand(cloned: Node): void {
	if (!(cloned instanceof HTMLElement)) return;

	const brand = cloned.ownerDocument.createElement('div');
	brand.textContent = EXPORT_BRAND;
	Object.assign(brand.style, {
		position: 'absolute',
		top: '6px',
		left: '50%',
		zIndex: '60',
		color: 'currentColor',
		fontFamily: 'Geist Variable, sans-serif',
		fontSize: '12px',
		fontWeight: '500',
		lineHeight: '1',
		opacity: '0.55',
		pointerEvents: 'none',
		transform: 'translateX(-50%)',
		whiteSpace: 'nowrap'
	});
	cloned.appendChild(brand);
}
