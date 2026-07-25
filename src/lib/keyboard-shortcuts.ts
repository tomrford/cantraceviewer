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
	| 'placeC2';

export type ShortcutGroup = 'Trace' | 'View' | 'Crosshairs' | 'App';

type ShortcutDefinition = {
	key: string;
	displayKey: string;
	label: string;
	group: ShortcutGroup;
	/** Chords the browser also binds, so we must claim them even when we decline to act. */
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
};

export const SHORTCUTS: Record<ShortcutAction, ShortcutDefinition> = {
	openTrace: { key: 'o', displayKey: 'O', label: 'Open trace', group: 'Trace', primary: true },
	selectSignals: {
		key: '/',
		displayKey: '/',
		label: 'Signal selector',
		group: 'Trace',
		primary: true
	},
	zoomIn: { key: '+', displayKey: '+', label: 'Zoom in', group: 'View' },
	zoomOut: { key: '-', displayKey: '-', label: 'Zoom out', group: 'View' },
	resetZoom: { key: '0', displayKey: '0', label: 'Zoom to full extent', group: 'View' },
	toggleBoxZoom: { key: 'b', displayKey: 'B', label: 'Box zoom or drag pan', group: 'View' },
	toggleLegend: { key: 'l', displayKey: 'L', label: 'Show or hide legend', group: 'View' },
	placeC1: { key: '1', displayKey: '1', label: 'Place or centre C1', group: 'Crosshairs' },
	placeC2: { key: '2', displayKey: '2', label: 'Place or centre C2', group: 'Crosshairs' },
	showPalette: {
		key: 'k',
		displayKey: 'K',
		label: 'Command palette',
		group: 'App',
		primary: true
	},
	openSettings: { key: ',', displayKey: ',', label: 'Settings', group: 'App', primary: true },
	showHelp: { key: '?', displayKey: '?', label: 'Help and shortcuts', group: 'App' }
};

const GROUP_ORDER: ShortcutGroup[] = ['Trace', 'View', 'Crosshairs', 'App'];

/** The registry as the help dialog renders it: groups in a fixed order, each with its actions. */
export function groupedShortcuts(): { group: ShortcutGroup; actions: ShortcutAction[] }[] {
	const actions = Object.keys(SHORTCUTS) as ShortcutAction[];
	return GROUP_ORDER.map((group) => ({
		group,
		actions: actions.filter((action) => SHORTCUTS[action].group === group)
	})).filter((entry) => entry.actions.length > 0);
}

export function detectShortcutPlatform(
	platform = typeof navigator === 'undefined' ? '' : `${navigator.platform} ${navigator.userAgent}`
): ShortcutPlatform {
	return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'mac' : 'other';
}

const PRIMARY_KEY_LABEL: Record<ShortcutPlatform, string> = { mac: '⌘', other: 'Ctrl' };

/** Keys of a shortcut as separate chips, in press order, using the platform's modifier glyph. */
export function shortcutKeys(action: ShortcutAction, platform: ShortcutPlatform): string[] {
	const shortcut = SHORTCUTS[action];
	return shortcut.primary
		? [PRIMARY_KEY_LABEL[platform], shortcut.displayKey]
		: [shortcut.displayKey];
}

export function shortcutLabel(action: ShortcutAction): string {
	return SHORTCUTS[action].label;
}

/**
 * Whether the browser binds this chord too. Cmd+O opens the browser's own file dialog, which
 * downloads any file it cannot render, so we claim the key even when we decline to act on it.
 */
export function overridesBrowserShortcut(action: ShortcutAction): boolean {
	return SHORTCUTS[action].primary === true;
}

const LETTER_KEY = /^[a-z]$/;

export function shortcutFromEvent(
	event: ShortcutEvent,
	platform: ShortcutPlatform
): ShortcutAction | null {
	if (event.defaultPrevented || event.repeat) return null;

	for (const [action, shortcut] of Object.entries(SHORTCUTS) as [
		ShortcutAction,
		ShortcutDefinition
	][]) {
		if (shortcut.primary) {
			const primaryPressed =
				platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
			if (!primaryPressed || event.altKey) continue;

			// Shift is only disqualifying for letters, where Cmd+Shift+K is a different chord to
			// Cmd+K. Symbols may need Shift to exist at all — / is Shift+7 on QWERTZ — and
			// event.key already reports the character the layout produced, so matching on it
			// keeps Cmd+/ working everywhere without caring which physical keys got us there.
			if (event.shiftKey && LETTER_KEY.test(shortcut.key)) continue;
			if (event.key.toLowerCase() === shortcut.key) return action;
			continue;
		}

		if (event.metaKey || event.ctrlKey || event.altKey) continue;
		if (event.key === shortcut.key || event.key.toLowerCase() === shortcut.key) return action;
	}

	return null;
}

/** Text fields and transient surfaces own their own keys, so we stay out of their way. */
export function shortcutSuppressedBySurface(target: EventTarget | null): boolean {
	return isEditableShortcutTarget(target) || isTransientSurfaceTarget(target);
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
	if (tagName === 'input') {
		const inputType = element.getAttribute?.('type')?.toLowerCase() ?? 'text';
		return !['button', 'checkbox', 'color', 'radio', 'range', 'reset', 'submit'].includes(
			inputType
		);
	}
	if (tagName === 'textarea' || tagName === 'select') return true;
	if (element.isContentEditable) return true;
	return element.closest?.('[contenteditable=""], [contenteditable="true"]') != null;
}

const TRANSIENT_SURFACE_SELECTOR =
	'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="context-menu-content"], [data-slot="context-menu-sub-content"], [data-slot="select-content"], [data-slot="alert-dialog-content"]';

function isTransientSurfaceTarget(target: EventTarget | null): boolean {
	const element = shortcutTargetElement(target);
	const surface = element?.closest?.(TRANSIENT_SURFACE_SELECTOR);
	if (!surface) return false;

	// The walkthrough is a coach mark: it takes focus to be announced, but declares
	// aria-modal="false" because it does not own the keyboard. Shortcuts must keep working
	// while it is open — it spends its first step asking you to open a trace.
	return shortcutTargetElement(surface as EventTarget)?.getAttribute?.('aria-modal') !== 'false';
}

function shortcutTargetElement(target: EventTarget | null): {
	tagName?: string;
	isContentEditable?: boolean;
	closest?: (selector: string) => unknown;
	getAttribute?: (name: string) => string | null;
} | null {
	if (target === null || typeof target !== 'object') return null;
	return target as {
		tagName?: string;
		isContentEditable?: boolean;
		closest?: (selector: string) => unknown;
		getAttribute?: (name: string) => string | null;
	};
}
