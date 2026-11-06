import { describe, expect, it } from 'vitest';

import { adjacentWalkthroughStep, shouldShowWalkthrough } from '@/lib/walkthrough';

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
