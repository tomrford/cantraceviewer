import type { ComponentProps } from 'react';
import { Search } from 'lucide-react';
import { Input } from '#lib/components/ui/input.js';
import { Label } from '#lib/components/ui/label.js';

export function SearchForm({
	value,
	onValueChange,
	placeholder = 'Search signals...',
	...props
}: Omit<ComponentProps<'form'>, 'onSubmit'> & {
	value: string;
	onValueChange: (value: string) => void;
	placeholder?: string;
}) {
	return (
		<form onSubmit={(event) => event.preventDefault()} {...props}>
			<div className="relative">
				<Label htmlFor="search" className="sr-only">
					Search
				</Label>
				<Input
					id="search"
					value={value}
					onChange={(event) => onValueChange(event.currentTarget.value)}
					placeholder={placeholder}
					className="ps-8"
				/>
				<Search className="pointer-events-none absolute inset-s-2 top-1/2 size-4 -translate-y-1/2 opacity-50 select-none" />
			</div>
		</form>
	);
}
