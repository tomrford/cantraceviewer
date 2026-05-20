# CAN Trace Viewer

https://cantraceviewer.com

CAN Trace Viewer is a quick and simple browser-based trace viewer for CAN logs that runs completely on your machine. load a trace file, add the matching DBCs, choose the signals you care about, and inspect decoded values on a shared time axis.

I built this for all those times I wanted to "just see quickly what the 3 or 4 important signals were doing" and didn't have time to wait minutes to open large, licence-requiring, slow and old automotive grade desktop apps. It's free for anyone to use since it's purely static and costs me nothing to host on Cloudflare Workers. Feel free to put feature requests in the GitHub issues, but I can't promise I'll add everything as the point of this isn't to become a desktop-grade graphing tool but a convenient alternative for at least 3/4 of my usage.

Trace files and decoded series stay in the current browser session. Saved DBCs and display preferences live in the browser storage (via IndexedDB) on the current device, so repeat analysis does not require re-uploading databases. Supported trace inputs are ASC, PCAN TRC 1.x/2.x, BLF, and MF4 (raw bus logging; full MF4 support is in progress). There are currently (relatively generous) file size limits for traces and dbc files; let me know if you hit these and we can see whether larger files still perform well enough.

## Development

The UI is SvelteKit/Svelte 5 with Bun, Tailwind, and shadcn-svelte style components. Zig code under `wasm/` compiles to WebAssembly for DBC parsing, trace parsing, and signal decode work.

```sh
nix develop -c bun install
nix develop -c bun run dev
nix develop -c bun run wasm:build
```

Useful checks:

```sh
nix develop -c bun run test
nix develop -c bun run check
nix develop -c bun run wasm:test
nix develop -c bun run wasm:build:release
```
