import { PersistedState } from 'runed';
import { MediaQuery } from 'svelte/reactivity';

import type { LegendOrderMode } from '$lib/plot-signal-order.js';

export type ThemePreference = 'system' | 'light' | 'dark';
export type TimestampMode = 'relative' | 'absolute';
export type { LegendOrderMode };

export const themePreference = new PersistedState(
	'cantraceviewer:theme',
	'system' as ThemePreference
);

export const timestampMode = new PersistedState<TimestampMode>(
	'cantraceviewer:timestamp-mode',
	'relative',
	{ syncTabs: false }
);

export const legendOrderMode = new PersistedState<LegendOrderMode>(
	'cantraceviewer:legend-order',
	'selection',
	{ syncTabs: false }
);

const systemDark = new MediaQuery('prefers-color-scheme: dark');

export function isDark(): boolean {
	return (
		themePreference.current === 'dark' ||
		(themePreference.current === 'system' && systemDark.current)
	);
}

export function resetPreferences(): void {
	themePreference.current = 'system';
	timestampMode.current = 'relative';
	legendOrderMode.current = 'selection';
}
