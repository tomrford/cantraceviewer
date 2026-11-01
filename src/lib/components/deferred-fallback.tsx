import { Button } from '#lib/components/ui/button.js';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle
} from '#lib/components/ui/dialog.js';

export function DeferredFallback({
	label,
	failed,
	dialog,
	inline
}: {
	label: string;
	failed: boolean;
	dialog?: { open: boolean; onOpenChange: (open: boolean) => void };
	/** Sits inside an existing panel: no page landmark, and nothing while the chunk loads. */
	inline?: boolean;
}) {
	const recovery = failed && (
		<>
			<p className="text-muted-foreground">
				Check your connection, then reload to fetch the latest app. Reloading clears the current
				trace and signal selection. Saved DBCs and preferences stay in this browser.
			</p>
			<Button onClick={() => window.location.reload()}>Reload page</Button>
		</>
	);
	if (dialog) {
		// The chunk usually lands within a few frames of opening; a stub dialog would flash first.
		if (!failed) return null;
		return (
			<Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{label} failed to load</DialogTitle>
						<DialogDescription>This part of the app could not be downloaded.</DialogDescription>
					</DialogHeader>
					<div role="alert" className="grid justify-items-start gap-4">
						{recovery}
					</div>
				</DialogContent>
			</Dialog>
		);
	}
	const status = (
		<div
			role={failed ? 'alert' : 'status'}
			className="grid max-w-md content-start justify-items-start gap-4 text-sm"
		>
			<p className="font-medium">{failed ? `${label} failed to load` : `Loading ${label}…`}</p>
			{recovery}
		</div>
	);
	if (inline) return failed ? status : null;
	return <main className="flex flex-1 items-center justify-center p-8">{status}</main>;
}
