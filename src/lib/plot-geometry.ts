export type PlotRatioPoint = {
	xRatio: number;
	yRatio: number;
};

export function normalizedWheelDelta(
	event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>,
	pageHeight: number
): { x: number; y: number } {
	const unit =
		event.deltaMode === WheelEvent.DOM_DELTA_LINE
			? 16
			: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
				? pageHeight || 800
				: 1;
	return { x: event.deltaX * unit, y: event.deltaY * unit };
}
