import { Toaster } from '#lib/components/ui/sonner.js';
import { TooltipProvider } from '#lib/components/ui/tooltip.js';

export function App() {
	return (
		<>
			<TooltipProvider delay={500}>
				<main data-scaffold-placeholder className="min-h-screen bg-background" />
			</TooltipProvider>
			<Toaster position="bottom-center" />
		</>
	);
}
