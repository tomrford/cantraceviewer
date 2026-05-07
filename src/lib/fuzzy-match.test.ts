import { describe, expect, it } from 'vitest';
import { fuzzyIncludes } from './fuzzy-match';

describe('fuzzyIncludes', () => {
	it('matches compact abbreviations across message and signal separators', () => {
		expect(fuzzyIncludes('PowertrainStatus.VehicleSpeed', 'pts vs')).toBe(true);
		expect(fuzzyIncludes('PowertrainStatus.VehicleSpeed', 'pwrspd')).toBe(true);
		expect(fuzzyIncludes('PowertrainStatus.VehicleSpeed', 'vehicle speed')).toBe(true);
	});

	it('keeps query character order meaningful', () => {
		expect(fuzzyIncludes('PowertrainStatus.VehicleSpeed', 'deepv')).toBe(false);
		expect(fuzzyIncludes('PowertrainStatus.VehicleSpeed', 'xyz')).toBe(false);
	});
});
