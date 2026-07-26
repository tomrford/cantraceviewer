import { describe, expect, it } from 'vitest';
import { PLOT_THEME_TOKENS, resolvePlotTheme, toChartColor } from './plot-theme.js';

function styles(values: Record<string, string>) {
	return { getPropertyValue: (token: string) => values[token] ?? '' };
}

describe('toChartColor', () => {
	it('converts the greyscale tokens the stylesheet actually uses', () => {
		// Chroma 0 collapses to r = g = b = gamma(L³), so these are checkable by hand.
		expect(toChartColor('oklch(1 0 0)')).toBe('#ffffff');
		expect(toChartColor('oklch(0 0 0)')).toBe('#000000');
		expect(toChartColor('oklch(0.145 0 0)')).toBe('#0a0a0a');
	});

	it('keeps a token alpha, in the comma form ChartGPU can parse', () => {
		expect(toChartColor('oklch(1 0 0 / 10%)')).toBe('rgba(255, 255, 255, 0.1)');
		expect(toChartColor('oklch(1 0 0 / 0.5)')).toBe('rgba(255, 255, 255, 0.5)');
	});

	it('converts a chromatic token into sRGB gamut', () => {
		const color = toChartColor('oklch(0.696 0.17 162.48)');
		expect(color).toMatch(/^#[0-9a-f]{6}$/);
		const [, red, green, blue] = /^#(..)(..)(..)$/.exec(color!)!;
		// A green primary: the green channel dominates and red is the weakest.
		expect(Number.parseInt(green, 16)).toBeGreaterThan(Number.parseInt(blue, 16));
		expect(Number.parseInt(blue, 16)).toBeGreaterThan(Number.parseInt(red, 16));
	});

	it('passes through what ChartGPU already parses', () => {
		expect(toChartColor('#09090b')).toBe('#09090b');
		expect(toChartColor('rgba(255, 0, 0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
	});

	it('refuses colours it cannot convert rather than guessing', () => {
		// ChartGPU renders an unparseable colour as its own default, so returning
		// null lets the caller keep a fallback it chose.
		expect(toChartColor('color-mix(in oklab, red, blue)')).toBeNull();
		expect(toChartColor('rgb(255 0 0)')).toBeNull();
		expect(toChartColor('rebeccapurple')).toBeNull();
		expect(toChartColor('oklch(0.5 0)')).toBeNull();
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
		expect(theme.text).toBe(theme.axisTick);
		expect(theme.gridLine).toBe('rgba(255, 255, 255, 0.1)');
		expect(theme.fontFamily).toBe("'Geist Mono Variable', monospace");
	});

	it('falls back per role when a token is missing or unusable', () => {
		const theme = resolvePlotTheme(styles({ '--background': 'oklch(0.145 0 0)' }));

		expect(theme.background).toBe('#0a0a0a');
		expect(theme.text).toBe('#71717a');
		expect(theme.gridLine).toBe('#d4d4d8');
	});

	it('covers every role it declares a token for', () => {
		const theme = resolvePlotTheme(styles({}));
		expect(Object.keys(theme).sort()).toEqual(Object.keys(PLOT_THEME_TOKENS).sort());
	});
});
