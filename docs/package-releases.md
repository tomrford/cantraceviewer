# Package releases

The `cantraceviewer` npm package is built from `packages/core`. GitHub Actions
builds the release WASM and one package tarball on Linux with the pinned Nix
toolchain. Browser, direct, Node.js, application-build, and Electron checks all
use that tarball. The publish job downloads the same artifact and verifies its
checksum before sending it to npm.

## Release

1. Set `packages/core/package.json` to the intended version and merge the
   validated change to `main`.
2. Create a GitHub release whose tag is exactly `v<package version>`, such as
   `v0.1.0`. Mark prerelease versions as prereleases.
3. Approve the `npm` environment when the publish job requests it.
4. Verify the package on npm. Stable GitHub releases use the `latest` npm tag;
   prereleases use `next`.

The workflow rejects tags that do not match the package version or whose commit
is not in `main`. Only the publish job receives `id-token: write`.

The npm package must trust the `tomrford/cantraceviewer` repository and the
exact `.github/workflows/publish-package.yml` workflow. Configure the trusted
publisher for staged or direct publication as required, then disallow
traditional token publication. The GitHub `npm` environment provides the
human approval boundary.

## First-package bootstrap

The package name was registered with a manually published
`cantraceviewer@0.1.0-rc.0` tarball after the full package validation passed.
That one publication disabled provenance because it did not run in a supported
CI identity. The local npm session was logged out immediately afterward.
Subsequent releases use trusted publishing and automatic provenance.

## Test an unpublished package

Run the complete tarball validation without changing the application’s
production dependency:

```sh
nix develop -c pnpm run wasm:build:release
nix develop -c pnpm run package:validate
```

`package:validate` packs once, installs that tarball into isolated temporary
projects, tests every public entry, builds CAN Trace Viewer against it, and runs
the Electron fixture. The application keeps an exact registry dependency and
pnpm workspace linking is disabled. `minimumReleaseAge` applies to every other
dependency; `cantraceviewer` is explicitly exempt because its exact versions
come from this repository's approved trusted-publishing workflow. Do not point
the production application at a workspace package merely to test unpublished
package changes.
