import { spawnSync } from 'node:child_process';

const audits = [
	['pnpm', ['audit']],
	['cargo', ['audit', '--file', 'wasm/Cargo.lock']]
];

for (const [command, args] of audits) {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.error) console.error(result.error.message);
	if (result.status !== 0) process.exitCode = 1;
}
