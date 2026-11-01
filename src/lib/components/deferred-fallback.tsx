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
	dialog
}: {
	label: string;
	failed: boolean;
	dialog?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
	const title = failed ? `${label} failed to load` : `Loading ${label}…`;
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
		return (
			<Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>
							{failed
								? 'This part of the app could not be downloaded.'
								: 'Downloading this part of the app.'}
						</DialogDescription>
					</DialogHeader>
					<div role={failed ? 'alert' : 'status'} className="grid justify-items-start gap-4">
						{failed ? recovery : title}
					</div>
				</DialogContent>
			</Dialog>
		);
	}
	return (
		<main className="flex flex-1 items-center justify-center p-8">
			<div
				role={failed ? 'alert' : 'status'}
				className="grid max-w-md justify-items-start gap-4 text-sm"
			>
				<p className="font-medium">{title}</p>
				{recovery}
			</div>
		</main>
	);
}
