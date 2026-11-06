import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from '@/components/ui/alert-dialog';

/** Alert shown while `message` is set; both dismissal paths call `onDismiss`. */
export function ErrorDialog({
	title,
	message,
	onDismiss
}: {
	title: string;
	message: string | null;
	onDismiss: () => void;
}) {
	return (
		<AlertDialog
			open={message !== null}
			onOpenChange={(open) => {
				if (!open) onDismiss();
			}}
		>
			{message !== null && (
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{title}</AlertDialogTitle>
						<AlertDialogDescription>{message}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={onDismiss}>OK</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			)}
		</AlertDialog>
	);
}
