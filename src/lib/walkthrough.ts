export const WALKTHROUGH_VERSION = 1;

export type WalkthroughPlacement = 'bottom-start' | 'bottom-end' | 'right-start';

export type WalkthroughStep = {
	id: 'library' | 'add-dbc' | 'trace' | 'signals' | 'controls';
	target: string;
	placement: WalkthroughPlacement;
	title: string;
	description: string;
	nextLabel: string;
};

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
	{
		id: 'library',
		target: 'signal-selector',
		placement: 'bottom-start',
		title: 'Your signal library',
		description: 'Open the signal selector to add DBC files and choose decoded signals.',
		nextLabel: 'Open selector'
	},
	{
		id: 'add-dbc',
		target: 'add-dbc',
		placement: 'right-start',
		title: 'Add a DBC',
		description:
			'Use the plus button to add one or more DBC files. They stay in this browser for your next visit.',
		nextLabel: 'Continue'
	},
	{
		id: 'trace',
		target: 'trace',
		placement: 'bottom-start',
		title: 'Open a trace',
		description: 'Open or drop an ASC, TRC or BLF file. The trace stays in this tab.',
		nextLabel: 'Continue'
	},
	{
		id: 'signals',
		target: 'signal-list',
		placement: 'right-start',
		title: 'Select signals',
		description:
			'Expand a message and tick a signal. The shared plot updates as you select signals.',
		nextLabel: 'Continue'
	},
	{
		id: 'controls',
		target: 'plot-controls',
		placement: 'bottom-end',
		title: 'Explore the plot',
		description:
			'Use the toolbar to zoom, box-select, show a marker or hide the legend. Scroll to zoom, drag to pan and right-click the plot for more actions.',
		nextLabel: 'Finish'
	}
];

export type WalkthroughRect = {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
};

export type WalkthroughSize = {
	width: number;
	height: number;
};

export function adjacentWalkthroughStep(
	stepId: WalkthroughStep['id'],
	direction: -1 | 1
): WalkthroughStep | null {
	const index = WALKTHROUGH_STEPS.findIndex((step) => step.id === stepId);
	return WALKTHROUGH_STEPS[index + direction] ?? null;
}

export function shouldShowWalkthrough(version: unknown): boolean {
	return typeof version !== 'number' || !Number.isInteger(version) || version < WALKTHROUGH_VERSION;
}

export function placeWalkthrough(
	target: WalkthroughRect,
	panel: WalkthroughSize,
	viewport: WalkthroughSize,
	placement: WalkthroughPlacement
): { top: number; left: number } {
	const gap = 12;
	const margin = 8;
	let top = target.bottom + gap;
	let left = placement === 'bottom-end' ? target.right - panel.width : target.left;

	if (placement === 'right-start') {
		top = target.top;
		left = target.right + gap;
		if (left + panel.width > viewport.width - margin) {
			left = target.left - panel.width - gap;
		}
	} else if (top + panel.height > viewport.height - margin) {
		top = target.top - panel.height - gap;
	}

	return {
		top: clamp(top, margin, viewport.height - panel.height - margin),
		left: clamp(left, margin, viewport.width - panel.width - margin)
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}
