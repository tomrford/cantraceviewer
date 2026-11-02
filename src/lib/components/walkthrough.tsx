import { useRef } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Button } from '#lib/components/ui/button.js';
import { advanceWalkthrough } from '#lib/stores/app-shell.js';
import { WALKTHROUGH_STEPS, type WalkthroughStep } from '#lib/walkthrough.js';
import { useAppStore } from '#lib/stores/store.js';

export function Walkthrough() {
	const stepId = useAppStore((s) => s.walkthroughStepId);
	const stepIndex = WALKTHROUGH_STEPS.findIndex((step) => step.id === stepId);
	if (stepIndex < 0) return null;
	return <WalkthroughPanel step={WALKTHROUGH_STEPS[stepIndex]} stepIndex={stepIndex} />;
}

function WalkthroughPanel({ step, stepIndex }: { step: WalkthroughStep; stepIndex: number }) {
	const panel = useRef<HTMLDivElement>(null);

	return (
		<PopoverPrimitive.Root
			open
			// The tour only ends through its own controls. Escape still reaches the signal selector.
			onOpenChange={(_open, details) => {
				details.cancel();
				details.allowPropagation();
			}}
		>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Positioner
					anchor={() => document.querySelector(`[data-walkthrough-target="${step.target}"]`)}
					side={step.side}
					align={step.align}
					sideOffset={12}
					collisionPadding={8}
					// Stays on screen when neither side fits, as beside the selector on a narrow viewport.
					sticky
					className="isolate z-[80]"
				>
					<PopoverPrimitive.Popup
						ref={panel}
						aria-modal="false"
						initialFocus={panel}
						finalFocus={false}
						className="grid w-[min(20rem,calc(100vw-1rem))] gap-3 rounded-lg border border-border/60 bg-popover/95 p-4 text-popover-foreground shadow-md outline-hidden backdrop-blur-md duration-100 data-open:animate-in data-open:fade-in-0"
					>
						<div className="grid gap-1" aria-live="polite">
							<div className="text-xs text-muted-foreground">
								Step {stepIndex + 1} of {WALKTHROUGH_STEPS.length}
							</div>
							<PopoverPrimitive.Title className="text-sm font-medium">
								{step.title}
							</PopoverPrimitive.Title>
							<PopoverPrimitive.Description className="text-xs/relaxed text-muted-foreground">
								{step.description}
							</PopoverPrimitive.Description>
						</div>

						<div className="flex justify-end">
							<Button size="lg" onClick={advanceWalkthrough}>
								{stepIndex === WALKTHROUGH_STEPS.length - 1 ? 'Finish' : 'Next'}
							</Button>
						</div>
					</PopoverPrimitive.Popup>
				</PopoverPrimitive.Positioner>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}
