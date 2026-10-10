import { describe, expect, it } from 'vitest';
import {
	detectShortcutPlatform,
	isEditableShortcutTarget,
	overridesBrowserShortcut,
	shortcutEnabled,
	shortcutFromEvent,
	shortcutKeys,
	shortcutSuppressedBySurface,
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

	it('separates ? from the signal selector on the same keycap', () => {
		expect(shortcutFromEvent(keyEvent('?', { shiftKey: true }), 'mac')).toBe('showHelp');
		expect(shortcutFromEvent(keyEvent('/', { metaKey: true }), 'mac')).toBe('selectSignals');
	});

	it('accepts symbol chords that a layout can only produce with Shift', () => {
		expect(shortcutFromEvent(keyEvent('/', { metaKey: true, shiftKey: true }), 'mac')).toBe(
			'selectSignals'
		);
		expect(shortcutFromEvent(keyEvent(',', { ctrlKey: true, shiftKey: true }), 'other')).toBe(
			'openSettings'
		);
	});

	it('keeps Shift disqualifying for letter chords', () => {
		expect(shortcutFromEvent(keyEvent('k', { metaKey: true, shiftKey: true }), 'mac')).toBeNull();
		expect(shortcutFromEvent(keyEvent('o', { metaKey: true, shiftKey: true }), 'mac')).toBeNull();
	});

	it.each(['input', 'textarea', 'select'])('suppresses shortcuts on %s targets', (tagName) => {
		const target = { tagName };
		expect(isEditableShortcutTarget(target)).toBe(true);
		expect(shortcutSuppressedBySurface(target)).toBe(true);
	});

	it('allows shortcuts from non-editing input controls', () => {
		const checkbox = {
			tagName: 'input',
			getAttribute: (name: string) => (name === 'type' ? 'checkbox' : null)
		};
		expect(isEditableShortcutTarget(checkbox)).toBe(false);
		expect(shortcutSuppressedBySurface(checkbox)).toBe(false);
	});

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
			canPlaceCrosshair: false,
			hasCrosshairs: false
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
			canPlaceCrosshair: false,
			hasCrosshairs: false
		};
		expect(shortcutEnabled('placeC1', state)).toBe(false);
		expect(shortcutEnabled('placeC2', { ...state, canPlaceCrosshair: true })).toBe(true);
	});

	it('enables clearing crosshairs only once one is placed', () => {
		const state = {
			traceLoading: false,
			plotControlsDisabled: false,
			canResetZoom: true,
			canPlaceCrosshair: true,
			hasCrosshairs: false
		};
		expect(shortcutEnabled('clearCrosshairs', state)).toBe(false);
		expect(shortcutEnabled('clearCrosshairs', { ...state, hasCrosshairs: true })).toBe(true);
		expect(
			shortcutEnabled('clearCrosshairs', {
				...state,
				hasCrosshairs: true,
				plotControlsDisabled: true
			})
		).toBe(false);
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
});
