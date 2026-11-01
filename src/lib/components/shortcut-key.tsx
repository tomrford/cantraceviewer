import { useStore } from 'zustand';
import { shortcutKeys, type ShortcutAction } from '#lib/keyboard-shortcuts.js';
import { appShell } from '#lib/stores/app-shell.js';
import { cn } from '#lib/utils.js';

export function ShortcutKey({ action, className }: { action: ShortcutAction; className?: string }) {
	const platform = useStore(appShell, (s) => s.shortcutPlatform);

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
