# Beamer fidelity failure accounting

Earlier reports mixed bugs, failing frames, and successful native warm/cold
comparisons. Warm/cold agreement does not establish LuaLaTeX fidelity. The
complex campaigns were not clean, and every outstanding failure should have
been disclosed alongside successful fixes.

## Current checkpoint

| Original campaign | Frames passing | Overlay states | Final live acceptance |
| --- | ---: | ---: | --- |
| Seed 20261106 | 22/22 | 40 | Pass |
| Seed 20261107 | 39/39 | 81 | Pass |

All 61 original frames and 121 overlay states pass independent live LuaLaTeX
structural and paint checks on the same final frozen renderer. Original source
hashes and the renderer fingerprint were verified after both runs. Reports are
`artifacts/beamer-fuzz/original-20261106-post-gates-live/report.json` and
`artifacts/beamer-fuzz/original-20261107-post-gates-live/report.json`; the source
checkpoint is `artifacts/beamer-fuzz/final-renderer-post-gates.json`.
No tolerances were relaxed and no oracle exclusions were introduced for these
campaigns. These are frame observations, not distinct bug counts: one frame can
contain several bugs, and one bug can affect several frames. Passing reductions
alone did not close any original failure.

`beamer-failure-ledger.json` retains every original failure, the current report
for each observation, independent controls, verification failures, and limits.
Original sources remain in `test/fixtures/beamer/fuzz-open-compositions/`.
Fresh acceptance manifests copy every original frame with verified identical
source hashes under `fuzz-original-seed-20261106/` and
`fuzz-original-seed-20261107/`. Distinct files per frame avoid overwriting a
multi-frame document's oracle when pinning regressions.

## What failed and what changed

- **Scope and composition:** recursive blocks/columns inside lists, formatting
  groups, and subtitles lost inherited fonts, alignment, widths, or overlay
  context. Macro expansion, local restoration, and later redefinitions also
  needed correct scope ownership. Controls retain the complete combinations.
- **List labels:** descriptions incorrectly counted toward body-font depth;
  pending parent labels could disappear, get the wrong font or projected marker,
  or paint under the owner's visibility rather than the consumer's. Labels now
  retain their original owners and execute in the consuming paragraph's context.
  Numbered article labels also preserve their inherited font style when a
  captured point size is applied.
- **List/display boundaries:** child-list entry/exit, changes of parent item,
  explicit paragraphs, action-environment closure, and plain versus wrapped
  displays have different paragraph/glue behavior. Treating them alike added or
  dropped empty lines and skips. The renderer now preserves those distinctions.
- **Size registers:** Beamer's smaller list fonts change display and first-level
  list registers; explicit fontsize preserves installed display registers.
  Font size/baseline selections restore at environment and item-action boundaries.
  Display-spacing selection uses the active font quad, including narrow cases
  immediately on either side of the short-display threshold.
- **Alignment environments:** center/flushleft/flushright can start with an empty
  paragraph, inherit a pending label, and override surrounding alignment.
  Infinite leading glue affects display spacing even for one character.
  Labels belong to the nearest item through these environments.
- **Physical box references:** display-only columns, active table struts, and a
  first structural box differ from the first later prose line. Column entry uses
  the physical box's height and active baseline. Rounded block bodies retain T
  columns' negative head skip, preserve interline state after intermediate block
  skips, and remove terminal minipage glue once. Boadilla uses rounded bodies too.
- **Frame fitting:** top-aligned frames must include the natural .2cm top skip
  when compressing glue; the outer list's glue capacity applies when its larger
  spacing wins a shared boundary.
- **TikZ and paint:** ambient fonts/em dimensions, PGF cubic bounds including
  control points, and nested Rose/Orchid background aliases needed corrections.
  Covered geometry remains part of strict comparisons.
- **Editing across branches:** the expanded fixture corpus fed the keystroke
  fuzzer and exposed an outdent that moved an item outside its list while leaving
  it inside an overlay argument. Outdenting now requires direct containment by a
  parent item; alt/only/visible branch boundaries retain their structure.

V7 and V9–V37 contain independently compiled, source-hash-checked regression
controls. V35 deliberately retains six initially passing controls alongside the
complex column reduction that initially failed. Earlier V24 structural agreement
was not accepted while transferred markers and eight paint probes still failed;
only its final full live run closed that case. The suspected hidden-label oracle
bug was rejected: the oracle was right. No tolerance relaxation or oracle
exclusion was used to make a renderer failure pass.

## Verification and operational failures

The final full repository suite passes **8,552 tests**, with **23 skipped and
one todo**: 524 test files pass and two are skipped. This includes all **392
pinned independent fidelity cases** and the expanded editing-sequence fuzzer.
Final typecheck and production lint pass. The logs are
`/tmp/beamer-final-full-suite-verified.log`,
`/tmp/beamer-final-typecheck-verified.log`, and
`/tmp/beamer-final-production-lint-verified.log`.

The first final suite found two failures after 8,508 tests passed: upright article
labels after an italic declaration, and an outdent across an overlay argument
boundary exposed by the expanded corpus. Both were fixed in separate commits;
445 targeted tests passed before repeating the entire suite and both live
campaigns. The first production lint run also rejected an optional boolean OR;
an explicit boolean test resolved that without changing semantics.

Earlier full/broad runs did expose regressions: alignment and generated previews,
bibliography dimensions, and Beamer-only metadata leaking into generic reports.
Those were fixed and rechecked; their original failures remain in the ledger.
An overlapping dist build caused one live run to fail before comparison; its
serialized-build retry passed. Disk exhaustion interrupted a replay and prevented
a test run from collecting tests. Those interrupted runs are not acceptance
evidence. Complete retries and the resource recovery are recorded separately.

Saved replays retain all state summaries, source hashes, and every failing state's
full comparison/renderer output. Passing graphics can be regenerated with
`--keep-passing-artifacts`. Redundant passing replay graphics were removed and
older diagnostics compressed losslessly; original sources and independent TeX
references were retained.

## Coverage limits

These campaigns do not establish arbitrary TeX support. The ledger separately
tracks unverified heading struts, named sizes in overlay-picture text, generic
font-declaration groups with block children, and direct rounded-background edge
coverage. Native edit parity, typecheck, lint, and independent fidelity are
separate gates. Every original frame and overlay state in the two campaigns
above passes the final live structural and paint contracts.

An older raster-oracle limitation also remains documented in
`test/fixtures/beamer/fuzz-findings-v2/README.md`: the
`large-relative-overlay-glyph-edge` case has a one-pixel letter-counter mask
mismatch at 1600px. It explicitly uses 3200px and passes the same strict contract;
the original 1600px mismatch is retained. This is separate from the 61 complex
frames above and is not being presented as a renderer fix.
