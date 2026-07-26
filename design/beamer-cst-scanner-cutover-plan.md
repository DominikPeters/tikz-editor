# Beamer CST Scanner Cutover Plan

**Status:** approved for implementation with review amendments (2026-07-26)

**Scope:** scanner/frontend infrastructure only

**Integration gate:** fold the final architecture and implementation status
into `design/beamer-editor.md` only after the cutover and all deletion gates
are complete.

## Decision

Replace Beamer's raw-source lexical scanner with the shared Lezer TeX
frontend before continuing substantial Beamer feature work.

This is a direct architectural cutover, not a long-lived migration:

- development may use small, reviewable commits;
- the workstream is not complete or mergeable while both lexical paths
  remain;
- there is no runtime feature flag, dual-scanner mode, or raw-source fallback;
- the legacy Beamer lexical helpers are deleted in the same workstream;
- Git history and characterization tests, rather than a retained legacy
  implementation, provide the parity oracle.

The resulting architecture is:

```text
Lezer TeX CST (Beamer dialect)
        |
        v
shared immutable TeX syntax index
        |
        +-- generic TeX lowering
        |
        +-- Beamer semantic projection
              frames, sections, overlays, themes,
              theorem declarations, recovery policy
```

Beamer retains its own semantic model. This cutover removes duplicated
lexical interpretation; it does not move frames, overlays, navigation,
theorem counters, or theme semantics into the generic text IR.

## Why cut over now

Beamer support is new, unshipped, and still under concentrated development.
There is therefore no compatibility reason to preserve an internal raw
scanner. Leaving the migration partially complete would instead establish two
authoritative interpretations of:

- control-sequence boundaries and stars;
- comments and escaped control symbols;
- balanced required, optional, and overlay arguments;
- environment boundaries;
- malformed-source recovery;
- opaque/verbatim-like regions;
- source spans.

The cutover should block further substantial Beamer feature work until its
deletion gate is satisfied.

## Current implementation inventory

### Shared TeX frontend

`packages/lezer-tex/src/grammar/tex.grammar` already provides:

- one document/fragment grammar;
- a Beamer dialect for structural and overlay command specialization;
- comments, whitespace, control words, and control symbols;
- groups, optional arguments, and overlay specifications;
- begin/end environment nodes;
- math delimiters and math environments;
- useful error recovery for incomplete input.

It does **not** currently provide opaque/verbatim tokenization. Bodies of
`verbatim`, `lstlisting`, `minted`, and related environments are parsed as
ordinary TeX, so literal `%`, unmatched braces, and structural-looking
commands can corrupt the CST before a post-parse masking pass sees them.
Parser-level opaque handling is therefore expected implementation work, not
an optional contingency.

`packages/core/src/text/tex/ir.ts` already contains a private
`simpleTexSyntaxIndex`. It parses with the shared CST and indexes:

- commands by start offset;
- comments, whitespace, and trivia;
- groups and optional arguments;
- environment boundaries and matched environments;
- math nodes.

This private index is the implementation seed. It must be extracted and split:
the shared index owns syntax only, while generic text lowering continues to
own math and text semantic nodes.

### Beamer raw lexical layer

`packages/core/src/beamer/scan.ts` currently owns:

- `scanBeamerControlSequences`;
- `scanBeamerEnvironmentTokens`;
- `readBeamerRequiredArgument`;
- `readBeamerOptionalArgument`;
- `readBeamerOverlayArgument`;
- `readControlSequence`;
- `readDelimitedValue`;
- `skipWhitespaceAndComments`;
- `skipComment`;
- manual section-command discovery;
- manual frame-option splitting and top-level `=` discovery.

The exported helpers are also consumed by:

- `packages/core/src/beamer/content.ts`;
- `packages/core/src/beamer/overlay.ts`;
- `packages/core/src/beamer/theorems.ts`.

`prepareBeamerDocument` currently scans document structure once, but frame
body and overlay passes independently rescan source ranges. The final design
must build one syntax index per prepared source revision and share it across
all these passes.

### Syntax parsing that is not part of this cutover

The following remain semantic parsers over already-delimited values and are
not legacy document scanners:

- overlay interval/specification decoding;
- dimension-expression evaluation;
- theme/component meaning;
- theorem counter and style semantics;
- macro expansion;
- TeX math atom parsing;
- TikZ parsing inside a discovered `tikzpicture`.

They may consume shared option/group utilities where appropriate, but they do
not need to become CST nodes merely to satisfy this cutover.

## Target syntax-index contract

Create an internal module:

```text
packages/core/src/text/tex/syntax-index.ts
```

