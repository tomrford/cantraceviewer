import { useBrowserValue } from '@/hooks/use-browser-value';
import {
	browserShortcutPlatform,
	shortcutKeys,
	type ShortcutAction,
	type ShortcutPlatform
} from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';

export function ShortcutKey({ action, className }: { action: ShortcutAction; className?: string }) {
	const platform = useBrowserValue<ShortcutPlatform>(browserShortcutPlatform, 'other');

	return (
		<span
			data-slot="kbd-group"
			className={cn('relative inline-flex shrink-0 items-center gap-0.5', className)}
		>
			{shortcutKeys(action, platform).map((key) => (
				<kbd
					key={key}
					data-slot="kbd"
					className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-current/12 px-1 font-mono text-[0.625rem] leading-none font-medium tracking-normal text-current"
				>
					{key}
				</kbd>
			))}
		</span>
	);
}
