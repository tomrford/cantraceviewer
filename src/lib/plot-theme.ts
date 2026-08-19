/**
 * Chart chrome resolved from the app's theme tokens.
 *
 * ChartGPU needs literal colour strings: its GPU-side parser accepts `#hex` and
 * comma-separated `rgb()`/`rgba()` and silently falls back on anything else, so
 * the `oklch()` custom properties cannot be handed to it as they are. Reading
 * the tokens and converting here keeps one source of truth for the plot's
 * colours — the same tokens Tailwind classes resolve to — instead of a second
 * set of hex literals that drifts from the stylesheet.
 */

/** Chart chrome roles mapped to the custom properties they take their value from. */
export const PLOT_THEME_TOKENS = {
	background: '--background',
	// Axis labels and ticks are chrome, not content, so they take the muted
	// foreground both axes' labels are already styled with.
	text: '--muted-foreground',
	axisLine: '--border',
	axisTick: '--muted-foreground',
	gridLine: '--border',
	fontFamily: '--font-mono'
} as const;

export type PlotThemeRole = keyof typeof PLOT_THEME_TOKENS;
export type PlotTheme = { [Role in PlotThemeRole]: string };

/** Fallbacks for a document that has not applied the stylesheet yet. */
export const FALLBACK_PLOT_THEME = {
	background: '#ffffff',
	text: '#71717a',
	axisLine: '#d4d4d8',
	axisTick: '#71717a',
	gridLine: '#d4d4d8',
	fontFamily: 'monospace'
} satisfies PlotTheme;

export function resolvePlotTheme(styles: Pick<CSSStyleDeclaration, 'getPropertyValue'>): PlotTheme {
	const theme = { ...FALLBACK_PLOT_THEME };
	for (const [role, token] of Object.entries(PLOT_THEME_TOKENS) as [PlotThemeRole, string][]) {
		const raw = styles.getPropertyValue(token).trim();
		if (raw.length === 0) continue;
		if (role === 'fontFamily') {
			theme[role] = raw;
			continue;
		}
		const color = toChartColor(raw);
		if (color !== null) theme[role] = color;
	}
	return theme;
}

/**
 * Narrows a CSS colour to what ChartGPU can parse. Hex and legacy `rgb()` pass
 * through; `oklch()` is converted; anything else is refused so the caller keeps
 * its fallback rather than handing over a string that silently renders black.
 */
export function toChartColor(value: string): string | null {
	const text = value.trim();
	if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
	if (/^rgba?\(\s*[\d.]+\s*,/i.test(text)) return text;

	const oklch = parseOklch(text);
	return oklch === null ? null : rgbString(oklchToSrgb(oklch), oklch.alpha);
}

type Oklch = { lightness: number; chroma: number; hue: number; alpha: number };

function parseOklch(value: string): Oklch | null {
	const match = /^oklch\(\s*([^)]+)\)$/i.exec(value);
	if (match === null) return null;

	const [components, alphaText] = match[1].split('/');
	const parts = components.trim().split(/\s+/);
	if (parts.length < 3) return null;

	const lightness = numberOrPercent(parts[0], 1);
	const chroma = numberOrPercent(parts[1], 0.4);
	const hue = numberOrPercent(parts[2], 1);
	const alpha = alphaText === undefined ? 1 : numberOrPercent(alphaText.trim(), 1);
	if (lightness === null || chroma === null || hue === null || alpha === null) return null;

	return { lightness, chroma, hue, alpha };
}

/** Parses `0.5` or `50%`, where a percentage is that fraction of `fullScale`. */
function numberOrPercent(text: string, fullScale: number): number | null {
	const percent = text.endsWith('%');
	const parsed = Number.parseFloat(percent ? text.slice(0, -1) : text);
	if (!Number.isFinite(parsed)) return null;
	return percent ? (parsed / 100) * fullScale : parsed;
}

/** Oklch to sRGB, per CSS Color 4. Returns 0-255 channels. */
function oklchToSrgb({ lightness, chroma, hue }: Oklch): [number, number, number] {
	const radians = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(radians);
	const b = chroma * Math.sin(radians);

	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

	return [
		gammaEncode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		gammaEncode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		gammaEncode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
	];
}

function gammaEncode(linear: number): number {
	const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
	return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

function rgbString([red, green, blue]: [number, number, number], alpha: number): string {
	return alpha >= 1
		? `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
		: `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(4))})`;
}
