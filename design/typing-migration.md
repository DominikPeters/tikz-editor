# Stricter typing rollout

All production TypeScript is checked with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` through `tsconfig.prod.json`. This includes core,
the shared editor, and the web, desktop, and landing shells. `npm run typecheck`
runs this check; `npm run typecheck:prod` runs it directly. Production ESLint uses
the same project so its type-aware rules agree with these options.

The options are also enabled in the standalone package configs:

- `packages/lezer-tex`
- `packages/lezer-tikz`
- `packages/lang-tikz`
- `packages/tex-fuzz`
- `packages/core`
- `packages/app`

Production lint rejects non-null assertions, unsafe narrowing assertions, and
unnecessary conditions throughout all packages and app shells. Hook dependencies
and useless assignments are errors throughout production too. These rules share
one production configuration rather than directory-specific rollouts.

Prefer precise discriminated unions and readonly input contracts to narrowing
casts. Validate serialized font and fuzz data before assigning domain types.
The remaining assertion exceptions are documented at the individual operation:
phantom unit constructors, internal shape-preserving transformations, generic
container relationships that TypeScript cannot express, and a platform wire enum
without a runtime export. Serialized layout copies omit optional executable
metadata rather than retain objects missing their required methods. Keep
exceptions local rather than excluding a whole file or directory.

`typecheck:strict-packages` builds dependencies before checking production and
standalone fuzz types, so clean checkouts do not rely on stale declarations.
The temporary parser-only core config has been replaced by the full core check.

The root test/tooling project keeps its existing compiler settings. Migrating
test fixtures and tooling to both options remains separate work; production
files are still enforced by the production project even when imported by tests.

Prefer iterating values with
`entries()`, checking required lookups, and omitting absent optional fields.
Random generation must retain its choice order so recorded seeds remain replayable.
Avoid bulk non-null assertions or widening every optional property to accept
`undefined`: those approaches would discard the checks this rollout adds.
An omitted optional field inherits a value when spread onto an existing object;
an intentional reset must delete the copied field or use an explicitly modeled
clearable state slot. Required collection helpers are for invariants; EOF,
neighbor, and optional lookup probes must keep their fallback behavior.
