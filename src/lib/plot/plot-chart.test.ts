import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { plotGrid } from '@/lib/plot/plot-axis-layout';
import type { PlotFrame } from '@/lib/plot/plot-backend';
import { createCanvasBackend } from '@/lib/plot/plot-backend-canvas';
import { mountChart, type RendererState } from '@/lib/plot/plot-chart';
import type { WindowedSignalView } from '@/lib/plot/signal-plot-data';
import { PRIMARY_Y_AXIS_ID } from '@/lib/plot/y-axis';
import { appStore, update } from '@/store/store';

const chartGpuMock = vi.hoisted(() => ({
	moduleLoads: 0,
	create: vi.fn()
}));

vi.mock('chartgpu', () => {
	chartGpuMock.moduleLoads += 1;
	return { ChartGPU: { create: chartGpuMock.create } };
});

type DrawCall = { op: string; args: unknown[] };
type FakeCanvas = {
	style: Record<string, string>;
	width: number;
	height: number;
	getContext: (type: string) => unknown;
	remove: () => void;
};
type FakeSurface = {
	dataset: Record<string, string | undefined>;
	clientWidth: number;
	clientHeight: number;
	children: FakeCanvas[];
	appendChild: (child: FakeCanvas) => FakeCanvas;
	replaceChildren: () => void;
};

let drawCalls: DrawCall[] = [];
let lastCanvas: FakeCanvas;
let pendingFrame: (() => void) | null = null;

function createSurface(): FakeSurface {
	const surface: FakeSurface = {
		dataset: {},
		clientWidth: 800,
		clientHeight: 400,
		children: [],
		appendChild(child) {
			surface.children.push(child);
			return child;
		},
		replaceChildren() {
			surface.children = [];
		}
	};
	return surface;
}

function createContextRecorder() {
	drawCalls = [];
	const target: Record<string, unknown> = {
		measureText: (text: string) => ({ width: text.length * 7 })
	};
	return new Proxy(target, {
		get(obj, prop) {
			if (typeof prop === 'string' && !(prop in obj)) {
				return (...args: unknown[]) => drawCalls.push({ op: prop, args });
			}
			return obj[prop as string];
		}
	});
}

function installBrowserStubs(gpu: unknown, options: { canvasContext?: boolean } = {}) {
	const context = options.canvasContext === false ? null : createContextRecorder();
	vi.stubGlobal('navigator', gpu === undefined ? {} : { gpu });
	vi.stubGlobal('window', { devicePixelRatio: 2 });
	vi.stubGlobal('document', {
		createElement: () => {
			let parent: FakeSurface | null = null;
			const canvas: FakeCanvas = {
				style: {},
				width: 0,
				height: 0,
				getContext: (type) => (type === '2d' ? context : null),
				remove: () => {
					if (parent) parent.children = parent.children.filter((child) => child !== canvas);
				}
			};
			// Track parent when appended so remove() detaches from the owning surface.
			const wrap = (surface: FakeSurface) => {
				parent = surface;
			};
			(canvas as FakeCanvas & { _attach?: (s: FakeSurface) => void })._attach = wrap;
			lastCanvas = canvas;
			return canvas;
		}
	});
	vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		}
	);
	pendingFrame = null;
	vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
		pendingFrame = cb;
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {
		pendingFrame = null;
	});
}

function flushAnimationFrame() {
	const cb = pendingFrame;
	pendingFrame = null;
	cb?.();
}

function surfaceWithAttach(): FakeSurface {
	const surface = createSurface();
	const originalAppend = surface.appendChild;
	surface.appendChild = (child) => {
		(child as FakeCanvas & { _attach?: (s: FakeSurface) => void })._attach?.(surface);
		return originalAppend(child);
	};
	return surface;
}

