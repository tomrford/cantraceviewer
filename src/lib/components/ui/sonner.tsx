import {
	RiCheckboxCircleLine,
	RiCloseCircleLine,
	RiErrorWarningLine,
	RiInformationLine,
	RiLoaderLine
} from '@remixicon/react';
import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
	return (
		<Sonner
			className="toaster group"
			icons={{
				success: <RiCheckboxCircleLine className="size-4" />,
				info: <RiInformationLine className="size-4" />,
				warning: <RiCloseCircleLine className="size-4" />,
				error: <RiErrorWarningLine className="size-4" />,
				loading: <RiLoaderLine className="size-4 animate-spin" />
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
