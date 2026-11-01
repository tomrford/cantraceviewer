import { useRef } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import {
	CircleQuestionMark,
	Cog,
	createLucideIcon,
	Laptop,
	Moon,
	RotateCcw,
	Sun,
	X,
	type LucideIcon
} from 'lucide-react';
import { useStore } from 'zustand';
import { ShortcutKey } from '#lib/components/shortcut-key.js';
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger
} from '#lib/components/ui/popover.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '#lib/components/ui/select.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip.js';
import { appShell, openHelp } from '#lib/stores/app-shell.js';
import {
	preferences,
	setPreference,
	type LegendOrderMode,
	type ThemePreference,
	type TimestampMode
} from '#lib/stores/preferences.js';
import { onResetPersistentData } from '#lib/stores/session.js';

// lucide-react 1.x dropped brand icons; this is the lucide `github` glyph the app used before.
const Github = createLucideIcon('github', [
	[
		'path',
		{
			d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
			key: 'tonef'
		}
	],
	['path', { d: 'M9 18c-4.51 2-5-2-7-2', key: '9comsn' }]
]);

const iconButtonClass =
	'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]';
const closeButtonClass =
	'flex size-8 items-center justify-center justify-self-end rounded-md text-destructive transition-[background-color,color,box-shadow,scale] hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]';

const themeOptions: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
	{ value: 'light', label: 'Light', icon: Sun },
	{ value: 'dark', label: 'Dark', icon: Moon },
	{ value: 'system', label: 'System', icon: Laptop }
];

const timestampOptions: { value: TimestampMode; label: string }[] = [
	{ value: 'relative', label: 'Relative' },
	{ value: 'absolute', label: 'Absolute' }
];

const legendOrderOptions: { value: LegendOrderMode; label: string; description: string }[] = [
	{
		value: 'selection',
		label: 'Selection order',
		description: 'Keep signals in the order you selected them'
	},
	{
		value: 'alphabetical',
		label: 'Alphabetical',
		description: 'Sort signals alphabetically by signal, then message'
	},
	{
		value: 'grouped',
		label: 'Grouped',
		description: 'Group by value table or unit, then scale'
	}
];

/** Settings popover including its trigger. */
export function SettingsDialog({ triggerClassName }: { triggerClassName?: string }) {
	const panel = useRef<HTMLDivElement>(null);
	const open = useStore(appShell, (s) => s.settingsOpen);
	const theme = useStore(preferences, (s) => s.theme);
	const timestampMode = useStore(preferences, (s) => s.timestampMode);
	const legendOrder = useStore(preferences, (s) => s.legendOrder);
	const legendOrderOption =
		legendOrderOptions.find((option) => option.value === legendOrder) ?? legendOrderOptions[0];

	return (
		<Popover open={open} onOpenChange={(settingsOpen) => appShell.setState({ settingsOpen })}>
			<Tooltip>
				<TooltipTrigger
					render={<PopoverTrigger className={triggerClassName} aria-label="Open settings" />}
				>
					<Cog className="size-4" />
				</TooltipTrigger>
				<TooltipContent sideOffset={6}>
					Settings
					<ShortcutKey action="openSettings" />
				</TooltipContent>
			</Tooltip>
			<PopoverContent
				align="end"
				sideOffset={-32}
				ref={panel}
				// The panel rather than its first button, whose tooltip would open on focus.
				initialFocus={panel}
				className="relative grid w-[min(22rem,calc(100vw-1rem))] translate-x-2 -translate-y-2 gap-4 rounded-lg border border-border/70 bg-popover/90 p-4 pt-14 text-popover-foreground backdrop-blur-md"
				style={{ boxShadow: '0 1px 2px rgb(0 0 0 / 0.08)' }}
			>
				<div className="absolute top-[6.5px] right-[7px] left-[7px] grid h-8 grid-cols-[1fr_auto_1fr] items-center">
					<div className="flex items-center gap-1">
						<Tooltip>
							<TooltipTrigger
								render={
									<button
										type="button"
										className={iconButtonClass}
										aria-label="Open help"
										onClick={openHelp}
									/>
								}
							>
								<CircleQuestionMark className="size-4" />
							</TooltipTrigger>
							<TooltipContent sideOffset={6}>
								Help
								<ShortcutKey action="showHelp" />
							</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger
								render={
									// oxlint-disable-next-line jsx-a11y/anchor-has-content -- content is passed through the trigger
									<a
										href="https://github.com/tomrford/cantraceviewer"
										target="_blank"
										rel="noreferrer"
										className={iconButtonClass}
										aria-label="Open source code on GitHub"
									/>
								}
							>
								<Github className="size-4" />
							</TooltipTrigger>
							<TooltipContent sideOffset={6}>Source code</TooltipContent>
						</Tooltip>
					</div>
					<PopoverTitle className="text-center">Settings</PopoverTitle>
					<PopoverPrimitive.Close className={closeButtonClass} aria-label="Close settings">
						<X className="size-4" />
					</PopoverPrimitive.Close>
				</div>

				<div className="grid gap-2">
					<div className="text-xs font-medium text-muted-foreground">Theme</div>
					<div className="grid grid-cols-3 gap-2">
						{themeOptions.map(({ value, label, icon: Icon }) => (
							<button
								key={value}
								type="button"
								className="flex h-16 flex-col items-center justify-center gap-1 rounded-md border border-border/70 text-xs transition-[background-color,border-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground active:scale-[0.96] data-[selected=true]:border-sidebar-primary/60 data-[selected=true]:bg-sidebar-primary/15 data-[selected=true]:text-sidebar-primary"
								data-selected={theme === value}
								aria-pressed={theme === value}
								onClick={() => setPreference('theme', value)}
							>
								<Icon className="size-4" />
								<span>{label}</span>
							</button>
						))}
					</div>
				</div>

				<label className="grid gap-2" htmlFor="settings-timestamp-mode">
					<span className="text-xs font-medium text-muted-foreground">X-axis timestamps</span>
					<Select
						items={timestampOptions}
						value={timestampMode}
						onValueChange={(value) => value && setPreference('timestampMode', value)}
					>
						<SelectTrigger id="settings-timestamp-mode" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{timestampOptions.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</label>

				<label className="grid gap-2" htmlFor="settings-legend-order">
					<span className="text-xs font-medium text-muted-foreground">Legend order</span>
					<Select
						items={legendOrderOptions}
						value={legendOrder}
						onValueChange={(value) => value && setPreference('legendOrder', value)}
					>
						<SelectTrigger id="settings-legend-order" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{legendOrderOptions.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">{legendOrderOption.description}</p>
				</label>

				<div className="grid gap-2 border-t pt-4">
					<div className="text-xs font-medium text-muted-foreground">Persistent data</div>
					<p className="text-xs text-muted-foreground">
						Clears saved DBC files and browser preferences. Loaded traces stay in memory until you
						close the tab.
					</p>
					<button
						type="button"
						className="flex h-10 items-center justify-center gap-2 rounded-md border border-destructive/40 px-3 text-sm text-destructive transition-[background-color,border-color,color,box-shadow,scale] hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden active:scale-[0.96]"
						onClick={() => void onResetPersistentData()}
					>
						<RotateCcw className="size-4" />
						<span>Reset persistent data</span>
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
