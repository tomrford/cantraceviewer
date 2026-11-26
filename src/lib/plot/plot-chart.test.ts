import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { plotGrid } from '@/lib/plot/plot-axis-layout';
import type { PlotFrame, WebGpuAdapter, WebGpuDevice } from '@/lib/plot/plot-backend';
import { createCanvasBackend } from '@/lib/plot/plot-backend-canvas';
import { preloadWebGpuBackend } from '@/lib/plot/plot-backend-webgpu';
import { detectPlotRenderer, mountChart, type RendererState } from '@/lib/plot/plot-chart';
import type { WindowedSignalView } from '@/lib/plot/signal-plot-data';
import { PRIMARY_Y_AXIS_ID } from '@/lib/plot/y-axis';
import { appStore, update } from '@/store/store';

const chartGpuMock = vi.hoisted(() => ({
	moduleLoads: 0,
	create: vi.fn()
}));

vi.mock('chartgpu', () => {
	chartGpuMock.moduleLoads += 1;
	return {
		ChartGPU: { create: chartGpuMock.create }
	};
});

class FakeCanvasElement {
	tagName = 'CANVAS';
	style = { display: '', width: '', height: '' };
	width = 0;
	height = 0;
	parent: FakeElement | null = null;
	ctx: FakeContext2D | null;

	constructor(ctx: FakeContext2D | null) {
		this.ctx = ctx;
	}

	getContext(type: string) {
		return type === '2d' ? this.ctx : null;
	}

	remove() {
		if (this.parent) {
			this.parent.children = this.parent.children.filter((child) => child !== this);
			this.parent = null;
		}
	}
}

class FakeElement {
	dataset: Record<string, string | undefined> = {};
	clientWidth = 800;
	clientHeight = 400;
	children: FakeCanvasElement[] = [];

	appendChild(child: FakeCanvasElement) {
		child.parent = this;
		this.children.push(child);
		return child;
	}

	replaceChildren() {
		for (const child of this.children) child.parent = null;
		this.children = [];
	}
}

class FakeContext2D {
	calls: Array<{ op: string; args: unknown[] }> = [];
	fillStyle = '';
	strokeStyle = '';
	lineWidth = 1;
	lineJoin = 'miter';
	lineCap = 'butt';
	globalAlpha = 1;
	font = '';
	textAlign = 'start';
	textBaseline = 'alphabetic';

	save() {
		this.calls.push({ op: 'save', args: [] });
	}
	restore() {
		this.calls.push({ op: 'restore', args: [] });
	}
	setTransform(...args: number[]) {
		this.calls.push({ op: 'setTransform', args });
	}
	fillRect(...args: number[]) {
		this.calls.push({ op: 'fillRect', args });
	}
	rect(...args: number[]) {
		this.calls.push({ op: 'rect', args });
	}
	clip() {
		this.calls.push({ op: 'clip', args: [] });
	}
	beginPath() {
		this.calls.push({ op: 'beginPath', args: [] });
	}
	moveTo(x: number, y: number) {
		this.calls.push({ op: 'moveTo', args: [x, y] });
	}
	lineTo(x: number, y: number) {
		this.calls.push({ op: 'lineTo', args: [x, y] });
	}
	arc(x: number, y: number, r: number, start: number, end: number) {
		this.calls.push({ op: 'arc', args: [x, y, r, start, end] });
	}
	stroke() {
		this.calls.push({ op: 'stroke', args: [] });
	}
	fill() {
		this.calls.push({ op: 'fill', args: [] });
	}
	measureText(text: string) {
		return { width: text.length * 7 };
	}
	fillText(text: string, x: number, y: number) {
		this.calls.push({ op: 'fillText', args: [text, x, y] });
	}
}

let lastContext: FakeContext2D;
let lastCanvas: FakeCanvasElement;
let dprListeners: Array<() => void> = [];
let fakeWindow: {
	devicePixelRatio: number;
	matchMedia: (query: string) => {
		addEventListener: (_event: string, listener: () => void) => void;
		removeEventListener: (_event: string, listener: () => void) => void;
	};
};

