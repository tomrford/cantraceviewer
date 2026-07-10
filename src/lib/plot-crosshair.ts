export type CrosshairId = 1 | 2;

export type PlotCrosshair = {
	id: CrosshairId;
	x: number;
	y: number;
};

export type LegendCrosshairMode = 'c1' | 'c2' | 'delta';
export type CrosshairDragAxis = 'x' | 'y' | 'both';

export function crosshairById(crosshairs: PlotCrosshair[], id: CrosshairId): PlotCrosshair | null {
	return crosshairs.find((crosshair) => crosshair.id === id) ?? null;
}

export function setCrosshair(
	crosshairs: PlotCrosshair[],
	crosshair: PlotCrosshair
): PlotCrosshair[] {
	return [...crosshairs.filter((item) => item.id !== crosshair.id), crosshair].sort(
		(a, b) => a.id - b.id
	);
}

export function removeCrosshair(crosshairs: PlotCrosshair[], id: CrosshairId): PlotCrosshair[] {
	return crosshairs.filter((crosshair) => crosshair.id !== id);
}

export function nextCrosshairId(crosshairs: PlotCrosshair[]): CrosshairId | null {
	if (crosshairById(crosshairs, 1) === null) return 1;
	if (crosshairById(crosshairs, 2) === null) return 2;
	return null;
}

export function moveCrosshair(
	crosshair: PlotCrosshair,
	point: Pick<PlotCrosshair, 'x' | 'y'>,
	axis: CrosshairDragAxis
): PlotCrosshair {
	return {
		...crosshair,
		x: axis === 'y' ? crosshair.x : point.x,
		y: axis === 'x' ? crosshair.y : point.y
	};
}
