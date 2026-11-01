import { useEffect, useEffectEvent } from 'react';
import {
	browserShortcutPlatform,
	overridesBrowserShortcut,
	shortcutEnabled,
	shortcutFromEvent,
	shortcutSuppressedBySurface,
	type ShortcutAction,
	type ShortcutState
} from '#lib/keyboard-shortcuts.js';
import { openHelp, setSignalSelectorOpen } from '#lib/stores/app-shell.js';
import {
	clearCrosshairs,
	placeCrosshair,
	resetZoom,
	toggleBoxZoom,
	toggleLegend,
	zoomBy
} from '#lib/stores/plot-view.js';
import { update } from '#lib/stores/store.js';

/** Binds the global keyboard shortcuts and returns the runner the command palette shares. */
export function useAppShortcuts(
	state: ShortcutState,
	{ openTrace, focusSignalSearch }: { openTrace: () => void; focusSignalSearch: () => void }
): (action: ShortcutAction) => void {
	const runners: Record<ShortcutAction, () => void> = {
		openTrace,
		selectSignals: () => {
			update({ settingsOpen: false });
			setSignalSelectorOpen(true);
			// Refocuses search if the panel is already open; `initialFocus` covers opening it.
			focusSignalSearch();
		},
		showPalette: () => {
			update({ settingsOpen: false });
			setSignalSelectorOpen(false);
			update({ paletteOpen: true });
		},
		openSettings: () => {
			setSignalSelectorOpen(false);
			update({ settingsOpen: true });
		},
		showHelp: openHelp,
		zoomIn: () => zoomBy(0.5),
		zoomOut: () => zoomBy(2),
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
