import { MAX_Y_AXES, nextYAxisId, PRIMARY_Y_AXIS_ID, type YAxisId } from '$lib/plot-axes.js';
import { SvelteMap } from 'svelte/reactivity';

class PlotAxesStore {
	#ids = $state<YAxisId[]>([PRIMARY_Y_AXIS_ID]);
	#assignment = new SvelteMap<string, YAxisId>();

	get ids(): readonly YAxisId[] {
		return this.#ids;
	}

	get assignment(): ReadonlyMap<string, YAxisId> {
		return this.#assignment;
	}

	canAddAxis = $derived(this.#ids.length < MAX_Y_AXES);

	addAxis(): YAxisId | null {
		if (this.#ids.length >= MAX_Y_AXES) return null;
		const id = nextYAxisId(this.#ids);
		this.#ids = [...this.#ids, id];
		return id;
	}

	removeAxis(id: YAxisId): void {
		if (id === PRIMARY_Y_AXIS_ID || !this.#ids.includes(id)) return;
		this.#ids = this.#ids.filter((axisId) => axisId !== id);
		for (const [key, axisId] of this.#assignment) {
			if (axisId === id) this.#assignment.delete(key);
		}
	}

	assign(signalKey: string, axisId: YAxisId): void {
		if (!this.#ids.includes(axisId)) return;
		if (axisId === PRIMARY_Y_AXIS_ID) this.#assignment.delete(signalKey);
		else this.#assignment.set(signalKey, axisId);
	}

	assignToNewAxis(signalKey: string): void {
		const id = this.addAxis();
		if (id !== null) this.assign(signalKey, id);
	}

	release(signalKey: string): void {
		this.#assignment.delete(signalKey);
	}

	releaseAll(): void {
		this.#assignment.clear();
	}

	reset(): void {
		this.#ids = [PRIMARY_Y_AXIS_ID];
		this.#assignment.clear();
	}
}

export const plotAxes = new PlotAxesStore();
