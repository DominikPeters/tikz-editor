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

The Lezer, language, and fuzz packages reject non-null assertions in production
lint; the Lezer and language packages additionally reject unsafe type assertions.
Core's parsing modules retain their non-null assertion ban. These lint bans are
scoped independently of the compiler options; existing assertions elsewhere are
still candidates for a future audit.

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
