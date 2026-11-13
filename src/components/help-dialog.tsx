import { ShortcutKey } from '@/components/shortcut-key';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';
import { groupedShortcuts, shortcutLabel } from '@/lib/keyboard-shortcuts';
import { TRACE_FILE_FORMAT_NAMES } from '@/lib/trace-file-types';
import { setHelpOpen, startWalkthrough } from '@/store/app-shell';
import { useAppStore } from '@/store/store';

const groups = groupedShortcuts();

export function HelpDialog() {
	const open = useAppStore((s) => s.helpOpen);

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
							Files are processed in this browser and nothing leaves your machine. Saved DBC files
							and preferences are stored in this browser only.
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
					<DialogClose render={<Button variant="outline" size="lg" />}>Close</DialogClose>
					<Button size="lg" onClick={showTour}>
						Show quick tour
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
