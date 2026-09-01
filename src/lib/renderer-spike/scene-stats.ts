import type { ChartScene, SceneNode } from '@tanstack/charts';

export type SceneStats = {
	points: number;
	nodes: number;
	polylines: number;
	polylineVertices: number;
};

export function sceneStats(scene: ChartScene): SceneStats {
	const geometry = walk(scene.nodes);
	return {
		points: scene.points.length,
		nodes: geometry.nodes,
		polylines: geometry.polylines,
		polylineVertices: geometry.polylineVertices
	};
}

function walk(nodes: readonly SceneNode[]): {
	nodes: number;
	polylines: number;
	polylineVertices: number;
} {
	let count = 0;
	let polylines = 0;
	let polylineVertices = 0;
	for (const node of nodes) {
		count += 1;
		if (node.kind === 'polyline') {
			polylines += 1;
			polylineVertices += node.points.length;
		}
		if (node.kind === 'group') {
			const nested = walk(node.children);
			count += nested.nodes;
			polylines += nested.polylines;
			polylineVertices += nested.polylineVertices;
		}
	}
	return { nodes: count, polylines, polylineVertices };
}
