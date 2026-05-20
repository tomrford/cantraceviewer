import { PersistedState } from 'runed';

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

export const traceLineWidth = new PersistedState('cantraceviewer:trace-line-width', 2, {
	syncTabs: false
});

export const sidebarOpen = new PersistedState('cantraceviewer:sidebar-open', true, {
	syncTabs: false
});

export const themeState = $state({ isDark: false });

export function resetPreferences(): void {
	themePreference.current = 'system';
	timestampMode.current = 'relative';
	traceLineWidth.current = 2;
	sidebarOpen.current = true;
}

export function applyTheme(preference = themePreference.current): void {
	if (typeof document === 'undefined' || typeof window === 'undefined') return;

	const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
	themeState.isDark = preference === 'dark' || (preference === 'system' && prefersDark);
	document.documentElement.classList.toggle('dark', themeState.isDark);
}
