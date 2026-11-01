export type ShortcutPlatform = 'mac' | 'other';

export type ShortcutAction =
	| 'openTrace'
	| 'selectSignals'
	| 'showPalette'
	| 'openSettings'
	| 'showHelp'
	| 'zoomIn'
	| 'zoomOut'
	| 'resetZoom'
	| 'toggleBoxZoom'
	| 'toggleLegend'
	| 'placeC1'
	| 'placeC2'
	| 'clearCrosshairs';

type ShortcutGroup = 'Trace' | 'View' | 'Crosshairs' | 'App';

type ShortcutDefinition = {
	key: string;
	label: string;
	group: ShortcutGroup;
	primary?: boolean;
};

type ShortcutEvent = Pick<
	KeyboardEvent,
	'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'defaultPrevented'
>;

export type ShortcutState = {
	traceLoading: boolean;
	plotControlsDisabled: boolean;
	canResetZoom: boolean;
	canPlaceCrosshair: boolean;
	hasCrosshairs: boolean;
};

const SHORTCUTS: Record<ShortcutAction, ShortcutDefinition> = {
	openTrace: { key: 'o', label: 'Open trace', group: 'Trace', primary: true },
	selectSignals: { key: '/', label: 'Signal selector', group: 'Trace', primary: true },
	zoomIn: { key: '+', label: 'Zoom in', group: 'View' },
	zoomOut: { key: '-', label: 'Zoom out', group: 'View' },
	resetZoom: { key: '0', label: 'Zoom to full extent', group: 'View' },
	toggleBoxZoom: { key: 'b', label: 'Box zoom or drag pan', group: 'View' },
	toggleLegend: { key: 'l', label: 'Show or hide legend', group: 'View' },
	placeC1: { key: '1', label: 'Place or centre C1', group: 'Crosshairs' },
	placeC2: { key: '2', label: 'Place or centre C2', group: 'Crosshairs' },
	clearCrosshairs: { key: 'c', label: 'Clear crosshairs', group: 'Crosshairs' },
	showPalette: { key: 'k', label: 'Command palette', group: 'App', primary: true },
	openSettings: { key: ',', label: 'Settings', group: 'App', primary: true },
	showHelp: { key: '?', label: 'Help and shortcuts', group: 'App' }
};

const GROUP_ORDER: ShortcutGroup[] = ['Trace', 'View', 'Crosshairs', 'App'];

export function groupedShortcuts(): { group: ShortcutGroup; actions: ShortcutAction[] }[] {
	const actions = Object.keys(SHORTCUTS) as ShortcutAction[];
	return GROUP_ORDER.map((group) => ({
		group,
		actions: actions.filter((action) => SHORTCUTS[action].group === group)
	}));
}

export function detectShortcutPlatform(platform: string): ShortcutPlatform {
	return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'mac' : 'other';
}

const PRIMARY_KEY_LABEL = { mac: '⌘', other: 'Ctrl' } satisfies Record<ShortcutPlatform, string>;

export function shortcutKeys(action: ShortcutAction, platform: ShortcutPlatform): string[] {
	const { key, primary } = SHORTCUTS[action];
	return primary ? [PRIMARY_KEY_LABEL[platform], key.toUpperCase()] : [key.toUpperCase()];
}

export function shortcutLabel(action: ShortcutAction): string {
	return SHORTCUTS[action].label;
}

export function overridesBrowserShortcut(action: ShortcutAction): boolean {
	return SHORTCUTS[action].primary === true;
}

const LETTER_KEY = /^[a-z]$/;

export function shortcutFromEvent(
	event: ShortcutEvent,
	platform: ShortcutPlatform
): ShortcutAction | null {
	if (event.defaultPrevented || event.repeat || event.altKey) return null;

	const key = event.key.toLowerCase();
	const primaryPressed =
		platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	for (const [action, shortcut] of Object.entries(SHORTCUTS) as [
		ShortcutAction,
		ShortcutDefinition
	][]) {
		if (shortcut.key !== key) continue;
		const modifiersMatch = shortcut.primary
			? primaryPressed && !(event.shiftKey && LETTER_KEY.test(key))
			: !event.metaKey && !event.ctrlKey;
		if (modifiersMatch) return action;
	}

	return null;
}

type ShortcutTarget = {
	readonly tagName?: string;
	readonly isContentEditable?: boolean;
	closest?: (selector: string) => ShortcutTarget | null;
	getAttribute?: (name: string) => string | null;
};

export function shortcutSuppressedBySurface(target: ShortcutTarget | null): boolean {
	const surface = target?.closest?.(TRANSIENT_SURFACE_SELECTOR) ?? null;
	// A closing popup keeps focus until its exit animation unmounts it; keys belong to the page.
	if (surface?.getAttribute?.('data-closed') != null) return false;
	const modal = surface !== null && surface.getAttribute?.('aria-modal') !== 'false';
	return isEditableShortcutTarget(target) || modal;
}

export function shortcutEnabled(action: ShortcutAction, state: ShortcutState): boolean {
	switch (action) {
		case 'openTrace':
			return !state.traceLoading;
		case 'zoomIn':
		case 'zoomOut':
		case 'toggleBoxZoom':
		case 'toggleLegend':
			return !state.plotControlsDisabled;
		case 'placeC1':
		case 'placeC2':
			return !state.plotControlsDisabled && state.canPlaceCrosshair;
		case 'clearCrosshairs':
			return !state.plotControlsDisabled && state.hasCrosshairs;
		case 'resetZoom':
			return !state.plotControlsDisabled && state.canResetZoom;
		case 'selectSignals':
		case 'showPalette':
		case 'openSettings':
		case 'showHelp':
			return true;
	}
}

export function isEditableShortcutTarget(target: ShortcutTarget | null): boolean {
	if (target === null) return false;
	const tagName = target.tagName?.toLowerCase();
	if (tagName === 'input') {
		const inputType = target.getAttribute?.('type')?.toLowerCase() ?? 'text';
		return !['button', 'checkbox', 'color', 'radio', 'range', 'reset', 'submit'].includes(
			inputType
		);
	}
	if (tagName === 'textarea' || tagName === 'select') return true;
	if (target.isContentEditable) return true;
	return target.closest?.('[contenteditable=""], [contenteditable="true"]') != null;
}

const TRANSIENT_SURFACE_SELECTOR =
	'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="context-menu-content"], [data-slot="context-menu-sub-content"], [data-slot="select-content"], [data-slot="alert-dialog-content"]';
