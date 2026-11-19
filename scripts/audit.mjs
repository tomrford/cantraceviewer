import { spawnSync } from 'node:child_process';

// GHSA-g3hv-75wg-m249 is fixed only in minimatch 11, and @ts-morph/common still depends on 10.x.
// GHSA-gcqx-w48m-w2h4 has no patched deepmerge release; 4.3.1 is still the latest 4.x.
const audits = [
	['bun', ['audit', '--ignore=GHSA-g3hv-75wg-m249', '--ignore=GHSA-gcqx-w48m-w2h4']],
	['cargo', ['audit', '--file', 'wasm/Cargo.lock']]
];

for (const [command, args] of audits) {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.error) console.error(result.error.message);
	if (result.status !== 0) process.exitCode = 1;
}
