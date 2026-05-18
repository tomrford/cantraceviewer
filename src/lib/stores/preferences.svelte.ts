import { PersistedState } from 'runed';

export type ThemePreference = 'system' | 'light' | 'dark';
export type TimestampMode = 'relative' | 'absolute';

export const themePreference = new PersistedState(
	'cantraceviewer:theme',
	'system' as ThemePreference
);

export const timestampMode = new PersistedState(
	'cantraceviewer:timestamp-mode',
	'relative' as TimestampMode,
	{ syncTabs: false }
);

export const sidebarOpen = new PersistedState('cantraceviewer:sidebar-open', true, {
	syncTabs: false
});

export const themeState = $state({ isDark: false });

export function applyTheme(preference = themePreference.current): void {
	if (typeof document === 'undefined' || typeof window === 'undefined') return;

	const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
	themeState.isDark = preference === 'dark' || (preference === 'system' && prefersDark);
	document.documentElement.classList.toggle('dark', themeState.isDark);
}
