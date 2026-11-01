import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { cn } from '#lib/utils.js';

function Menu({ ...props }: MenuPrimitive.Root.Props) {
	return <MenuPrimitive.Root {...props} />;
}

function MenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
	return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />;
}

function MenuContent({
	className,
	align = 'center',
	sideOffset = 4,
	...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'align' | 'sideOffset'>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="isolate z-50">
				<MenuPrimitive.Popup
					data-slot="menu-content"
					className={cn(
						'z-50 flex origin-(--transform-origin) flex-col gap-1 rounded-lg bg-popover p-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
						className
					)}
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
	return (
		<MenuPrimitive.Item
			data-slot="menu-item"
			className={cn(
				"flex h-7 cursor-default items-center gap-1 rounded-md px-2 text-xs/relaxed font-medium outline-none select-none data-highlighted:bg-muted data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
				className
			)}
			{...props}
		/>
	);
}

export { Menu, MenuContent, MenuItem, MenuTrigger };
