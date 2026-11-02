import { TRACE_FILE_FORMAT_NAMES } from './trace-file-types';

export const WALKTHROUGH_VERSION = 1;

export type WalkthroughStep = {
	id: 'library' | 'add-dbc' | 'trace' | 'signals' | 'controls';
	target: string;
	side: 'bottom' | 'right';
	align: 'start' | 'end';
	title: string;
	description: string;
};

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
	{
		id: 'trace',
		target: 'trace',
		side: 'bottom',
		align: 'start',
		title: 'Open a trace',
		description: `Open or drop an ${TRACE_FILE_FORMAT_NAMES} file. The trace stays in this tab.`
	},
	{
		id: 'library',
		target: 'signal-selector',
		side: 'bottom',
		align: 'start',
		title: 'Your signal library',
		description: 'Open the signal selector to add DBC files and choose decoded signals.'
	},
	{
		id: 'add-dbc',
		target: 'add-dbc',
		side: 'right',
		align: 'start',
		title: 'Add a DBC',
		description:
			'Use the plus button to add one or more DBC files. They stay in this browser for your next visit.'
	},
	{
		id: 'signals',
		target: 'signal-selector-panel',
		side: 'right',
		align: 'start',
		title: 'Select signals',
		description:
			'Expand a message and tick a signal. The shared plot updates as you select signals.'
	},
	{
		id: 'controls',
		target: 'plot-controls',
		side: 'bottom',
		align: 'end',
		title: 'Explore the plot',
		description:
			'Once signals are plotted, use the toolbar here to zoom, box-select, place a crosshair or hide the legend. Scroll to zoom, drag to pan and right-click the plot for more actions.'
	}
];

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
