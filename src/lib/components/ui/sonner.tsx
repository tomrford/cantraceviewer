import { CircleCheck, CircleX, CircleAlert, Info, LoaderCircle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
	return (
		<Sonner
			className="toaster group"
			icons={{
				success: <CircleCheck className="size-4" />,
				info: <Info className="size-4" />,
				warning: <CircleX className="size-4" />,
				error: <CircleAlert className="size-4" />,
				loading: <LoaderCircle className="size-4 animate-spin" />
			}}
			style={
				{
					'--normal-bg': 'var(--popover)',
					'--normal-text': 'var(--popover-foreground)',
					'--normal-border': 'var(--border)',
					'--border-radius': 'var(--radius)'
				} as CSSProperties
			}
			toastOptions={{ classNames: { toast: 'cn-toast' } }}
			{...props}
		/>
	);
}

export { Toaster };