It should expose an immutable, source-backed contract conceptually equivalent
to:

```ts
type TexSyntaxIndex = {
  readonly source: string;
  readonly controls: readonly TexSyntaxControlSequence[];
  readonly environmentBoundaries:
    readonly TexSyntaxEnvironmentBoundary[];
  readonly comments: readonly TexSyntaxSpan[];
  readonly whitespace: readonly TexSyntaxSpan[];
  readonly groups: readonly TexSyntaxDelimitedArgument[];
  readonly optionalArguments: readonly TexSyntaxDelimitedArgument[];
  readonly overlayArguments: readonly TexSyntaxDelimitedArgument[];
  readonly errors: readonly TexSyntaxErrorSpan[];

  controlsIn(range: Span): readonly TexSyntaxControlSequence[];
  environmentBoundariesIn(
    range: Span
  ): readonly TexSyntaxEnvironmentBoundary[];
  argumentAfter(
    offset: number,
    kind: "required" | "optional" | "overlay",
    limit: number
  ): TexSyntaxDelimitedArgument | null;
};
```

The exact TypeScript shape may differ, but the following properties are
required.

### Source ownership

- Every object has absolute half-open source spans.
- Values such as an environment name or argument body are slices of the
  indexed source, never separately scanned strings.
- Command tokens distinguish control words from control symbols.
- A starred control word records the star span separately while retaining a
  command span compatible with the existing Beamer model.

### Range queries

- Token arrays are source ordered.
- Range queries use binary search or equivalent indexing rather than scanning
  the source again.
- A query never returns a token that begins inside a comment or opaque region.
- Consumers may restrict argument lookup with a source limit, preserving the
  current protection against one malformed construct consuming a later frame.

### Trivia and argument association

- `argumentAfter` skips only CST-owned whitespace and comments.
- It accepts only a CST-owned argument node beginning at the resulting
  position.
- Required `{...}`, optional `[...]`, and overlay `<...>` arguments share one
  delimited-argument representation.
- Complete and recovered/incomplete arguments are distinguishable. Existing
  Beamer model builders may reject incomplete values, while diagnostics can
  still use their recovered spans.
- Nested groups, comments, escaped control symbols, and delimiters are defined
  by the CST, not by another character loop.

Overlay arguments are dialect specific. In the intended contract, top-level
`<...>` remains ordinary text under the generic TeX parser and becomes an
overlay argument only under the Beamer dialect. Stage 0 must characterize
both parser profiles. If necessary, Stage 1 should dialect-gate
`OverlaySpecification` itself rather than merely filtering an already
misclassified generic CST node in the index.

### Environment boundaries

The shared syntax index exposes a flat sequence of source-backed begin/end
boundaries. It does not trust generic CST nesting as Beamer's semantic pairing
rule.

Each boundary records:

- `kind: "begin" | "end"`;
- normalized environment name;
- complete boundary span;
- command span;
- name/content span;
- whether CST recovery affected the boundary.

Beamer continues to perform name-aware pairing from this flat sequence. This
preserves its ability to diagnose nested frames, ignore unrelated environment
ends, and discover later frames after malformed content.

The generic text frontend may derive its matched-environment lookup from the
same boundary sequence, but that lookup is a consumer projection rather than
a second lexical interpretation.

### Opaque environments

The initial opaque set remains:

- `BVerbatim`;
- `Verbatim`;
- `alltt`;
- `lstlisting`;
- `minted`;
- `semiverbatim`;
- `verbatim`;
- `verbatim*`.

Opaque handling must occur at parser/tokenizer level, before ordinary comment,
group, command, or environment tokenization can interpret the body.

The expected implementation is a context-tracked Lezer external tokenizer,
or an equivalent shared parser-level mechanism, that:

1. recognizes entry into one of the supported opaque environments;
2. records the active opaque environment name in parser context;
3. emits an `OpaqueEnvironmentBody`-style token through the environment's
   valid terminator;
4. prevents literal `%`, unmatched braces, and frame-looking commands inside
   that body from becoming ordinary TeX tokens;
5. resumes ordinary TeX tokenization at the matching opaque end boundary;
6. retains a recovered body-to-limit token and parser error when no valid
   terminator exists.

The exact mechanism may differ if Lezer experiments reveal a cleaner shared
solution, but post-parse masking by itself is not sufficient and a private
Beamer source scanner is not acceptable.

Termination rules must be established from the LaTeX/package sources for each
supported family. Do not assume one universal substring rule: core LaTeX
`verbatim`/`alltt`, FancyVerb-style environments, `listings`, and `minted`
may impose different line, whitespace, or delimiter constraints.

