import {
	checkWebGpuSupport,
	type PlotBackend,
	type PlotFrame,
	type PlotRendererInfo,
	type PlotRendererKind
} from '@/lib/plot/plot-backend';
import { createCanvasBackend } from '@/lib/plot/plot-backend-canvas';
import { createWebGpuBackend } from '@/lib/plot/plot-backend-webgpu';
import { resolvePlotTheme } from '@/lib/plot/plot-theme';
import { PlotWindow } from '@/lib/plot/plot-window';
import { isDark } from '@/store/preferences';
import { type AppState, appStore, update } from '@/store/store';

export type RendererState =
	| { status: 'loading' }
	| { status: 'ready'; kind: PlotRendererKind }
	| { status: 'error'; message: string };

/**
 * Probes WebGPU availability at browser startup so the fallback badge can appear before a trace
 * is opened, without touching or fetching the ChartGPU bundle.
 */
export async function detectPlotRenderer(): Promise<void> {
	const support = await checkWebGpuSupport();
	if (appStore.getState().plotRenderer !== null) return;
	update({
		plotRenderer: support.ok
			? { kind: 'webgpu', fallbackReason: null }
			: { kind: 'canvas', fallbackReason: support.reason }
	});
}

/**
 * Starts the plot backend on `surface` (WebGPU via ChartGPU, falling back automatically to Canvas
 * 2D when WebGPU is unavailable or fails to start) and pushes frames from store subscriptions,
 * coalesced to one render per animation frame. Returns the teardown.
 */
export function mountChart(
	root: HTMLElement,
	surface: HTMLElement,
	onStatus: (state: RendererState) => void
): () => void {
	let disposed = false;
	let backend: PlotBackend | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let frame: number | null = null;
	let themeDark = isDark(appStore.getState());
	let theme = resolvePlotTheme(getComputedStyle(root));
	const plotWindow = new PlotWindow(schedule);

	function currentFrame(): PlotFrame {
		// connectPreferences toggles the dark class in the same store update that scheduled this frame.
		const state = appStore.getState();
		const dark = isDark(state);
		if (dark !== themeDark) {
			themeDark = dark;
			theme = resolvePlotTheme(getComputedStyle(root));
		}
		const model = state.plotModel;
		const views = plotWindow.viewsFor(model.views, state.activeViewport);
		return buildPlotFrame(theme, state, views);
	}

	function schedule(): void {
		if (frame !== null) return;
		frame = requestAnimationFrame(() => {
			frame = null;
			if (backend === null) return;
			backend.render(currentFrame());
			plotWindow.settleAfter(
				appStore.getState().plotModel.views,
				appStore.getState().activeViewport
			);
		});
	}

	function activate(next: PlotBackend, info: PlotRendererInfo, catchUp: boolean): void {
		backend = next;
		surface.dataset.renderer = next.kind;
		const current = appStore.getState().plotRenderer;
		if (current?.kind !== info.kind || current.fallbackReason !== info.fallbackReason) {
			update({ plotRenderer: info });
		}
		resizeObserver = new ResizeObserver(() => backend?.resize());
		resizeObserver.observe(surface);
		// Store/theme updates may have arrived while async WebGPU startup was pending.
		if (catchUp) schedule();
		onStatus({ status: 'ready', kind: next.kind });
	}

	function mountCanvasFallback(reason: string): void {
		surface.replaceChildren();
		try {
			const canvas = createCanvasBackend(surface, currentFrame());
			activate(canvas, { kind: 'canvas', fallbackReason: reason }, false);
		} catch (error) {
			if (!disposed) {
				if (appStore.getState().plotRenderer !== null) update({ plotRenderer: null });
				onStatus({
					status: 'error',
					message: `Could not start the plot renderer: ${error instanceof Error ? error.message : 'unknown error'}`
				});
			}
		}
	}

	async function start(): Promise<void> {
		const support = await checkWebGpuSupport();
		if (disposed) return;

		if (!support.ok) {
			mountCanvasFallback(support.reason);
			return;
		}

		try {
			const webgpu = await createWebGpuBackend(surface, currentFrame(), () => disposed);
			if (webgpu === null) return;
			activate(webgpu, { kind: 'webgpu', fallbackReason: null }, true);
		} catch (error) {
			if (disposed) return;
			console.warn('WebGPU renderer failed; falling back to Canvas 2D.', error);
			mountCanvasFallback('WebGPU failed to start.');
		}
	}

	// Every viewport change replaces `axisRanges`, so it alone tracks viewport changes.
	const unsubscribe = appStore.subscribe((state, previous) => {
		if (
			state.plotModel !== previous.plotModel ||
			state.axisRanges !== previous.axisRanges ||
			state.timestampMode !== previous.timestampMode ||
			isDark(state) !== isDark(previous)
		) {
			schedule();
		}
	});
	void start();

	return () => {
		disposed = true;
		if (frame !== null) cancelAnimationFrame(frame);
		unsubscribe();
		plotWindow.dispose();
		resizeObserver?.disconnect();
		backend?.dispose();
		delete surface.dataset.renderer;
	};
}

function buildPlotFrame(
	theme: PlotFrame['theme'],
	state: AppState,
	views: PlotFrame['views']
): PlotFrame {
	const model = state.plotModel;
	return {
		theme,
		grid: model.grid,
		xRange:
			state.activeViewport === null
				? null
				: { min: state.activeViewport.xMin, max: state.activeViewport.xMax },
		timeFormat: {
			measurementStartMs: state.trace?.metadata.measurementStartMs,
			mode: state.timestampMode
		},
		axes: model.axes,
		axisRanges: state.axisRanges,
		views,
		axisIdByKey: model.axisIdByKey
	};
}
