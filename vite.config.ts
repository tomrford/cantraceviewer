import { fileURLToPath, URL } from 'node:url';

import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src/', import.meta.url));

export default defineConfig({
	plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
	resolve: {
		alias: [{ find: /^@\//, replacement: src }]
	},
	worker: { format: 'es' },
	optimizeDeps: { exclude: ['cantraceviewer'] },
	test: {
		expect: { requireAssertions: true },
		include: ['src/**/*.{test,spec}.{js,ts}', 'packages/**/*.{test,spec}.{js,ts}']
	}
});
