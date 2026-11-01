# React migration coverage audit

Compared the six removed Svelte test files at `02cf260` (1,602 lines) with
`react-port` at `d27de40`, including the store refactor. The replacement targets
consumer-visible lifecycles, not parity in test counts.

| Previous behavior                                                                             | Assessment before this change                                               | Decision                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| DBC/raw/native source identity, overlapping IDs, FD/classical and multiplex decoding          | Covered by source-selection, signal-availability and core integration tests | Keep existing real-fixture coverage.                                                                                                                |
| Search, active-only filtering, collapsed children, empty groups and CAN-ID matching           | Covered by signal-availability, search-index and WebMCP tests               | Do not recreate synthetic selector catalogs. Search-time UI expansion is not restored as a store test.                                              |
| DBC diagnostics, malformed imports, byte limits, embedded imports and trace replacement       | Covered by source-selection and core integration tests                      | Keep existing coverage.                                                                                                                             |
| Saved library with one corrupt record; storage read failure must not erase saved files        | Worthwhile gap                                                              | Exercise failed read, later partial recovery, usable decoding and explicit deletion with real DBC bytes. Substitute only storage.                   |
| Duplicate imports, queued import/reset, later persistence/reload and handle cleanup           | Queued write/reset and reload covered; duplicate and app-owned cleanup gaps | Extend that lifecycle with content duplicates and prove a released handle rejects decoding.                                                         |
| Late decode after trace replacement                                                           | Covered by source-selection                                                 | Extend the same scenario to deselect/reselect and late failure delivery; keep actual successful worker responses.                                   |
| Selection/axis consistency and color release                                                  | Axis tools and color allocator covered separately; lifecycle gap            | Exercise decoded selection, reassignment, deselection and reselection together.                                                                     |
| Proportional Y zoom across changed primary/secondary signals; x-only navigation and reset     | Geometry and WebMCP time changes covered; changing signal domains missing   | One real-fixture plot lifecycle, with independently calculated ranges.                                                                              |
| Sampling budget, viewport escape and full detail after interaction rests                      | Edge bracketing and LTTB covered separately; plot pipeline gap              | One generated ASC lifecycle through real parsing, selection, windowing and chart-series construction. Check coordinates/data, not cache identities. |
| Trace warnings retained after failed replacement                                              | Core diagnostics covered; app retention gap                                 | Extend the existing diagnostics lifecycle with a rejected replacement.                                                                              |
| Cached view/list identity, Svelte reactive domain callbacks                                   | Intentionally obsolete assertions                                           | Identity and framework mechanics are replaceable; retain numerical outcomes only.                                                                   |
| Store-only default/no-op cases, exact worker call arguments, reset queue failure permutations | Deliberately not restored individually                                      | Low marginal value beside coherent lifecycle checks and package ownership/error tests. No new state-injection unit suite.                           |

The storage substitute does not prove IndexedDB itself. Plot integration proves
render inputs, not GPU pixels or browser gestures. No menu behavior is in scope.

This adds 294 net test lines (348 added, 54 removed), with no production changes,
new dependencies or committed fixtures. App tests total 2,484 lines versus 3,752
before the migration. The focused 11 scenarios and full `validate` pass, including
168 Vitest tests, 123 Rust tests and the installed-package production build.

Repeatable evidence (from a Nix shell, with `sfw` for local commands):

```sh
mkdir -p artifacts/react-coverage
nix develop -c pnpm run test:run src/lib/source-selection.integration.test.ts src/lib/plot-lifecycle.integration.test.ts --reporter=default --reporter=json --outputFile=artifacts/react-coverage/results.json
nix develop -c pnpm run validate
```

The JSON report retains scenario names, assertions and failures; fixture inputs
live in the repository, and the larger sampling trace is generated deterministically
inside its test rather than committed as a bulky fixture.
