import { PersistedState } from 'runed';
import { MediaQuery } from 'svelte/reactivity';

export type ThemePreference = 'system' | 'light' | 'dark';
export type TimestampMode = 'relative' | 'absolute';

export const themePreference = new PersistedState(
	'cantraceviewer:theme',
	'system' as ThemePreference
);

export const timestampMode = new PersistedState<TimestampMode>(
	'cantraceviewer:timestamp-mode',
	'relative',
	{ syncTabs: false }
);

export const sidebarOpen = new PersistedState('cantraceviewer:sidebar-open', true, {
	syncTabs: false
});

const systemDark = new MediaQuery('(prefers-color-scheme: dark)');

export function isDark(): boolean {
	return (
		themePreference.current === 'dark' ||
		(themePreference.current === 'system' && systemDark.current)
	);
}

export function resetPreferences(): void {
	themePreference.current = 'system';
	timestampMode.current = 'relative';
	sidebarOpen.current = true;
}
