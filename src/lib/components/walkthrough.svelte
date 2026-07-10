<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		placeWalkthrough,
		type WalkthroughRect,
		type WalkthroughStep
	} from '$lib/walkthrough.js';

	let {
		step,
		stepIndex,
		stepCount,
		nextDisabled = false,
		nextHint,
		onBack,
		onNext,
		onSkip
	}: {
		step: WalkthroughStep;
		stepIndex: number;
		stepCount: number;
		nextDisabled?: boolean;
		nextHint?: string;
		onBack: () => void;
		onNext: () => void;
		onSkip: () => void;
	} = $props();

	let panel = $state<HTMLDivElement>();
	let targetRect = $state<WalkthroughRect | null>(null);
	let panelPosition = $state({ top: 0, left: 0 });
	let ready = $state(false);

	$effect(() => {
		if (!panel || typeof document === 'undefined') return;

		const target = document.querySelector<HTMLElement>(
			`[data-walkthrough-target="${step.target}"]`
		);
		if (!target) {
			ready = false;
			return;
		}
		const targetElement = target;

		let animationFrame: number | null = null;
		function updatePosition(): void {
			const targetBounds = targetElement.getBoundingClientRect();
			const panelBounds = panel?.getBoundingClientRect();
			if (!panelBounds) return;

			targetRect = {
				top: targetBounds.top,
				right: targetBounds.right,
				bottom: targetBounds.bottom,
				left: targetBounds.left,
				width: targetBounds.width,
				height: targetBounds.height
			};
			panelPosition = placeWalkthrough(
				targetRect,
				{ width: panelBounds.width, height: panelBounds.height },
				{ width: window.innerWidth, height: window.innerHeight },
				step.placement
			);
			ready = true;
		}

		const resizeObserver = new ResizeObserver(updatePosition);
		resizeObserver.observe(targetElement);
		resizeObserver.observe(panel);
		window.addEventListener('resize', updatePosition);
		window.addEventListener('scroll', updatePosition, true);
		animationFrame = requestAnimationFrame(() => {
			updatePosition();
			panel?.focus({ preventScroll: true });
		});

		return () => {
			if (animationFrame !== null) cancelAnimationFrame(animationFrame);
			resizeObserver.disconnect();
			window.removeEventListener('resize', updatePosition);
			window.removeEventListener('scroll', updatePosition, true);
		};
	});

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		onSkip();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if targetRect}
	<div
		class="pointer-events-none fixed z-[70] rounded-xl border-2 border-sidebar-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--sidebar-primary)_20%,transparent)] transition-[top,left,width,height] duration-150"
		style:top={`${targetRect.top - 5}px`}
		style:left={`${targetRect.left - 5}px`}
		style:width={`${targetRect.width + 10}px`}
		style:height={`${targetRect.height + 10}px`}
		aria-hidden="true"
	></div>
{/if}

<div
	bind:this={panel}
	class="fixed z-[80] grid w-[min(20rem,calc(100vw-1rem))] gap-3 rounded-lg border border-border/70 bg-popover/95 p-4 text-popover-foreground shadow-lg backdrop-blur-md transition-[top,left,opacity] duration-150"
	class:opacity-0={!ready}
	style:top={`${panelPosition.top}px`}
	style:left={`${panelPosition.left}px`}
	role="dialog"
	aria-modal="false"
	aria-labelledby="walkthrough-title"
	aria-describedby="walkthrough-description"
	tabindex="-1"
>
	<div class="grid gap-1" aria-live="polite">
		<div class="text-xs text-muted-foreground">Step {stepIndex + 1} of {stepCount}</div>
		<h2 id="walkthrough-title" class="text-sm font-medium">{step.title}</h2>
		<p id="walkthrough-description" class="text-xs/relaxed text-muted-foreground">
			{step.description}
		</p>
		{#if nextHint}
			<p class="text-xs/relaxed text-sidebar-primary">{nextHint}</p>
		{/if}
	</div>

	<div class="flex items-center justify-between gap-2">
		<Button variant="ghost" class="h-10 px-3" onclick={onSkip}>Skip</Button>
		<div class="flex items-center gap-2">
			{#if stepIndex > 0}
				<Button variant="outline" class="h-10 px-3" onclick={onBack}>Back</Button>
			{/if}
			<Button class="h-10 px-3" disabled={nextDisabled} onclick={onNext}>
				{step.nextLabel}
			</Button>
		</div>
	</div>
</div>
