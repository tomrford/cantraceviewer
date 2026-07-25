import { describe, expect, it } from 'vitest';
import {
	detectShortcutPlatform,
	isEditableShortcutTarget,
	shortcutEnabled,
	shortcutFromEvent,
	shortcutKeys,
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
		target: null,
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
		['+', 'zoomIn'],
		['-', 'zoomOut'],
		['0', 'resetZoom'],
		['b', 'toggleBoxZoom'],
		['L', 'toggleLegend'],
		['1', 'placeC1'],
		['2', 'placeC2'],
		['Escape', 'cancel']
	] as const)('matches %s as %s', (key, action) => {
		expect(shortcutFromEvent(keyEvent(key), 'other')).toBe(action);
	});

	it('does not match modified single keys or repeated events', () => {
		expect(shortcutFromEvent(keyEvent('b', { metaKey: true }), 'mac')).toBeNull();
		expect(shortcutFromEvent(keyEvent('l', { repeat: true }), 'other')).toBeNull();
		expect(shortcutFromEvent(keyEvent('/', { defaultPrevented: true }), 'other')).toBeNull();
	});

	it.each(['input', 'textarea', 'select'])('ignores %s targets', (tagName) => {
		const target = { tagName } as unknown as EventTarget;
		expect(isEditableShortcutTarget(target)).toBe(true);
		expect(shortcutFromEvent(keyEvent('b', { target }), 'other')).toBeNull();
	});

	it('allows shortcuts from non-editing input controls', () => {
		const checkbox = {
			tagName: 'input',
			getAttribute: (name: string) => (name === 'type' ? 'checkbox' : null)
		} as unknown as EventTarget;
		expect(isEditableShortcutTarget(checkbox)).toBe(false);
		expect(shortcutFromEvent(keyEvent('b', { target: checkbox }), 'other')).toBe('toggleBoxZoom');
	});

	it('ignores editable descendants and menu surfaces while leaving side panels active', () => {
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
		expect(shortcutFromEvent(keyEvent('l', { target: popoverButton }), 'other')).toBe(
			'toggleLegend'
		);
		expect(shortcutFromEvent(keyEvent('l', { target: menuButton }), 'other')).toBeNull();
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
		expect(shortcutKeys('openSettings', 'mac')).toEqual([',']);
		expect(shortcutKeys('openSettings', 'other')).toEqual([',']);
	});
});
