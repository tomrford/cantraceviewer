import { useStore } from 'zustand';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '#lib/components/ui/dialog.js';
import { ShortcutKey } from '#lib/components/shortcut-key.js';
import { groupedShortcuts, shortcutLabel } from '#lib/keyboard-shortcuts.js';
import { setHelpOpen, startWalkthrough } from '#lib/stores/app-shell.js';
import { TRACE_FILE_FORMAT_NAMES } from '#lib/trace-file-types.js';
import { appStore } from '#lib/stores/store.js';

const groups = groupedShortcuts();

export function HelpDialog() {
	const open = useStore(appStore, (s) => s.helpOpen);

	function showTour(): void {
		setHelpOpen(false);
		startWalkthrough();
	}

	return (
		<Dialog open={open} onOpenChange={setHelpOpen}>
			<DialogContent className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>CAN Trace Viewer</DialogTitle>
					<DialogDescription className="space-y-2 text-left text-pretty">
						<span className="block">
							All files, preferences and saved settings are processed and stored solely in this
							browser's local storage. Nothing leaves your machine.
						</span>
						<span className="block">
							Load one {TRACE_FILE_FORMAT_NAMES} trace, add one or more DBC files, then select
							decoded signals from the signal selector.
						</span>
						<span className="block">
							Current support covers CAN trace plotting and a practical subset of DBC. Signals share
							one time axis and start on one y axis; add more from the legend and drag signals
							between them when their scales do not sit well together.
						</span>
						<span className="block">
							The source code is available on{' '}
							<a
								href="https://github.com/tomrford/cantraceviewer"
								target="_blank"
								rel="noreferrer"
								className="underline underline-offset-2"
							>
								GitHub
							</a>
							.
						</span>
					</DialogDescription>
				</DialogHeader>

				<div className="mt-6 grid gap-5">
					{groups.map(({ group, actions }) => (
						<div key={group} className="grid gap-1">
							<div className="text-xs font-medium text-muted-foreground">{group}</div>
							{actions.map((action) => (
								<div key={action} className="flex items-center justify-between gap-4 py-1 text-sm">
									<span>{shortcutLabel(action)}</span>
									<ShortcutKey action={action} />
								</div>
							))}
						</div>
					))}
				</div>

				<DialogFooter className="mt-6">
					<DialogClose className="flex h-9 items-center justify-center rounded-md border border-border/70 px-4 text-sm transition-[background-color,color,scale] hover:bg-accent hover:text-accent-foreground active:scale-[0.98]">
						Close
					</DialogClose>
					<button
						type="button"
						className="flex h-9 items-center justify-center rounded-md bg-sidebar-primary px-4 text-sm font-medium text-sidebar-primary-foreground transition-[background-color,scale] hover:bg-sidebar-primary/90 active:scale-[0.98]"
						onClick={showTour}
					>
						Show quick tour
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
