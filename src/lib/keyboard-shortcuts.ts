export type ShortcutPlatform = 'mac' | 'other';

export type ShortcutAction =
	| 'openTrace'
	| 'selectSignals'
	| 'openSettings'
	| 'zoomIn'
	| 'zoomOut'
	| 'resetZoom'
	| 'toggleBoxZoom'
	| 'toggleLegend'
	| 'placeC1'
	| 'placeC2'
	| 'cancel';

type ShortcutDefinition = {
	key: string;
	displayKey: string;
	primary?: boolean;
};

type ShortcutEvent = Pick<
	KeyboardEvent,
	'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'defaultPrevented'
> & { target: EventTarget | null };

export type ShortcutState = {
	traceLoading: boolean;
	plotControlsDisabled: boolean;
	canResetZoom: boolean;
};

export const SHORTCUTS: Record<ShortcutAction, ShortcutDefinition> = {
	openTrace: { key: 'o', displayKey: 'O', primary: true },
	selectSignals: { key: '/', displayKey: '/' },
	openSettings: { key: ',', displayKey: ',', primary: true },
	zoomIn: { key: '+', displayKey: '+' },
	zoomOut: { key: '-', displayKey: '-' },
	resetZoom: { key: '0', displayKey: '0' },
	toggleBoxZoom: { key: 'b', displayKey: 'B' },
	toggleLegend: { key: 'l', displayKey: 'L' },
	placeC1: { key: '1', displayKey: '1' },
	placeC2: { key: '2', displayKey: '2' },
	cancel: { key: 'Escape', displayKey: 'Esc' }
};

export function detectShortcutPlatform(
	platform = typeof navigator === 'undefined' ? '' : `${navigator.platform} ${navigator.userAgent}`
): ShortcutPlatform {
	return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'mac' : 'other';
}

export function shortcutLabel(action: ShortcutAction, platform: ShortcutPlatform): string {
	const shortcut = SHORTCUTS[action];
	return `${shortcut.primary ? (platform === 'mac' ? 'Cmd+' : 'Ctrl+') : ''}${shortcut.displayKey}`;
}

export function shortcutTitle(
	label: string,
	action: ShortcutAction,
	platform: ShortcutPlatform
): string {
	return `${label} (${shortcutLabel(action, platform)})`;
}

export function shortcutFromEvent(
	event: ShortcutEvent,
	platform: ShortcutPlatform
): ShortcutAction | null {
	if (
		event.defaultPrevented ||
		event.repeat ||
		isEditableShortcutTarget(event.target) ||
		isTransientSurfaceTarget(event.target)
	) {
		return null;
	}

	for (const [action, shortcut] of Object.entries(SHORTCUTS) as [
		ShortcutAction,
		ShortcutDefinition
	][]) {
		if (shortcut.primary) {
			const primaryPressed =
				platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
			if (
				primaryPressed &&
				!event.altKey &&
				!event.shiftKey &&
				event.key.toLowerCase() === shortcut.key
			) {
				return action;
			}
			continue;
		}

		if (event.metaKey || event.ctrlKey || event.altKey) continue;
		if (event.key === shortcut.key || event.key.toLowerCase() === shortcut.key) return action;
	}

	return null;
}

export function shortcutEnabled(action: ShortcutAction, state: ShortcutState): boolean {
	switch (action) {
		case 'openTrace':
			return !state.traceLoading;
		case 'zoomIn':
		case 'zoomOut':
		case 'toggleBoxZoom':
		case 'toggleLegend':
		case 'placeC1':
		case 'placeC2':
			return !state.plotControlsDisabled;
		case 'resetZoom':
			return !state.plotControlsDisabled && state.canResetZoom;
		default:
			return true;
	}
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
	const element = shortcutTargetElement(target);
	if (element === null) return false;
	const tagName = element.tagName?.toLowerCase();
	if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
	if (element.isContentEditable) return true;
	return element.closest?.('[contenteditable=""], [contenteditable="true"]') != null;
}

function isTransientSurfaceTarget(target: EventTarget | null): boolean {
	const element = shortcutTargetElement(target);
	return Boolean(
		element?.closest?.(
			'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"], [data-slot="context-menu-content"], [data-slot="context-menu-sub-content"], [data-slot="select-content"], [data-slot="alert-dialog-content"]'
		)
	);
}

function shortcutTargetElement(target: EventTarget | null): {
	tagName?: string;
	isContentEditable?: boolean;
	closest?: (selector: string) => unknown;
} | null {
	if (target === null || typeof target !== 'object') return null;
	return target as {
		tagName?: string;
		isContentEditable?: boolean;
		closest?: (selector: string) => unknown;
	};
}
