import type { PlotGrid } from '@/lib/plot/plot-axis-layout';
import type { PlotTheme } from '@/lib/plot/plot-theme';
import type { PlotAxisRange } from '@/lib/plot/plot-viewport';
import type { WindowedSignalView } from '@/lib/plot/signal-plot-data';
import type { YAxisId } from '@/lib/plot/y-axis';
import type { PlotAxisView } from '@/store/derive';
import type { TimestampMode } from '@/store/store';

export type PlotRendererKind = 'webgpu' | 'canvas';

export type PlotRendererInfo =
	{ kind: 'webgpu'; fallbackReason: null } | { kind: 'canvas'; fallbackReason: string };

export type PlotFrame = {
	theme: PlotTheme;
	grid: PlotGrid;
	xRange: PlotAxisRange | null;
	timeFormat: { measurementStartMs?: number | null; mode: TimestampMode };
	axes: readonly PlotAxisView[];
	axisRanges: ReadonlyMap<YAxisId, PlotAxisRange>;
	views: readonly WindowedSignalView[];
	axisIdByKey: ReadonlyMap<string, YAxisId>;
};

export type PlotBackend = {
	readonly kind: PlotRendererKind;
	render(frame: PlotFrame): void;
	resize(): void;
	dispose(): void;
};

export type WebGpuDevice = {
	readonly lost: Promise<{ readonly reason: string; readonly message?: string }>;
	destroy(): void;
};

export type WebGpuAdapter = {
	requestDevice(): Promise<WebGpuDevice>;
};

export type WebGpuSupport = { ok: true; adapter: WebGpuAdapter } | { ok: false; reason: string };

type WebGpuNavigator = Navigator & {
	gpu?: { requestAdapter?: () => Promise<WebGpuAdapter | null> };
};

/** Dev/build override to exercise the Canvas 2D fallback on a GPU-capable browser. */
function forcedCanvasReason(): string | null {
	if (import.meta.env.VITE_PLOT_RENDERER === 'canvas') {
		return 'Canvas fallback forced via VITE_PLOT_RENDERER.';
	}
	if (import.meta.env.DEV && typeof location !== 'undefined') {
		if (new URLSearchParams(location.search).get('renderer') === 'canvas') {
			return 'Canvas fallback forced via ?renderer=canvas.';
		}
	}
	return null;
}

/**
 * Checks whether WebGPU can provide an adapter before fetching the ChartGPU bundle.
 * Never throws; returns a short user-facing reason when falling back to Canvas 2D.
 */
export async function checkWebGpuSupport(): Promise<WebGpuSupport> {
	const forced = forcedCanvasReason();
	if (forced !== null) return { ok: false, reason: forced };

	if (typeof navigator === 'undefined') {
		return { ok: false, reason: 'WebGPU is unavailable in this environment.' };
	}
	const gpu = (navigator as WebGpuNavigator).gpu;
	if (!gpu || typeof gpu.requestAdapter !== 'function') {
		return { ok: false, reason: 'WebGPU is not supported in this browser.' };
	}

	try {
		const adapter = await gpu.requestAdapter();
		if (!adapter) {
			return { ok: false, reason: 'No WebGPU adapter is available.' };
		}
		return { ok: true, adapter };
	} catch {
		return { ok: false, reason: 'WebGPU adapter check failed.' };
	}
}