The syntax index still masks structural queries inside the opaque token/span
as a defensive invariant. There is no
`source.indexOf("\\end{...}")` fallback in Beamer code.

## Recovery invariants

The syntax service and Beamer projection must preserve these editor-state
invariants:

1. A missing `\begin{document}` still scans the whole source.
2. A missing `\end{document}` retains frames through end of source.
3. An incomplete frame remains in the frame inventory.
4. An unmatched `\end{frame}` is diagnosed without hiding later frames.
5. A nested frame is diagnosed deterministically.
6. A mismatched non-frame environment cannot prevent discovery of a later
   frame.
7. Frame-looking text inside comments or opaque environments is never
   structural; opaque tokenization takes precedence, so `%` inside an opaque
   body is content rather than a TeX comment.
8. A malformed argument cannot consume across the current frame/document
   limit.
9. Partially typed commands and arguments do not throw.
10. All retained spans remain within source bounds.

These are product behavior, not temporary parity details. The new path may
improve diagnostics, but model changes must be deliberate and covered by
tests.

## Implementation workstream

All stages below belong to one cutover workstream. Intermediate commits may
compile with the new index not yet used by Beamer, but the workstream must not
be considered complete or merged until Stage 6 deletes the old path.

### Stage 0 — Freeze behavior with characterization tests

Before extracting code:

1. Add a focused `test/tex-syntax-index.spec.ts` fixture table covering:
   - control words, control symbols, and starred commands;
   - comments after commands and between arguments;
   - nested required/optional/overlay arguments;
   - the same `<...>` source under generic and Beamer parser profiles,
     asserting generic text versus Beamer overlay ownership;
   - escaped delimiters;
   - well-formed, mismatched, and incomplete environments;
   - every opaque environment name, with terminators matching the applicable
     package's actual lexical rules;
   - opaque bodies containing unmatched `{` and `}`;
   - literal `%` in opaque bodies, including `%` before a textual
     `\end{...}` on the same line, with expectations derived from the
     relevant package's real termination rule;
   - `\begin{frame}` and `\end{frame}` inside opaque bodies;
   - missing opaque terminators;
   - later-frame recovery after malformed environments.
2. Extend `test/beamer-document-scan.spec.ts` with:
   - mismatched environment names before and inside frames;
   - incomplete frame headers;
   - an unterminated opaque environment;
   - fake frame delimiters in every opaque-family representative;
   - escaped percent/control-symbol cases.
3. Add a normalized model projection helper for tests so frame, section,
   preamble, overlay, and diagnostic spans can be compared without keeping an
   old runtime scanner.
4. Record the current intended outputs as assertions. Where current raw
   behavior is demonstrably wrong, mark the desired CST behavior explicitly
   rather than enshrining the bug.
5. Add `scripts/benchmark-beamer-frontend.mjs` (or an equivalently focused
   benchmark) measuring both `scanBeamerDocument` and
   `prepareBeamerDocument` on the largest available corpus deck:
   - run enough warm iterations to report median and p95;
   - record source size and frame count with the result;
   - record the pre-cutover baseline artifact before changing the scanner;
   - keep benchmark output machine-readable enough for before/after
     comparison.

**Gate:** the recovery contract is testable independently of rendering and a
repeatable pre-cutover latency baseline has been recorded.

### Stage 1 — Extract the shared syntax index

1. Move syntax-only parts of `simpleTexSyntaxIndex` from
   `packages/core/src/text/tex/ir.ts` into
   `packages/core/src/text/tex/syntax-index.ts`.
2. Parse with the caller-selected shared parser:
   - generic TeX uses `texDocumentParser`/`texFragmentParser`;
   - Beamer documents use `beamerDocumentParser`.
3. Keep semantic math-node construction in `ir.ts`.
4. Add source-ordered arrays and range-query indexes.
5. Add flat environment-boundary extraction independent of name matching.
6. Add argument association and recovered-node status.
7. Implement parser-level opaque bodies, expected to require:
   - a Lezer context tracker carrying the active opaque environment;
   - an external tokenizer that emits an opaque body/recovery token;
   - tokenizer precedence over `Comment`, groups, and ordinary control
     sequences while the opaque context is active;
   - source-backed begin/body/end spans exposed through the syntax index.
8. Verify opaque terminator behavior against the installed LaTeX/package
   sources and encode those rules in tests.
9. Dialect-gate overlay specifications so the generic parser retains
   top-level angle-bracket text while the Beamer parser indexes overlays.