function installBrowserStubs(gpu: unknown, options: { canvasContext?: boolean } = {}) {
	lastContext = new FakeContext2D();
	dprListeners = [];
	fakeWindow = {
		devicePixelRatio: 2,
		matchMedia: () => ({
			addEventListener: (_event, listener) => {
				dprListeners.push(listener);
			},
			removeEventListener: (_event, listener) => {
				dprListeners = dprListeners.filter((item) => item !== listener);
			}
		})
	};
	vi.stubGlobal('navigator', gpu === undefined ? {} : { gpu });
	vi.stubGlobal('window', fakeWindow);
	vi.stubGlobal('document', {
		createElement: (tag: string) => {
			if (tag !== 'canvas') throw new Error(`unexpected tag ${tag}`);
			lastCanvas = new FakeCanvasElement(options.canvasContext === false ? null : lastContext);
			return lastCanvas;
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
	vi.stubGlobal('requestAnimationFrame', () => 1);
	vi.stubGlobal('cancelAnimationFrame', () => {});
}

function fakeDevice(): WebGpuDevice & {
	destroy: ReturnType<typeof vi.fn>;
	lose: (reason: string, message?: string) => void;
} {
	let resolveLost!: (info: { reason: string; message?: string }) => void;
	const lost = new Promise<{ reason: string; message?: string }>((resolve) => {
		resolveLost = resolve;
	});
	const destroy = vi.fn(() => resolveLost({ reason: 'destroyed' }));
	return {
		lost,
		destroy,
		lose(reason, message) {
			resolveLost({ reason, message });
		}
	};
}

function fakeAdapter(device = fakeDevice()): WebGpuAdapter & {
	device: ReturnType<typeof fakeDevice>;
	requestDevice: ReturnType<typeof vi.fn>;
} {
	return {
		device,
		requestDevice: vi.fn(async () => device)
	};
}

function fakeChartInstance() {
	return {
		setOption: vi.fn(),
		resize: vi.fn(),
		dispose: vi.fn()
	};
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

	it('falls back to Canvas 2D without evaluating the ChartGPU module when no adapter exists', async () => {
		installBrowserStubs({ requestAdapter: vi.fn(async () => null) });
		const root = new FakeElement();
		const surface = new FakeElement();
		const statuses: RendererState[] = [];

		await detectPlotRenderer();
		expect(appStore.getState().plotRenderer).toEqual({
			kind: 'canvas',
			fallbackReason: 'No WebGPU adapter is available.'
		});

		preloadWebGpuBackend();
		const unmount = mountChart(
			root as unknown as HTMLElement,
			surface as unknown as HTMLElement,
			(state) => statuses.push(state)
		);

		await vi.waitFor(() => expect(statuses).toContainEqual({ status: 'ready', kind: 'canvas' }));
		// Wait a microtask turn so an unguarded preload import would have evaluated the mock module.
		await Promise.resolve();
		expect(chartGpuMock.moduleLoads).toBe(0);
		expect(chartGpuMock.create).not.toHaveBeenCalled();
		expect(surface.dataset.renderer).toBe('canvas');
		expect(surface.children).toHaveLength(1);

		unmount();
		expect(surface.children).toHaveLength(0);
		expect(surface.dataset.renderer).toBeUndefined();
	});

	it('clears partial surface state, destroys the device, and keeps the fallback reason concise on ChartGPU failure', async () => {
		const adapter = fakeAdapter();
		installBrowserStubs({ requestAdapter: vi.fn(async () => adapter) });
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const root = new FakeElement();
		const surface = new FakeElement();
		const statuses: RendererState[] = [];

		chartGpuMock.create.mockImplementationOnce(async (target: FakeElement) => {
			target.appendChild(new FakeCanvasElement(new FakeContext2D()));
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
		expect(adapter.device.destroy).toHaveBeenCalledTimes(1);
		expect(surface.dataset.renderer).toBe('canvas');
		expect(surface.children).toHaveLength(1);
		expect(appStore.getState().plotRenderer).toEqual({
			kind: 'canvas',
			fallbackReason: 'WebGPU failed to start.'
		});

		unmount();
	});

	it('recovers onto Canvas 2D when the app-owned WebGPU device is lost and cancels cleanly on unmount', async () => {
		const adapter = fakeAdapter();
		installBrowserStubs({ requestAdapter: vi.fn(async () => adapter) });
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const root = new FakeElement();
		const surface = new FakeElement();
		const statuses: RendererState[] = [];
		const liveChart = fakeChartInstance();
		chartGpuMock.create.mockResolvedValueOnce(liveChart);

		const unmount = mountChart(
			root as unknown as HTMLElement,
			surface as unknown as HTMLElement,
			(state) => statuses.push(state)
		);

		await vi.waitFor(() => expect(statuses).toContainEqual({ status: 'ready', kind: 'webgpu' }));
		expect(chartGpuMock.create).toHaveBeenCalledWith(
			surface,
			expect.any(Object),
			expect.objectContaining({ adapter, device: adapter.device })
		);
		expect(surface.dataset.renderer).toBe('webgpu');
		expect(appStore.getState().plotRenderer).toEqual({ kind: 'webgpu', fallbackReason: null });

		adapter.device.lose('unknown', 'GPU reset');
		await vi.waitFor(() => expect(statuses).toContainEqual({ status: 'ready', kind: 'canvas' }));
		expect(liveChart.dispose).toHaveBeenCalledTimes(1);
		expect(adapter.device.destroy).toHaveBeenCalledTimes(1);
		expect(surface.dataset.renderer).toBe('canvas');
		expect(appStore.getState().plotRenderer).toEqual({
			kind: 'canvas',
			fallbackReason: 'WebGPU device was lost.'
		});
		unmount();

		// Unmounting while ChartGPU.create is pending disposes both the chart and its device.
		const lateAdapter = fakeAdapter();
		installBrowserStubs({ requestAdapter: vi.fn(async () => lateAdapter) });
		const lateChart = fakeChartInstance();
		let resolveLate!: (chart: ReturnType<typeof fakeChartInstance>) => void;
		chartGpuMock.create.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveLate = resolve;
				})
		);
		const lateSurface = new FakeElement();
		const lateStatuses: RendererState[] = [];
		const unmountLate = mountChart(
			root as unknown as HTMLElement,
			lateSurface as unknown as HTMLElement,
			(state) => lateStatuses.push(state)
		);
		await vi.waitFor(() => expect(chartGpuMock.create).toHaveBeenCalledTimes(2));
		unmountLate();
		resolveLate(lateChart);
		await Promise.resolve();
		await Promise.resolve();

		expect(lateChart.dispose).toHaveBeenCalledTimes(1);
		expect(lateAdapter.device.destroy).toHaveBeenCalledTimes(1);
		expect(lateStatuses).toEqual([]);
		expect(lateSurface.children).toHaveLength(0);
	});

	it('reports an error instead of ready when the Canvas 2D context cannot be acquired', async () => {
		installBrowserStubs(undefined, { canvasContext: false });
		const root = new FakeElement();
		const surface = new FakeElement();
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
		expect(surface.children).toHaveLength(0);
		expect(surface.dataset.renderer).toBeUndefined();
		unmount();
	});
});

describe('Canvas 2D plot backend', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('splits polylines across non-finite gaps, toggles markers, and resizes on DPR changes', () => {
		installBrowserStubs(undefined);
		const surface = new FakeElement();

		const view = (sampled: boolean): WindowedSignalView => ({
			color: '#2563eb',
			signal: {
				kind: 'mf4',
				signalId: 1,
				key: 'sig-1',
				label: 'Bus.Speed',
				messageName: 'Bus',
				signalName: 'Speed',
				format: {
					unit: 'km/h',
					valueType: 'float64',
					factor: 1,
					offset: 0,
					minimum: 0,
					maximum: 200,
					valueDescriptions: []
				}
			},
			series: {
				timesMs: Float64Array.of(0, 50, 100, 150, 200),
				values: Float64Array.of(0, 50, Number.NaN, 75, 100)
			},
			x: Float64Array.of(0, 50, 100, 150, 200),
			y: Float64Array.of(0, 50, Number.NaN, 75, 100),
			sampled
		});

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
			views: [view(sampled)],
			axisIdByKey: new Map([['sig-1', PRIMARY_Y_AXIS_ID]])
		});

		const backend = createCanvasBackend(surface as unknown as HTMLElement, frame(false));
		expect(lastCanvas.width).toBe(1600);
		expect(lastCanvas.height).toBe(800);
		const unsampledArcs = lastContext.calls.filter((call) => call.op === 'arc');
		expect(unsampledArcs).toHaveLength(4);

		// Inside the clipped series pass, NaN splits (0, 50) and (150, 200) into two moveTo starts.
		const clipIndex = lastContext.calls.findIndex((call) => call.op === 'clip');
		const restoreAfterClip = lastContext.calls.findIndex(
			(call, index) => index > clipIndex && call.op === 'restore'
		);
		const seriesCalls = lastContext.calls.slice(clipIndex + 1, restoreAfterClip);
		const firstStrokeIndex = seriesCalls.findIndex((call) => call.op === 'stroke');
		const lineCalls = seriesCalls.slice(0, firstStrokeIndex);
		expect(lineCalls.filter((call) => call.op === 'moveTo')).toHaveLength(2);
		expect(lineCalls.filter((call) => call.op === 'lineTo')).toHaveLength(2);

		// Moving an idle window to a 1x display resizes the backing store without a CSS box change.
		fakeWindow.devicePixelRatio = 1;
		dprListeners[0]?.();
		expect(lastCanvas.width).toBe(800);
		expect(lastCanvas.height).toBe(400);

		lastContext.calls = [];
		backend.render(frame(true));
		expect(lastContext.calls.filter((call) => call.op === 'arc')).toHaveLength(0);

		backend.dispose();
		expect(dprListeners).toHaveLength(0);
		expect(surface.children).toHaveLength(0);
	});
});
