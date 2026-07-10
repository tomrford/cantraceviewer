import { describe, expect, it } from 'vitest';

import {
	adjacentWalkthroughStep,
	placeWalkthrough,
	shouldShowWalkthrough,
	type WalkthroughRect
} from './walkthrough.js';

const target: WalkthroughRect = {
	top: 20,
	right: 120,
	bottom: 60,
	left: 80,
	width: 40,
	height: 40
};

describe('walkthrough steps', () => {
	it('moves through the ordered walkthrough and stops at its bounds', () => {
		expect(adjacentWalkthroughStep('trace', -1)).toBeNull();
		expect(adjacentWalkthroughStep('trace', 1)?.id).toBe('library');
		expect(adjacentWalkthroughStep('library', 1)?.id).toBe('add-dbc');
		expect(adjacentWalkthroughStep('add-dbc', 1)?.id).toBe('signals');
		expect(adjacentWalkthroughStep('controls', 1)).toBeNull();
	});

	it('shows the current tour for missing, old or invalid versions', () => {
		expect(shouldShowWalkthrough(0)).toBe(true);
		expect(shouldShowWalkthrough('1')).toBe(true);
		expect(shouldShowWalkthrough(1)).toBe(false);
	});
});

describe('walkthrough placement', () => {
	it('aligns a bottom callout to the requested target edge', () => {
		expect(
			placeWalkthrough(
				target,
				{ width: 100, height: 80 },
				{ width: 500, height: 400 },
				'bottom-start'
			)
		).toEqual({
			top: 72,
			left: 80
		});
		expect(
			placeWalkthrough(
				target,
				{ width: 100, height: 80 },
				{ width: 500, height: 400 },
				'bottom-end'
			)
		).toEqual({
			top: 72,
			left: 20
		});
	});

	it('keeps a right-side callout inside the viewport', () => {
		const edgeTarget = { ...target, right: 492, left: 452 };

		expect(
			placeWalkthrough(
				edgeTarget,
				{ width: 180, height: 100 },
				{ width: 500, height: 400 },
				'right-start'
			)
		).toEqual({ top: 20, left: 260 });
	});
});