10. Retain a bounded immutable-source cache only if it has one clear owner.
    Cache identity must include parser identity—at minimum top rule and
    dialect—in addition to source. A parser-keyed `WeakMap` is preferable to
    an ad hoc string key. Prepared Beamer documents should pass an index
    explicitly rather than relying on the global cache.
11. Harden `packages/lezer-tex/src/grammar/tex.grammar` wherever Stage 0
    demonstrates missing or unstable syntax nodes.

**Gate:** syntax-index tests and existing generic TeX tests pass.

### Stage 2 — Make generic TeX use the extracted service

1. Replace private command, trivia, group, optional-argument, and environment
   maps in `ir.ts` with the shared index.
2. Build generic matched-environment projections from shared flat
   boundaries.
3. Keep generic semantic caches separate from the syntax index.
4. Delete the private `SimpleTexSyntaxIndex` type and constructor.

This stage prevents the new module from becoming a Beamer-only facade and
establishes one authoritative CST interpretation before the Beamer switch.

**Gate:** all generic TeX IR, shaping, VList, graphics, and fuzz tests pass.

### Stage 3 — Port document and preamble scanning

Introduce an internal Beamer frontend context:

```ts
type BeamerSyntaxContext = {
  readonly source: string;
  readonly syntax: TexSyntaxIndex;
};
```

Then:

1. Construct it with the Beamer-dialect parser.
2. Port document-range discovery to flat environment-boundary queries.
3. Port frame candidate collection while retaining Beamer's current
   name-aware frame recovery and diagnostics.
4. Port frame-header argument association.
5. Port section/subsection discovery to control-sequence range queries.
6. Port document class, themes, metadata, `\AtBeginSection`,
   `\newtheorem`, and theorem-template reads.
7. Replace manual frame-option splitting with the shared
   `OptionListAst`/top-level option parser, adapting results into the existing
   `BeamerFrameOption` model.
8. Keep `scanBeamerDocument(source)` as the public convenience entry point;
   it creates one syntax context and delegates to an internal context-taking
   implementation.
9. Keep `scanBeamerDocumentClass(source)` as a convenience API for document
   kind detection, backed by the same index contract.

**Gate:** existing document models and diagnostics match intended
characterization outputs with no raw lexical helper used by `scan.ts`.

### Stage 4 — Port frame content, overlays, and theorem occurrence scanning

1. Add the syntax index to the private `BeamerRenderContext`.
2. Have `prepareBeamerDocument` construct exactly one index for its source
   revision.
3. Pass that index to:
   - `parseBeamerFrameBody`;
   - `scanBeamerFrameOverlays`;
   - theorem occurrence discovery;
   - frame-step-count queries.
4. Port `content.ts` environment discovery and argument reads.
5. Port `overlay.ts` command, list-environment, and argument discovery while
   leaving overlay-spec semantics unchanged.
6. Port `theorems.ts` environment discovery.
7. Preserve public convenience APIs by building a local index when no
   prepared context is supplied. Do not put the CST/index onto the public,
   serializable `BeamerDocumentModel`.
8. Verify that a prepared document performs one document parse rather than
   reparsing each frame or overlay step.

**Gate:** prepared and one-shot rendering produce identical models and
overlay counts.

### Stage 5 — Recovery and corpus hardening

1. Run every Stage 0 malformed fixture through document scan, frame-body
   lowering, and overlay scan.
2. Add name-aware environment-pairing tests for columns, blocks, theorem
   environments, lists, and TikZ pictures.
3. Run the complete built-in-theme conformance and KKT fixtures.
4. Run the Beamer corpus scanner and compare frame/section/construct counts.
5. Inspect parser error spans for incomplete-edit fixtures; errors may be
   present, but later structural tokens must remain discoverable.
6. Fix recovery in the grammar or shared index. Do not add source scanning to
   Beamer as a shortcut.
7. Re-run the Stage 0 frontend benchmark under the same runtime, source, warmup,
   and iteration settings.
8. Compare before/after median and p95 for both document scanning and prepared
   document construction. Attach the comparison artifact to the implementation
   handoff.
9. Treat a material latency regression as a review blocker. Record the
   baseline before choosing the numerical budget; once recorded, add the
   agreed absolute/relative budget to the benchmark and this plan rather than
   accepting a regression implicitly.

**Gate:** all recovery invariants hold, corpus counts have no unexplained
regressions, and the measured latency comparison is within the agreed budget
or has received an explicit architectural review.

### Stage 6 — Delete the legacy path

Delete from `packages/core/src/beamer/scan.ts`:

- `scanBeamerControlSequences`;
- `scanBeamerEnvironmentTokens`;
- `readBeamerRequiredArgument`;
- `readBeamerOptionalArgument`;
- `readBeamerOverlayArgument`;
- `readControlSequence`;
- `readDelimitedValue`;
- `skipWhitespaceAndComments`;
- `skipComment`;
- manual top-level frame-option delimiter scanning.

Also:

1. remove all imports of those functions from Beamer modules;
2. remove `OPAQUE_ENVIRONMENTS` handling from the old scanner after the
   syntax-index implementation owns it;
3. search `packages/core/src/beamer` for document-structural character loops,
   `source.indexOf` environment discovery, and direct control-sequence regexes;
4. classify every remaining source-string parser as semantic-value parsing or
   replace it with a shared syntax/option utility;
5. remove any temporary parity adapters and migration-only tests;
6. retain permanent characterization and recovery tests.

**Hard merge gate:** this deletion stage is mandatory. The cutover must not
merge with either scanner path retained as a fallback.

## Commit and review discipline

Recommended local commit sequence:

1. `Test and benchmark TeX syntax-index recovery contract`
2. `Tokenize opaque TeX environments in Lezer`
3. `Extract shared TeX syntax index`
4. `Use shared syntax index in generic TeX lowering`
5. `Move Beamer document scanning to TeX CST`
6. `Move Beamer content and overlays to TeX CST`
7. `Delete legacy Beamer source scanner`
8. `Document approved Beamer CST architecture`

These commits are for reviewability and bisectability, not independent
stopping points. Commits 1–7 form one required implementation series.
Commit 8 folds the approved result into `design/beamer-editor.md`.

During the series:

- do not add unrelated Beamer rendering features;
- do not introduce a scanner-selection option;
- do not preserve the old path for performance;
- do not merge a partial series to the release branch.

## Verification

Focused gates:

```sh
npx vitest run \
  test/lezer-tex.spec.ts \
  test/tex-syntax-index.spec.ts \
  test/tex-ir.spec.ts \
  test/beamer-document-scan.spec.ts \
  test/beamer-frame-content.spec.ts \
  test/beamer-overlay.spec.ts \
  test/beamer-theorem.spec.ts \
  test/beamer-prepared-document.spec.ts
```

Repository gates:

```sh
npm run typecheck
npm run lint:prod
npm test
```

Performance gate:

```sh
node scripts/benchmark-beamer-frontend.mjs \
  --input path/to/largest-corpus-deck.tex \
  --json
```

Run this before and after the cutover with identical runtime, warmup, and
iteration settings. Preserve both machine-readable results and a summarized
median/p95 comparison.

Beamer-specific artifact/corpus gates:

- KKT deck retains 20 frames and existing section/navigation topology;
- overlay step counts remain stable;
- built-in-theme conformance gallery generation succeeds;
- Beamer corpus frame and construct counts have no unexplained changes;
- malformed-source tests demonstrate later-frame recovery;
- prepared-document instrumentation demonstrates one shared syntax parse per
  source revision;
- frontend scan/prepare latency remains within the post-baseline agreed
  absolute/relative budget.

## Definition of done

The cutover is complete only when all of the following are true:

- generic TeX and Beamer consume the extracted shared syntax index;
- one prepared Beamer source revision owns one Beamer-dialect CST/index;
- syntax-index caches cannot cross parser top-rule or dialect identities;
- Beamer semantic pairing remains name aware and independently tested;
- opaque bodies are recognized at parser/tokenizer level before comment,
  group, and command lexing;
- comments and opaque environments cannot emit false structural tokens;
- generic angle-bracket text and Beamer overlay specifications retain
  dialect-correct ownership;
- incomplete and mismatched source retains later-frame discovery;
- frame, section, preamble, content, overlay, and theorem spans remain
  source-backed;
- the legacy raw lexical helpers are deleted;
- no runtime fallback or dual-scanner switch exists;
- focused, full-repository, corpus, and artifact gates pass;
- before/after frontend latency is measured and within the agreed budget (or
  explicitly reviewed);
- the approved architecture and final implementation status are folded into
  `design/beamer-editor.md`.

## Explicitly deferred work

The cutover does not itself implement:

- incremental editor reparsing with `TreeFragment`;
- macro expansion before Beamer structural projection;
- new Beamer commands, environments, or themes;
- editor caret/selection behavior beyond preserving syntax spans;
- performance optimization beyond avoiding repeated prepared-document parses
  and meeting the agreed regression budget.

The syntax-index API should remain compatible with later incremental parsing,
but correctness and deletion of the duplicate scanner take precedence in this
workstream.
