import { describe, expect, it } from 'vitest';
import {
	detectShortcutPlatform,
	isEditableShortcutTarget,
	shortcutEnabled,
	shortcutFromEvent,
	shortcutLabel,
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
		expect(shortcutFromEvent(keyEvent(',', { ctrlKey: true }), 'other')).toBe('openSettings');
		expect(shortcutFromEvent(keyEvent('o', { ctrlKey: true }), 'mac')).toBeNull();
		expect(shortcutFromEvent(keyEvent('o', { metaKey: true }), 'other')).toBeNull();
	});

	it.each([
		['/', 'selectSignals'],
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

	it('ignores editable descendants and transient surfaces', () => {
		const editable = {
			tagName: 'span',
			closest: (selector: string) => (selector.includes('contenteditable') ? {} : null)
		} as unknown as EventTarget;
		const popover = {
			tagName: 'button',
			closest: (selector: string) => (selector.includes('popover-content') ? {} : null)
		} as unknown as EventTarget;

		expect(isEditableShortcutTarget(editable)).toBe(true);
		expect(shortcutFromEvent(keyEvent('l', { target: popover }), 'other')).toBeNull();
	});

	it('leaves disabled actions unchanged', () => {
		const disabled = { traceLoading: true, plotControlsDisabled: true, canResetZoom: false };
		expect(shortcutEnabled('openTrace', disabled)).toBe(false);
		expect(shortcutEnabled('zoomIn', disabled)).toBe(false);
		expect(shortcutEnabled('resetZoom', disabled)).toBe(false);
		expect(shortcutEnabled('selectSignals', disabled)).toBe(true);
	});

	it.each<[string, ShortcutPlatform, string]>([
		['MacIntel', 'mac', 'Cmd+O'],
		['Win32', 'other', 'Ctrl+O']
	])('formats %s shortcuts for the platform', (platformName, platform, expected) => {
		expect(detectShortcutPlatform(platformName)).toBe(platform);
		expect(shortcutLabel('openTrace', platform)).toBe(expected);
	});
});
