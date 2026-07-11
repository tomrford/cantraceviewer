export type PlotDragMode = 'pan' | 'box';

export type PlotWheelAction =
	| { type: 'pan-x'; deltaX: number }
	| { type: 'zoom'; delta: number; axes: { x: boolean; y: boolean } };

export function plotDragMode(button: number, boxZoomEnabled: boolean): PlotDragMode | null {
	if (button === 1) return 'pan';
	if (button === 0) return boxZoomEnabled ? 'box' : 'pan';
	return null;
}

export function plotWheelAction(
	delta: { x: number; y: number },
	modifiers: { shift: boolean; alt: boolean }
): PlotWheelAction | null {
	if (delta.x === 0 && delta.y === 0) return null;
	if (modifiers.shift && modifiers.alt) return null;

	if (Math.abs(delta.x) > Math.abs(delta.y) && !modifiers.shift && !modifiers.alt) {
		return { type: 'pan-x', deltaX: -delta.x };
	}

	return {
		type: 'zoom',
		delta: Math.abs(delta.y) >= Math.abs(delta.x) ? delta.y : delta.x,
		axes: {
			x: !modifiers.alt,
			y: !modifiers.shift
		}
	};
}
