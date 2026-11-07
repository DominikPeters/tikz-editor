# Beamer fidelity failure accounting

The earlier updates mixed distinct renderer bugs, failing frame observations,
and successful warm/cold comparisons. “Zero mismatches” in an editing run only
meant its two native render paths agreed; it did not establish agreement with
LuaLaTeX. That wording overstated the evidence. The original richer campaigns
were not clean, and their outstanding failures should have been stated every
time a fix was reported.

## Saved observations

- Seed 20261106: 22 frames, 40 states; the baseline at commit f65c9e8d passed
  16 frames and failed six.
- Seed 20261107: 39 frames, 81 states; the same baseline passed 27 frames and
  failed the 12 richly composed first frames. The other frames are materially
  simpler. Their success is not evidence that the compositions work.
- Two earlier reduced v7 observations both failed. One was mislabeled: the
  original `grouped-columns.tex` put its group immediately after the frame title,
  so Beamer parsed it as a subtitle. The original is retained separately as
  `columns-in-subtitle.tex`; the corrected body repro adds `\relax`.

These are observations, not a count of independent bugs. A frame can contain
multiple bugs, and one bug can affect many frames/states. Exact per-observation
results and report locations are recorded in `beamer-failure-ledger.json`.
Unresolved campaign sources are preserved in
`test/fixtures/beamer/fuzz-open-compositions/cases.json`; they must not silently
become part of the passing frozen collection or have their tolerances widened.

## Root causes established during the current investigation

- Structural columns were not recursively prepared within columns.
- Native text containers (lists, brace groups, subtitles) could not host Beamer
  structural boxes; environment delimiters became literal output.
- Formatting declaration scopes and interleaved alignment/size/color declarations
  were not consistently retained across those structural boundaries.
- Embedded TikZ font commands used standalone class sizes and reset ambient
  family/weight. Font-relative node padding also used the node text font where
  PGF uses the ambient font.
- Inline math could use the outer paragraph size despite a smaller list font.
- Description nesting incorrectly advanced the itemize/enumerate font-depth
  counter. Nesting across structural boxes also lost font context.
- A covered columns container retained space but dropped its paragraph/TikZ
  layout records, preventing strict verification of the hidden geometry.
- An overlay item ending in display math lost the empty resumed paragraph that
  Beamer's closing action environment commits.
- Top-aligned shrinking frames omitted natural top skip and included that skip
  in the amount of space available to the scaled body.
- A rounded block beginning directly with display math selected the normal
  above-display skip instead of the short skip (an 11pt error in the reduction).

Independent small controls have verified several of these corrections. The
entire complex campaigns remain the acceptance gate; a passing reduction does
not close a failing campaign observation.

## Additional failing controls retained during reduction

The block-in-list reduction originally had prose before its block. Expanding
it to a block as the first item content revealed incorrect empty-paragraph,
label placement, and boundary glue behavior. Description lists under scoped
font sizes also expose incorrect horizontal margin conversion. Both are open
until their strict independent controls pass. Existing complex frames still
show further geometry/font mismatches; those are not dismissed as complexity
or treated as fixed by the smaller controls.

## Verification rules

Use independent LuaLaTeX traces, source identity checks, every overlay state,
and the unchanged strict structural contract. Saved-trace replays accelerate
triage; final passing cases also need the live raster/paint checks. The replay
records a source fingerprint and rejects a run if source changes during it.
Per-state exceptions remain failures and do not prevent later cases being
examined. Regression tests, typecheck, and production lint are separate gates.

## Verification checkpoint during fixes

The older saved campaign remains 16/22 passing; the newer is 29/39 passing
(40 and 81 states respectively). Two previously failing composed frames now
pass every overlay state. V7's three corrected/preserved controls, V9's six
controls, the 12 expanded list/block cases, and the three curved-picture block
cases pass live comparisons. Separate reductions exposed eight failing nested
list-head controls; a pending-label ownership correction is under verification.
Their source inputs are also preserved in the open-composition manifest.

Two isolated corrections have been committed separately: `058ba08f` retains
ambient TikZ font context and em geometry; `9c690754` includes cubic control
points in PGF picture bounds. The larger recursive-flow work remains under
verification. This checkpoint is not a claim that the full campaigns are clean.
