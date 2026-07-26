# Electron package fixture

This private fixture validates the two supported Electron arrangements for the packed `cantraceviewer` package:

- the renderer uses the package-root browser Worker client;
- the renderer calls the main process through a context-isolated preload, and the main process uses `cantraceviewer/node` with its worker thread.

`pnpm run package:test:electron` builds and runs the fixture against the versioned tarball under `artifacts/`. The renderer is served through a standard, secure custom protocol so module Workers and WASM assets use the same arrangement as a packaged Electron application. The fixture must not import `cantraceviewer/direct` in the renderer or main process.
