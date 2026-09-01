# Dependency patches

## svelte-check@4.7.1

The workspace keeps TypeScript 6 as `typescript` for tools that use its JavaScript API and installs the native TypeScript 7 compiler as the `@typescript/native` npm alias. The `check` scripts pass `--tsgo-experimental-api` so Svelte diagnostics use TypeScript 7.

The patch lets `svelte-check` discover that alias while retaining support for `@typescript/native-preview`. It is the focused compatibility change from the pending upstream [sveltejs/language-tools#3073](https://github.com/sveltejs/language-tools/pull/3073) and can be removed when a release containing that change satisfies the workspace minimum-release-age policy.
