import { useEffect, useEffectEvent } from 'react';

import {
	browserShortcutPlatform,
	overridesBrowserShortcut,
	shortcutEnabled,
	shortcutFromEvent,
	shortcutSuppressedBySurface,
	type ShortcutAction,
	type ShortcutState
} from '@/lib/keyboard-shortcuts';
import { openHelp, openPalette, openSettings, openSignalSelector } from '@/stores/app-shell';
import {
	clearCrosshairs,
	placeCrosshair,
	resetZoom,
	toggleBoxZoom,
	toggleLegend,
	zoomIn,
	zoomOut
} from '@/stores/plot-view';

/** Binds the global keyboard shortcuts and returns the runner the command palette shares. */
export function useAppShortcuts(
	state: ShortcutState,
	{ openTrace, focusSignalSearch }: { openTrace: () => void; focusSignalSearch: () => void }
): (action: ShortcutAction) => void {
	const runners: Record<ShortcutAction, () => void> = {
		openTrace,
		selectSignals: () => {
			openSignalSelector();
			// Refocuses search if the panel is already open; `initialFocus` covers opening it.
			focusSignalSearch();
		},
		showPalette: openPalette,
		openSettings,
		showHelp: openHelp,
		zoomIn,
		zoomOut,
		resetZoom,
		toggleBoxZoom,
		toggleLegend,
		placeC1: () => placeCrosshair(1),
		placeC2: () => placeCrosshair(2),
		clearCrosshairs
	};

	function run(action: ShortcutAction): void {
		runners[action]();
	}

	const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
		const action = shortcutFromEvent(event, browserShortcutPlatform());
		if (action === null) return;

		if (overridesBrowserShortcut(action)) event.preventDefault();

		if (shortcutSuppressedBySurface(event.target instanceof Element ? event.target : null)) return;
		if (!shortcutEnabled(action, state)) return;

		run(action);
		event.preventDefault();
	});

	useEffect(() => {
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	return run;
}
