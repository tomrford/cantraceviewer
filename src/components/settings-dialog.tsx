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
import { useRef } from 'react';

import { PanelHeader } from '@/components/panel-header';
import { ShortcutKey } from '@/components/shortcut-key';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { panelShadow } from '@/lib/panel-shadow';
import type { LegendOrderMode } from '@/lib/plot/plot-signal-order';
import { openHelp, setSettingsOpen } from '@/stores/app-shell';
import { setPreference } from '@/stores/preferences';
import { resetPersistentData } from '@/stores/session';
import { useAppStore, type ThemePreference, type TimestampMode } from '@/stores/store';

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
export function SettingsDialog() {
	const panel = useRef<HTMLDivElement>(null);
	const open = useAppStore((s) => s.settingsOpen);
	const theme = useAppStore((s) => s.theme);
	const timestampMode = useAppStore((s) => s.timestampMode);
	const legendOrder = useAppStore((s) => s.legendOrder);
	const legendOrderOption =
		legendOrderOptions.find((option) => option.value === legendOrder) ?? legendOrderOptions[0];

	return (
		<Popover open={open} onOpenChange={setSettingsOpen}>
			<Tooltip>
				<TooltipTrigger
					render={<PopoverTrigger render={<Button size="icon-lg" />} aria-label="Open settings" />}
				>
					<Cog className="size-4" />
				</TooltipTrigger>
				<TooltipContent>
					Settings
					<ShortcutKey action="openSettings" />
				</TooltipContent>
			</Tooltip>
			<PopoverContent
				aria-modal="false"
				align="end"
				sideOffset={-32}
				ref={panel}
				// The panel rather than its first button, whose tooltip would open on focus.
				initialFocus={panel}
				className="relative grid w-[min(22rem,calc(100vw-1rem))] translate-x-2 -translate-y-2 gap-4 rounded-lg border border-border/70 bg-popover/90 p-4 pt-14 text-popover-foreground backdrop-blur-md"
				style={panelShadow}
			>
				<PanelHeader>
					<div className="flex items-center gap-1">
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										variant="ghost"
										size="icon-lg"
										aria-label="Open help"
										onClick={openHelp}
									/>
								}
							>
								<CircleQuestionMark className="size-4" />
							</TooltipTrigger>
							<TooltipContent>
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
										className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
										aria-label="Open source code on GitHub"
									/>
								}
							>
								<Github className="size-4" />
							</TooltipTrigger>
							<TooltipContent>Source code</TooltipContent>
						</Tooltip>
					</div>
					<PopoverTitle className="text-center">Settings</PopoverTitle>
					<PopoverPrimitive.Close
						render={<Button variant="ghost" size="icon-lg" className="justify-self-end" />}
						aria-label="Close settings"
					>
						<X className="size-4" />
					</PopoverPrimitive.Close>
				</PanelHeader>

				<div className="grid gap-2">
					<div className="text-xs font-medium text-muted-foreground">Theme</div>
					<ToggleGroup
						aria-label="Theme"
						className="grid grid-cols-3"
						value={[theme]}
						onValueChange={([value]) => value && setPreference('theme', value)}
					>
						{themeOptions.map(({ value, label, icon: Icon }) => (
							<Toggle key={value} value={value} variant="outline" size="lg">
								<Icon data-icon="inline-start" />
								{label}
							</Toggle>
						))}
					</ToggleGroup>
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
					<span className="text-xs text-muted-foreground">{legendOrderOption.description}</span>
				</label>

				<div className="grid gap-2 border-t pt-4">
					<div className="text-xs font-medium text-muted-foreground">Persistent data</div>
					<p className="text-xs text-muted-foreground">
						Clears saved DBC files and browser preferences. Loaded traces stay in memory until you
						close the tab.
					</p>
					<Button variant="destructive" size="lg" onClick={() => void resetPersistentData()}>
						<RotateCcw data-icon="inline-start" className="size-4" />
						Reset persistent data
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
