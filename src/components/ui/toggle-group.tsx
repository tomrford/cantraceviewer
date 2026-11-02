import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';

import { cn } from '#lib/utils.js';

function ToggleGroup<Value extends string>({
	className,
	...props
}: ToggleGroupPrimitive.Props<Value>) {
	return (
		<ToggleGroupPrimitive
			data-slot="toggle-group"
			className={cn('flex items-center gap-2', className)}
			{...props}
		/>
	);
}

export { ToggleGroup };
