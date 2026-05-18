export type ThemePreference = 'system' | 'light' | 'dark';
export type TimestampMode = 'relative' | 'absolute';

const THEME_KEY = 'cantraceviewer:theme';
const TIMESTAMP_MODE_KEY = 'cantraceviewer:timestamp-mode';
const SIDEBAR_OPEN_KEY = 'cantraceviewer:sidebar-open';

class SettingsStore {
	theme = $state<ThemePreference>('system');
	timestampMode = $state<TimestampMode>('relative');
	sidebarOpen = $state(true);
	isDark = $state(false);

	load(): void {
		if (typeof localStorage === 'undefined') return;

		this.theme = parseTheme(localStorage.getItem(THEME_KEY));
		this.timestampMode = parseTimestampMode(localStorage.getItem(TIMESTAMP_MODE_KEY));
		this.sidebarOpen = parseSidebarOpen(localStorage.getItem(SIDEBAR_OPEN_KEY));
		this.applyTheme();
	}

	setTheme(theme: ThemePreference): void {
		this.theme = theme;
		if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, theme);
		this.applyTheme();
	}

	setTimestampMode(mode: TimestampMode): void {
		this.timestampMode = mode;
		if (typeof localStorage !== 'undefined') localStorage.setItem(TIMESTAMP_MODE_KEY, mode);
	}

	setSidebarOpen(open: boolean): void {
		this.sidebarOpen = open;
		if (typeof localStorage !== 'undefined') localStorage.setItem(SIDEBAR_OPEN_KEY, String(open));
	}

	applyTheme(): void {
		if (typeof document === 'undefined' || typeof window === 'undefined') return;

		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		this.isDark = this.theme === 'dark' || (this.theme === 'system' && prefersDark);
		document.documentElement.classList.toggle('dark', this.isDark);
	}
}

function parseTheme(value: string | null): ThemePreference {
	return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function parseTimestampMode(value: string | null): TimestampMode {
	return value === 'absolute' ? 'absolute' : 'relative';
}

function parseSidebarOpen(value: string | null): boolean {
	return value === null ? true : value === 'true';
}

export const settings = new SettingsStore();
