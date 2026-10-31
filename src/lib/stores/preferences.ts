import { createStore } from 'zustand/vanilla';
import type { LegendOrderMode } from '#lib/plot-signal-order.js';

export type ThemePreference = 'system' | 'light' | 'dark';
export type TimestampMode = 'relative' | 'absolute';
export type { LegendOrderMode };

type PersistedPreferences = {
	theme: ThemePreference;
	timestampMode: TimestampMode;
	legendOrder: LegendOrderMode;
	walkthroughVersion: number;
};

export type PreferencesState = PersistedPreferences & { systemDark: boolean };

const DEFAULTS: PersistedPreferences = {
	theme: 'system',
	timestampMode: 'relative',
	legendOrder: 'selection',
	walkthroughVersion: 0
};

// Values are JSON-serialised under these keys; the theme key is also read by the inline
// script in index.html before first paint.
const STORAGE_KEYS: Record<keyof PersistedPreferences, string> = {
	theme: 'cantraceviewer:theme',
	timestampMode: 'cantraceviewer:timestamp-mode',
	legendOrder: 'cantraceviewer:legend-order',
	walkthroughVersion: 'cantraceviewer:walkthrough-version'
};

const ALLOWED: { [K in keyof PersistedPreferences]: (value: unknown) => boolean } = {
	theme: (value) => value === 'system' || value === 'light' || value === 'dark',
	timestampMode: (value) => value === 'relative' || value === 'absolute',
	legendOrder: (value) => value === 'selection' || value === 'alphabetical' || value === 'grouped',
	walkthroughVersion: (value) => typeof value === 'number' && Number.isFinite(value)
};

const PREFERENCE_NAMES = Object.keys(DEFAULTS) as (keyof PersistedPreferences)[];

/** Holds defaults until `connectPreferences()` runs after mount, so prerendered markup matches. */
export const preferences = createStore<PreferencesState>()(() => ({
	...DEFAULTS,
	systemDark: false
}));

export const isDark = (state: PreferencesState): boolean =>
	state.theme === 'dark' || (state.theme === 'system' && state.systemDark);

export function setPreference<K extends keyof PersistedPreferences>(
	name: K,
	value: PersistedPreferences[K]
): void {
	preferences.setState({ [name]: value } as Pick<PersistedPreferences, K>);
	try {
		localStorage.setItem(STORAGE_KEYS[name], JSON.stringify(value));
	} catch {
		// Storage can be unavailable (private mode, quota); keep the in-memory value.
	}
}

export function resetPreferences(): void {
	for (const name of PREFERENCE_NAMES) setPreference(name, DEFAULTS[name]);
}

/**
 * Loads stored preferences, follows the system colour scheme and theme changes from other tabs,
 * and keeps the `dark` class on <html> in sync. Call once after mount; returns a disconnect.
 */
export function connectPreferences(): () => void {
	const media = matchMedia('(prefers-color-scheme: dark)');
	const stored: Partial<PersistedPreferences> = {};
	for (const name of PREFERENCE_NAMES) {
		const value = readStored(name, localStorageItem(STORAGE_KEYS[name]));
		if (value !== undefined) Object.assign(stored, { [name]: value });
	}
	preferences.setState({ ...stored, systemDark: media.matches });

	const applyTheme = () =>
		document.documentElement.classList.toggle('dark', isDark(preferences.getState()));
	applyTheme();
	const unsubscribe = preferences.subscribe(applyTheme);

	const onSchemeChange = (event: MediaQueryListEvent) =>
		preferences.setState({ systemDark: event.matches });
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEYS.theme) return;
		const theme = readStored('theme', event.newValue);
		if (theme !== undefined) preferences.setState({ theme });
	};
	media.addEventListener('change', onSchemeChange);
	window.addEventListener('storage', onStorage);

	return () => {
		unsubscribe();
		media.removeEventListener('change', onSchemeChange);
		window.removeEventListener('storage', onStorage);
	};
}

function localStorageItem(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function readStored<K extends keyof PersistedPreferences>(
	name: K,
	raw: string | null
): PersistedPreferences[K] | undefined {
	if (raw === null) return undefined;
	try {
		const value: unknown = JSON.parse(raw);
		return ALLOWED[name](value) ? (value as PersistedPreferences[K]) : undefined;
	} catch {
		return undefined;
	}
}
