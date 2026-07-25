import { describe, expect, it } from 'vitest';
import {
	detectShortcutPlatform,
	groupedShortcuts,
	isEditableShortcutTarget,
	overridesBrowserShortcut,
	shortcutEnabled,
	shortcutFromEvent,
	shortcutKeys,
	shortcutSuppressedBySurface,
	SHORTCUTS,
	type ShortcutAction,
	type ShortcutPlatform
} from './keyboard-shortcuts.js';

function keyEvent(
	key: string,
	overrides: Partial<Parameters<typeof shortcutFromEvent>[0]> = {}
): Parameters<typeof shortcutFromEvent>[0] {
	return {
		key,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		defaultPrevented: false,
		...overrides
	};
}

describe('keyboard shortcuts', () => {
	it('matches primary shortcuts for the current platform only', () => {
		expect(shortcutFromEvent(keyEvent('o', { metaKey: true }), 'mac')).toBe('openTrace');
		expect(shortcutFromEvent(keyEvent('o', { ctrlKey: true }), 'other')).toBe('openTrace');
		expect(shortcutFromEvent(keyEvent('o', { ctrlKey: true }), 'mac')).toBeNull();
		expect(shortcutFromEvent(keyEvent('o', { metaKey: true }), 'other')).toBeNull();
	});

	it.each([
		['/', 'selectSignals'],
		[',', 'openSettings'],
		['k', 'showPalette'],
		['o', 'openTrace']
	] as const)('matches %s as %s only with the platform modifier', (key, action) => {
		expect(shortcutFromEvent(keyEvent(key, { metaKey: true }), 'mac')).toBe(action);
		expect(shortcutFromEvent(keyEvent(key, { ctrlKey: true }), 'other')).toBe(action);
		expect(shortcutFromEvent(keyEvent(key), 'mac')).toBeNull();
		expect(shortcutFromEvent(keyEvent(key), 'other')).toBeNull();
	});

	it.each([
		['+', 'zoomIn'],
		['-', 'zoomOut'],
		['0', 'resetZoom'],
		['b', 'toggleBoxZoom'],
		['L', 'toggleLegend'],
		['1', 'placeC1'],
		['2', 'placeC2'],
		['?', 'showHelp']
	] as const)('matches %s as %s', (key, action) => {
		expect(shortcutFromEvent(keyEvent(key), 'other')).toBe(action);
	});

	it('does not match modified single keys or repeated events', () => {
		expect(shortcutFromEvent(keyEvent('b', { metaKey: true }), 'mac')).toBeNull();
		expect(shortcutFromEvent(keyEvent('l', { repeat: true }), 'other')).toBeNull();
		expect(shortcutFromEvent(keyEvent('?', { defaultPrevented: true }), 'other')).toBeNull();
	});

	// ? is Shift+/ on most layouts, so it shares a keycap with the signal selector.
	it('separates ? from the signal selector on the same keycap', () => {
		expect(shortcutFromEvent(keyEvent('?', { shiftKey: true }), 'mac')).toBe('showHelp');
		expect(shortcutFromEvent(keyEvent('/', { metaKey: true }), 'mac')).toBe('selectSignals');
	});

	it.each(['input', 'textarea', 'select'])('suppresses shortcuts on %s targets', (tagName) => {
		const target = { tagName } as unknown as EventTarget;
		expect(isEditableShortcutTarget(target)).toBe(true);
		expect(shortcutSuppressedBySurface(target)).toBe(true);
	});

	it('allows shortcuts from non-editing input controls', () => {
		const checkbox = {
			tagName: 'input',
			getAttribute: (name: string) => (name === 'type' ? 'checkbox' : null)
		} as unknown as EventTarget;
		expect(isEditableShortcutTarget(checkbox)).toBe(false);
		expect(shortcutSuppressedBySurface(checkbox)).toBe(false);
	});

	it('suppresses editable descendants and menu surfaces while leaving side panels active', () => {
		const editable = {
			tagName: 'span',
			closest: (selector: string) => (selector.includes('contenteditable') ? {} : null)
		} as unknown as EventTarget;
		const popoverButton = {
			tagName: 'button',
			closest: (selector: string) => (selector.includes('popover-content') ? {} : null)
		} as unknown as EventTarget;
		const menuButton = {
			tagName: 'button',
			closest: (selector: string) => (selector.includes('role="menu"') ? {} : null)
		} as unknown as EventTarget;

		expect(isEditableShortcutTarget(editable)).toBe(true);
		expect(shortcutSuppressedBySurface(popoverButton)).toBe(false);
		expect(shortcutSuppressedBySurface(menuButton)).toBe(true);
	});

	// The walkthrough takes focus but sets aria-modal="false", and its first step asks you to
	// open a trace — so it must not swallow the shortcut that does exactly that.
	it('leaves shortcuts active under a non-modal surface', () => {
		const inWalkthrough = {
			tagName: 'button',
			closest: (selector: string) =>
				selector.includes('role="dialog"') ? { getAttribute: () => 'false' } : null
		} as unknown as EventTarget;
		const inModal = {
			tagName: 'button',
			closest: (selector: string) =>
				selector.includes('role="dialog"') ? { getAttribute: () => null } : null
		} as unknown as EventTarget;

		expect(shortcutSuppressedBySurface(inWalkthrough)).toBe(false);
		expect(shortcutSuppressedBySurface(inModal)).toBe(true);
	});

	// Whatever surface is focused, a chord the browser also binds has to stay recognisable so
	// the page can claim it — Cmd+O otherwise opens the browser's file dialog, which downloads
	// any trace it cannot render.
	it('marks browser-bound chords so they can be claimed when declined', () => {
		expect(shortcutFromEvent(keyEvent('o', { metaKey: true }), 'mac')).toBe('openTrace');
		expect(overridesBrowserShortcut('openTrace')).toBe(true);
		expect(overridesBrowserShortcut('showHelp')).toBe(false);
	});

	it('leaves disabled actions unchanged', () => {
		const disabled = {
			traceLoading: true,
			plotControlsDisabled: true,
			canResetZoom: false,
			canPlaceCrosshair: false
		};
		expect(shortcutEnabled('openTrace', disabled)).toBe(false);
		expect(shortcutEnabled('zoomIn', disabled)).toBe(false);
		expect(shortcutEnabled('resetZoom', disabled)).toBe(false);
		expect(shortcutEnabled('selectSignals', disabled)).toBe(true);
	});

	it('requires a plot pointer position for crosshair shortcuts', () => {
		const state = {
			traceLoading: false,
			plotControlsDisabled: false,
			canResetZoom: true,
			canPlaceCrosshair: false
		};
		expect(shortcutEnabled('placeC1', state)).toBe(false);
		expect(shortcutEnabled('placeC2', { ...state, canPlaceCrosshair: true })).toBe(true);
	});

	it.each<[string, ShortcutPlatform, string[]]>([
		['MacIntel', 'mac', ['⌘', 'O']],
		['Win32', 'other', ['Ctrl', 'O']]
	])('splits %s shortcuts into platform keys', (platformName, platform, expected) => {
		expect(detectShortcutPlatform(platformName)).toBe(platform);
		expect(shortcutKeys('openTrace', platform)).toEqual(expected);
	});

	it('renders unmodified shortcuts as a single key on every platform', () => {
		expect(shortcutKeys('showHelp', 'mac')).toEqual(['?']);
		expect(shortcutKeys('showHelp', 'other')).toEqual(['?']);
	});

	it('groups every registered shortcut exactly once for the help dialog', () => {
		const grouped = groupedShortcuts().flatMap((entry) => entry.actions);
		expect(grouped.toSorted()).toEqual((Object.keys(SHORTCUTS) as ShortcutAction[]).toSorted());
		expect(groupedShortcuts().map((entry) => entry.group)).toEqual([
			'Trace',
			'View',
			'Crosshairs',
			'App'
		]);
	});
});
