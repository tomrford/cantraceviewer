import {
	appStore,
	DEFAULT_PREFERENCES,
	update,
	type AppState,
	type PersistedPreferences
} from '@/store/store';

// Values are JSON-serialised under these keys; the theme key is also read by the inline
// script in index.html before first paint.
const STORAGE_KEYS: Record<keyof PersistedPreferences, string> = {
	theme: 'cantraceviewer:theme',
	timestampMode: 'cantraceviewer:timestamp-mode',
	legendOrder: 'cantraceviewer:legend-order',
	walkthroughVersion: 'cantraceviewer:walkthrough-version'
};

const ALLOWED: {
	[K in keyof PersistedPreferences]: (value: unknown) => value is PersistedPreferences[K];
} = {
	theme: (value) => value === 'system' || value === 'light' || value === 'dark',
	timestampMode: (value) => value === 'relative' || value === 'absolute',
	legendOrder: (value) => value === 'selection' || value === 'alphabetical' || value === 'grouped',
	walkthroughVersion: (value): value is number =>
		typeof value === 'number' && Number.isFinite(value)
};

const PREFERENCE_NAMES = Object.keys(DEFAULT_PREFERENCES) as (keyof PersistedPreferences)[];

export const isDark = (s: Pick<AppState, 'theme' | 'systemDark'>): boolean =>
	s.theme === 'dark' || (s.theme === 'system' && s.systemDark);

export function setPreference<K extends keyof PersistedPreferences>(
	name: K,
	value: PersistedPreferences[K]
): void {
	update({ [name]: value });
	try {
		localStorage.setItem(STORAGE_KEYS[name], JSON.stringify(value));
	} catch {
		// Storage can be unavailable (private mode, quota); keep the in-memory value.
	}
}

export function resetPreferences(): void {
	for (const name of PREFERENCE_NAMES) setPreference(name, DEFAULT_PREFERENCES[name]);
}

/**
 * Loads stored preferences, follows the system colour scheme and theme changes from other tabs,
 * and keeps the `dark` class on <html> in sync. Call once at startup.
 */
export function connectPreferences(): void {
	const media = matchMedia('(prefers-color-scheme: dark)');
	const stored: Partial<PersistedPreferences> = {};
	for (const name of PREFERENCE_NAMES) {
		const value = readStored(name, localStorageItem(STORAGE_KEYS[name]));
		if (value !== undefined) Object.assign(stored, { [name]: value });
	}
	update({ ...stored, systemDark: media.matches });

	const applyTheme = () =>
		document.documentElement.classList.toggle('dark', isDark(appStore.getState()));
	applyTheme();
	appStore.subscribe((state, previous) => {
		if (isDark(state) !== isDark(previous)) applyTheme();
	});

	media.addEventListener('change', (event) => update({ systemDark: event.matches }));
	window.addEventListener('storage', (event) => {
		if (event.key !== STORAGE_KEYS.theme) return;
		const theme = readStored('theme', event.newValue);
		if (theme !== undefined) update({ theme });
	});
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
		return ALLOWED[name](value) ? value : undefined;
	} catch {
		return undefined;
	}
}
