import { describe, expect, it } from 'vitest';

import { resolvePlotTheme } from '@/lib/plot/plot-theme';

function styles(values: Record<string, string>) {
	return { getPropertyValue: (token: string) => values[token] ?? '' };
}

/** The colour ChartGPU receives for a stylesheet token value. */
function chartColor(value: string) {
	return resolvePlotTheme(styles({ '--background': value })).background;
}
const DEFAULT_BACKGROUND = resolvePlotTheme(styles({})).background;

describe('stylesheet colours for ChartGPU', () => {
	it('converts the greyscale tokens the stylesheet actually uses', () => {
		expect(chartColor('oklch(1 0 0)')).toBe('#ffffff');
		expect(chartColor('oklch(0 0 0)')).toBe('#000000');
		expect(chartColor('oklch(0.145 0 0)')).toBe('#0a0a0a');
	});

	it('keeps a token alpha, in the comma form ChartGPU can parse', () => {
		expect(chartColor('oklch(1 0 0 / 10%)')).toBe('rgba(255, 255, 255, 0.1)');
		expect(chartColor('oklch(1 0 0 / 0.5)')).toBe('rgba(255, 255, 255, 0.5)');
	});

	it('converts a chromatic token into sRGB gamut', () => {
		const color = chartColor('oklch(0.696 0.17 162.48)');
		expect(color).toMatch(/^#[0-9a-f]{6}$/);
		const [, red, green, blue] = /^#(..)(..)(..)$/.exec(color)!;
		expect(Number.parseInt(green, 16)).toBeGreaterThan(Number.parseInt(blue, 16));
		expect(Number.parseInt(blue, 16)).toBeGreaterThan(Number.parseInt(red, 16));
	});

	it('passes through what ChartGPU already parses', () => {
		expect(chartColor('#09090b')).toBe('#09090b');
		expect(chartColor('rgba(255, 0, 0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
	});

	it('keeps the default for colours it cannot convert rather than guessing', () => {
		for (const value of [
			'color-mix(in oklab, red, blue)',
			'rgb(255 0 0)',
			'rebeccapurple',
			'oklch(0.5 0)'
		]) {
			expect(chartColor(value)).toBe(DEFAULT_BACKGROUND);
		}
	});
});

describe('resolvePlotTheme', () => {
	it('reads each role from its token', () => {
		const theme = resolvePlotTheme(
			styles({
				'--background': 'oklch(1 0 0)',
				'--muted-foreground': 'oklch(0.556 0 0)',
				'--border': 'oklch(1 0 0 / 10%)',
				'--font-mono': "'Geist Mono Variable', monospace"
			})
		);

		expect(theme.background).toBe('#ffffff');
		expect(theme.gridLine).toBe('rgba(255, 255, 255, 0.1)');
		expect(theme.fontFamily).toBe("'Geist Mono Variable', monospace");
	});

	it('falls back per role when a token is missing or unusable', () => {
		const theme = resolvePlotTheme(styles({ '--background': 'oklch(0.145 0 0)' }));

		expect(theme.background).toBe('#0a0a0a');
		const untouched = resolvePlotTheme(styles({}));
		expect(theme.text).toBe(untouched.text);
		expect(theme.gridLine).toBe(untouched.gridLine);
		expect(theme.background).not.toBe(untouched.background);
	});
});