describe('plot renderer fallback lifecycle', () => {
	beforeEach(() => {
		chartGpuMock.moduleLoads = 0;
		chartGpuMock.create.mockReset();
		update(appStore.getInitialState());
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		update(appStore.getInitialState());
	});

	it('falls back to Canvas 2D without loading ChartGPU when no WebGPU adapter exists', async () => {
		vi.resetModules();
		const requestAdapter = vi.fn(async () => null);
		installBrowserStubs({ requestAdapter });
		const [freshStore, freshWebGpu, freshChart] = await Promise.all([
			import('@/store/store'),
			import('@/lib/plot/plot-backend-webgpu'),
			import('@/lib/plot/plot-chart')
		]);
		const root = surfaceWithAttach();
		const surface = surfaceWithAttach();
		const statuses: RendererState[] = [];

		await freshChart.detectPlotRenderer();
		expect(freshStore.appStore.getState().plotRenderer).toEqual({
			kind: 'canvas',
			fallbackReason: 'No WebGPU adapter is available.'
		});

		// Preload uses the already-detected state and skips re-probing or fetching ChartGPU.
		freshWebGpu.preloadWebGpuBackend();
		expect(requestAdapter).toHaveBeenCalledTimes(1);

		const unmount = freshChart.mountChart(
			root as unknown as HTMLElement,
			surface as unknown as HTMLElement,
			(state) => statuses.push(state)
		);

		await vi.waitFor(() => expect(statuses).toContainEqual({ status: 'ready', kind: 'canvas' }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(chartGpuMock.moduleLoads).toBe(0);
		expect(chartGpuMock.create).not.toHaveBeenCalled();
		expect(surface.dataset.renderer).toBe('canvas');
		expect(surface.children).toHaveLength(1);

		// A store update coalesced onto rAF actually re-renders the mounted Canvas backend.
		drawCalls = [];
		freshStore.update({ timestampMode: 'absolute' });
		flushAnimationFrame();
		expect(drawCalls).toContainEqual({ op: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
		expect(drawCalls.some((call) => call.op === 'fillRect')).toBe(true);

		unmount();
		expect(surface.children).toHaveLength(0);
		expect(surface.dataset.renderer).toBeUndefined();
	});

	it('clears partial surface DOM and falls back with a concise reason when ChartGPU fails to start', async () => {
		installBrowserStubs({ requestAdapter: vi.fn(async () => ({})) });
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const root = surfaceWithAttach();
		const surface = surfaceWithAttach();
		const statuses: RendererState[] = [];

		chartGpuMock.create.mockImplementationOnce(async (target: FakeSurface) => {
			target.appendChild(document.createElement('canvas') as unknown as FakeCanvas);
			throw new Error(
				'ChartGPU: WebGPU is not available.\nResources:\n - https://caniuse.com/webgpu'
			);
		});

		const unmount = mountChart(
			root as unknown as HTMLElement,
			surface as unknown as HTMLElement,
			(state) => statuses.push(state)
		);

		await vi.waitFor(() => expect(statuses).toContainEqual({ status: 'ready', kind: 'canvas' }));
		expect(surface.dataset.renderer).toBe('canvas');
		expect(surface.children).toHaveLength(1);
		expect(appStore.getState().plotRenderer).toEqual({
			kind: 'canvas',
			fallbackReason: 'WebGPU failed to start.'
		});

		unmount();
	});

	it('disposes a late ChartGPU instance cleanly when unmounted during async startup', async () => {
		installBrowserStubs({ requestAdapter: vi.fn(async () => ({})) });
		const root = surfaceWithAttach();
		const surface = surfaceWithAttach();
		const statuses: RendererState[] = [];
		const lateChart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
		let resolveLate!: (chart: typeof lateChart) => void;
		chartGpuMock.create.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveLate = resolve;
				})
		);

		const unmount = mountChart(
			root as unknown as HTMLElement,
			surface as unknown as HTMLElement,
			(state) => statuses.push(state)
		);
		await vi.waitFor(() => expect(chartGpuMock.create).toHaveBeenCalledTimes(1));
		unmount();
		resolveLate(lateChart);
		await Promise.resolve();
		await Promise.resolve();

		expect(lateChart.dispose).toHaveBeenCalledTimes(1);
		expect(statuses).toEqual([]);
		expect(surface.children).toHaveLength(0);
	});

	it('reports an error and clears plotRenderer when the Canvas 2D context cannot be acquired', async () => {
		installBrowserStubs(undefined, { canvasContext: false });
		update({ plotRenderer: { kind: 'webgpu', fallbackReason: null } });
		const root = surfaceWithAttach();
		const surface = surfaceWithAttach();
		const statuses: RendererState[] = [];

		const unmount = mountChart(
			root as unknown as HTMLElement,
			surface as unknown as HTMLElement,
			(state) => statuses.push(state)
		);

		await vi.waitFor(() =>
			expect(statuses).toContainEqual({
				status: 'error',
				message: 'Could not start the plot renderer: Could not acquire a 2D canvas context.'
			})
		);
		expect(appStore.getState().plotRenderer).toBeNull();
		expect(surface.children).toHaveLength(0);
		expect(surface.dataset.renderer).toBeUndefined();
		unmount();
	});
});

describe('Canvas 2D plot backend', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('splits polylines across non-finite gaps, toggles sample markers, and skips unchanged resizes', () => {
		installBrowserStubs(undefined);
		const surface = surfaceWithAttach();
		const x = Float64Array.of(0, 50, 100, 150, 200);
		const y = Float64Array.of(0, 50, Number.NaN, 75, 100);

		const frame = (sampled: boolean): PlotFrame => ({
			theme: {
				background: '#ffffff',
				text: '#71717a',
				axisLine: '#d4d4d8',
				axisTick: '#71717a',
				gridLine: '#d4d4d8',
				fontFamily: 'monospace'
			},
			grid: plotGrid(1),
			xRange: { min: 0, max: 200 },
			timeFormat: { mode: 'relative' },
			axes: [],
			axisRanges: new Map([[PRIMARY_Y_AXIS_ID, { min: 0, max: 100 }]]),
			views: [
				{
					color: '#2563eb',
					signal: { key: 'sig-1' } as WindowedSignalView['signal'],
					series: { timesMs: x, values: y },
					x,
					y,
					sampled
				}
			],
			axisIdByKey: new Map([['sig-1', PRIMARY_Y_AXIS_ID]])
		});

		const backend = createCanvasBackend(surface as unknown as HTMLElement, frame(false));
		expect(lastCanvas.width).toBe(1600);
		expect(lastCanvas.height).toBe(800);
		expect(drawCalls).toContainEqual({ op: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
		expect(drawCalls.filter((call) => call.op === 'arc')).toHaveLength(4);

		// Plot box for 800x400 with 1 Y axis: left=64, right=776 (width=712), top=18, bottom=356 (height=338).
		const clipIndex = drawCalls.findIndex((call) => call.op === 'clip');
		const restoreIndex = drawCalls.findIndex(
			(call, index) => index > clipIndex && call.op === 'restore'
		);
		const seriesCalls = drawCalls.slice(clipIndex + 1, restoreIndex);
		const strokeIndex = seriesCalls.findIndex((call) => call.op === 'stroke');
		const lineCalls = seriesCalls.slice(0, strokeIndex);
		expect(lineCalls).toEqual([
			{ op: 'beginPath', args: [] },
			{ op: 'moveTo', args: [64, 356] },
			{ op: 'lineTo', args: [242, 187] },
			{ op: 'moveTo', args: [598, 102.5] },
			{ op: 'lineTo', args: [776, 18] }
		]);

		// Deep sub-ms zoom suppresses repeated formatted millisecond X labels.
		drawCalls = [];
		backend.render({ ...frame(true), xRange: { min: 10.1, max: 10.4 } });
		const xLabels = drawCalls.filter((call) => call.op === 'fillText').map((call) => call.args[0]);
		expect(new Set(xLabels).size).toBe(xLabels.length);
		expect(drawCalls.filter((call) => call.op === 'arc')).toHaveLength(0);

		drawCalls = [];
		backend.resize();
		expect(drawCalls).toHaveLength(0);

		surface.clientWidth = 600;
		backend.resize();
		expect(lastCanvas.width).toBe(1200);
		expect(drawCalls.length).toBeGreaterThan(0);

		backend.dispose();
		expect(surface.children).toHaveLength(0);
	});
});
