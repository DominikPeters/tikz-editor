# Native pgfplots support

Status: proposal, 2026-11-27. Nothing here is implemented on master.

Supersedes the pgfplots parts of `design/addon-architecture.md`.

## 1. Decision

pgfplots support is built **in-tree, under MIT, as an independent implementation**:
written from the pgfplots manual, and corrected against LuaLaTeX output used as a
black-box oracle. There is no add-on system and no licence boundary inside the app.

How we got here:

- pgfplots is GPL-3-or-later only. Translating its TeX source to TypeScript would be a
  derived work, so any build that shipped it would be GPL-3 as a whole. That conflicts
  with App Store distribution (iPad, possibly Mac) and with being able to say "the
  editor is MIT" without footnotes.
- The add-on system was designed to isolate that GPL code. It only helps if the add-on
  is distributed separately; bundled, it is the same combined work. Its API facade
  (host services instead of direct imports) also cost real capability: the October
  prototype had to fall back to full reparse and full re-evaluation for any document
  that used an add-on.
- An independent implementation removes the problem instead of managing it. Running
  pgfplots and measuring what it draws is not copying it.
- tikz-cd and tcolorbox are LPPL, and circuitikz is dual LPPL/GPL. Like PGF itself they
  can be implemented with the source open. Only pgfplots needs the rules in section 2.

Earlier work, for reference only:

| Where | What | State |
|---|---|---|
| branch `claude/web-app-env-setup-zzu7jw` (July) | add-on system phases A–D, UI contributions, toy add-on | committed, 1022 commits behind master |
| Codex worktree `~/.codex/worktrees/pgfplots-addon/tikz-editor` (October) | `addon-api`, add-ons for pgfplots, circuitikz, tikz-cd, tcolorbox | **uncommitted**, 550 commits behind master |

Neither is a base for this work. Section 9 lists what is worth mining from them.

## 2. Independence rules

"Clean room" here means an independent implementation from documentation and observed
behaviour. It is not a two-team legal clean room, and a language model has probably seen
some upstream source in training. For a reimplementation of documented behaviour in a
different language this is low risk, but these rules are what make the claim honest.

**Allowed**

- The pgfplots manual (its text, tables, documented defaults, documented key names).
- Compiling any document with pgfplots and observing the result: PDF, log, anything
  the PGF driver layer or LuaTeX's page builder exposes.
- Reading the *value* of a documented key or documented macro at run time
  (`\pgfkeysvalueof{/pgfplots/xmin}` after an axis, a documented length).
- PGF/TikZ source (`pgf-src`), which is LPPL. Number printing
  (`\pgfmathprintnumber`), the math engine, plot handlers and plot marks live there.

**Not allowed**

- Opening pgfplots implementation files: `*.code.tex`, `pgfplots*.sty`, its Lua files,
  in any checkout or in the TeX Live tree.
- Dumping definitions: `\meaning`, `\show`, `\tracingmacros`, `\tracingassigns` on
  pgfplots internals. A definition is source text, even when it arrives through the log.
- Using undocumented internal macro names in the implementation or as oracle probes.
- Committing manual example snippets as fixtures. The manual sources carry the same
  GPL header as the package, so fixtures are written by us.

**Housekeeping**

- `examples/pgfplots` (an upstream clone inside the repo) was deleted on 2026-11-27.
- `~/GitHub/pgfplots` and `~/GitHub/pgfplots-html-manual` still hold full upstream
  trees. The second is where the manual source lives
  (`doc/latex/pgfplots/*.tex`), next to `tex/` and `source/`. The manual sources
  alone are copied to an untracked `pgfplots-docs/` in this repo (done 2026-11-27,
  without the build helpers `*.code.tex`, `*.sty`, `*.lua` and without the developer
  notes on internals), so agents have a reference directory with no implementation.
- `AGENTS.md` states the rule in its project map (added 2026-11-27).
- Every delegated agent brief repeats the rule; agents search widely by default.
- Keep a behaviour log (section 5.6). Besides being useful engineering, it is the
  record that each rule came from the manual or from an experiment.

## 3. What master looks like today

Verified by reading master on 2026-11-27.

- **Parsing.** There is no generic environment rule. `\begin{axis}` lexes as an
  `UnknownStatement` running to the next `;`, and the following
  `\end{axis} \draw …;` becomes a second unknown statement, so a valid `\draw` after
  the axis is silently swallowed. The scene comes out empty with an
  `unsupported-statement` warning. Only `\begin{scope}` has a rule.
- **Evaluation.** `evaluateStatement` is an if-chain on `statement.kind` returning
  `SceneElement[]`; the element union is path, circle, ellipse and text. Clip paths,
  layers, named coordinates and named node geometry all exist.
- **Coordinate systems.** No registry. `parseExplicitCoordinate` hardcodes
  `perpendicular` and `intersection` and treats every other `name cs:` as canvas, so
  `axis cs:` would currently be misread rather than rejected.
- **TikZ `plot`.** Coordinates and expression plots work, with handlers sharp, smooth,
  const, comb, bar and interval variants, and only-marks. Only the marks `x`, `+`, `*`
  are drawn.
- **pgfmath.** A solid evaluator, but no hyperbolic functions, `ifthenelse`, arrays,
  `declare function`, fpu, or `\pgfmathprintnumber`.
- **Keys.** `/.style`, `.append style`, `.prefix style`, `.style n args` work in the
  `/tikz/` tree only. No `/pgfplots/` tree, no `\pgfplotsset`, no `.code`.
- **Generated nodes.** `graph.ts` builds synthetic `NodeItem`s and calls
  `evaluateNodeItem`; that is the precedent for tick labels, axis labels and legends.
- **Incremental evaluation.** Any statement that is not a Path or Scope is classed
  `unsafe` for suffix skipping and forces replay of everything after it. Parser
  identity alignment only understands Path and Scope.
- **Editing.** Property targets, inspector sections and statement lookup are keyed on
  known kinds. About 65 non-test sites test `kind === "Scope"`.
- **Export.** The standalone exporter always writes `\usepackage{tikz}` plus inferred
  TikZ libraries. There is no way to require a package or carry `\pgfplotsset`.
- **Beamer.** Slides render pictures through the same pipeline, so an axis inside a
  `tikzpicture` on a slide works with no beamer-specific code.

## 4. Architecture

pgfplots becomes a feature area of core: `packages/core/src/pgfplots/`. It imports the
evaluator, node layout, styles and pgfmath directly. Whether it later moves to its own
workspace package (for lazy loading) is a bundling decision, not a design one.

### 4.1 Grammar and AST

In-tree means real grammar rules, which the add-on design could not have (Lezer tables
are frozen at build time, so add-ons had to hand-parse raw slices).

- `AxisStatement`: `\begin{axis|semilogxaxis|semilogyaxis|loglogaxis}[options] body
  \end{…}`, valid inside a picture or scope. Later environments (`groupplot`,
  `polaraxis`) join the same rule.
- Axis body statements: `\addplot` / `\addplot+` / `\addplot3` with their option list,
  input form and trailing path; `\addlegendentry{…}` (no semicolon);
  `\legend{…};`; `\pgfplotsset{…}`; and every ordinary TikZ statement.
- `\addplot` input forms as distinct nodes: `coordinates {…}`, expression `{…}` and
  parametric `(…,…)`, `table [opts] {inline rows or file name}`. Inline table data is
  whitespace- and newline-significant, so it stays one raw token and is parsed by a
  small dedicated reader.
- `\pgfplotsset{…}` also becomes a statement outside the axis and in the preamble.
- A **generic environment fallback** for any other `\begin{x}…\end{x}` inside a
  picture, so an unsupported environment is skipped as one unit and no longer eats
  the statements after it. This fixes today's bug independently of pgfplots and is
  worth landing first.
- Ids follow the existing scheme: `axis:N`, `axis:N:plot:M`, with nested TikZ
  statements keeping their own ids. Parser identity alignment learns the new kinds so
  an edit inside an axis reparses one statement.
- `walkStatements` and the Scope-testing call sites are audited once; an axis is a
  container, like a scope, for traversal, deletion, reordering and the objects panel.

### 4.2 Evaluation

An axis cannot be evaluated statement by statement: limits depend on every plot, the
transform depends on the limits, and embedded TikZ needs the transform. The axis
evaluator is a small pipeline of mostly pure stages:

1. **Resolve options.** Merge `\pgfplotsset` defaults, `every axis` styles,
   environment options, per-plot options and cycle-list entries into a typed model.
2. **Collect data.** Parse coordinates and tables; sample expressions through pgfmath.
3. **Limits.** Explicit limits, automatic ranges, enlargement, log domains, `axis
   equal` and unit-vector constraints.
4. **Ticks.** Positions (automatic, explicit, distance-based, minor), then labels
   through number formatting, including the scaled-tick common factor.
5. **Layout.** Size model (`width`, `height`, `scale only axis`), the data-to-canvas
   transform, description placement, legend geometry, outer bounding box, and finally
   the position of the whole axis from `at` and `anchor`.
6. **Emit.** In the manual's documented layer order: grids, ticks, axis lines, plot
   paths and marks under the axis clip, embedded TikZ, descriptions, legend.

Stages 1–5 produce an `AxisLayout` value with no scene elements, which is what the
oracle compares against first (section 5.2) and what editing reads to place handles.

Supporting changes in core:

- **Coordinate-system registry**, frame-scoped, replacing the canvas fallback.
  `axis cs`, `rel axis cs` and `axis description cs` register while the axis is open.
  The fallback becomes a diagnostic.
- **Bare coordinates.** From compat 1.11 a bare `(1,2)` inside an axis means
  `axis cs:`. For a linear axis the mapping is affine, so the axis installs it as the
  frame transform and existing coordinate evaluation and edit handles work unchanged.
  Log axes are not affine and need a resolver hook plus an inverse for editing.
- **The axis as a node.** `name=`, `current axis`, rectangle and outer anchors are
  registered as named node geometry and as dependency producers, so later statements
  can refer to them and incremental replay knows about it.
- **Generated nodes.** Tick labels, axis labels, title and legend entries are synthetic
  nodes through `evaluateNodeItem`, so styles such as `every tick label`, `font`,
  `anchor` and `rotate` behave as in TikZ. The legend is documented as a matrix of
  nodes; whether `matrix.ts` can lay it out directly is a Phase 3 question.
- **Key trees.** A `/pgfplots/` tree with fallback to `/tikz/`, backed by the existing
  custom-style registry. `.code` handlers stay unsupported and diagnose.
- **Number printing.** `\pgfmathprintnumber` and the `/pgf/number format/` keys,
  implemented from PGF source. Useful outside pgfplots too.
- **pgfmath additions.** Missing functions, `declare function`, and the trig-format
  switch. Also from PGF source.
- **Plot marks.** The full plotmarks set, from PGF source, shared with TikZ `plot`.
- **Plot handlers.** Reuse `semantic/path/plot.ts` for sharp, smooth, const, comb and
  bars where pgfplots' documented behaviour matches PGF's; pgfplots-specific behaviour
  (bar width in axis units, stacking, bar shifts per plot) lives in the axis code.

### 4.3 Incremental evaluation

Dragging an axis or a neighbouring node must not resample every plot.

- An axis is one atomic fragment with stable ids. It is classified for suffix skipping
  like a path: safe unless it produces names that later statements consume, in which
  case the dependency graph already handles it.
- Inside the axis, stage outputs are cached by content: sampled data per plot keyed by
  its source text and the options that affect sampling; layout keyed by limits, size
  options and label metrics. Moving the axis (`at`, enclosing shift) reuses everything
  up to stage 5's final translation.
- The warm-versus-cold differential fuzzers in `test/differential` get axis documents
  in their generators from Phase 1, since cache keys are where this goes wrong.

### 4.4 Export, capabilities, diagnostics

- A package-requirement channel on the scene, parallel to `requiredTikzLibraries`:
  `\usepackage{pgfplots}`, the document's `\pgfplotsset{compat=…}`, and
  `\usepgfplotslibrary{…}`. Without it exported axes do not compile.
- Capability rows per feature area (axis, plot inputs, plot types, ticks, legend, log
  axes, …) rather than one `pgfplots` row, so the matrix shows real coverage.
- Unsupported keys warn by name, as TikZ keys do. An unsupported plot type omits that
  plot and says so; it never draws something plausible but wrong.

### 4.5 compat levels

Behaviour depends on `\pgfplotsset{compat=…}`. Per the manual, 1.16–1.18 change
nothing, and between 1.11 and 1.18 the 2D differences are few and specific (stacked
negative bars at 1.13, bar clip limits at 1.15, colormap handling at 1.14).

Proposed policy:

- Implement one semantics, that of `compat=1.18`, and pin the oracle to it.
- Treat every level from 1.11 up as that semantics, handling the documented
  exceptions individually when the affected feature is implemented.
- For documents with no `compat` or a level below 1.11, render with the modern
  semantics and raise a diagnostic that offers to set `compat`. Emulating the pre-1.3
  label placement and pre-1.11 coordinate rules is not planned.

The local corpus shows 1.14, 1.17, 1.18 and `newest`, which fits this policy, but the
corpus is too small to prove it (section 6).

## 5. The oracle loop

The existing tooling gives most of the pieces. The lessons recorded in
`tex-text-adversarial-fuzzing.md`, `beamer-fidelity-campaign.md` and
`includegraphics-fuzzing.md` apply directly and are folded in below.

### 5.1 What existing tools do and do not give us

- `compare:renderers` and `compare:pgf-docs` produce side-by-side images for human
  review. They compute no metric, compile one **pdflatex** run per snippet, and cache
  nothing. Good as a gallery, not as a gate.
- `capture-coordinate-oracles.mjs` writes node anchors and soft-path tokens from PGF to
  a JSON fixture that vitest reads without TeX. This is the closest precedent.
- The beamer frame oracle walks the shipped-out page in LuaTeX, follows the PDF
  transform stack, and compares glyphs and rules at 0.01–0.02 pt. It also hooks PGF's
  driver layer. This is the strongest numeric oracle in the repo.
- The tex-fuzz stack has batching (ten cases in one run cost about a tenth of ten
  runs), a content-addressed cache keyed on source and toolchain, bisection of failing
  batches, shrinking, and replayable bundles.
- Nothing parses path geometry out of TeX's output yet.

### 5.2 Three tiers

**Tier 1 — semantic probes.** Quantities with a name, read through documented
interfaces, compared against `AxisLayout`:

- final limits, via the documented access to computed limits;
- the data-to-canvas map and the axis rectangle, by placing coordinates at
  `axis cs:` and `rel axis cs:` points and reading them back through PGF;
- outer bounding box and anchors, through the axis node's documented anchors;
- tick values, by setting the documented `xticklabel` key to code that reports the
  documented `\tick` value before typesetting the default label;
- description positions, through `axis description cs` and named nodes in styles.

These probes change the document, so each probe kind needs a one-time check that it
leaves the output unchanged (compare Tier 2 with and without it).

**Tier 2 — primitive trace.** A semantics-free record of everything drawn: path
segments, stroke and fill state, clip paths, and text boxes with size and position,
all in final page coordinates. Source: the PGF driver layer, the LuaTeX page walk, or
both; the beamer harness already does most of this. Compared against our scene after
normalisation, with matching by geometry rather than order where order is not visible.
Tier 2 needs no cooperation from pgfplots, so it covers everything, but when it fails
it only says "this line is 1.3 pt off", which is why Tier 1 exists.

**Tier 3 — pixels.** The existing gallery for human review, plus paint probes at
chosen points. Structural oracles in this repo have repeatedly missed fills,
backgrounds, clipping and paint order; this tier is the control for that.

Triage order when something differs: Tier 1 limits, then ticks, then transform, then
Tier 2. A wrong limit explains every downstream difference, so fix upstream first.

### 5.3 Two modes: experiments and regression

**Experiments** discover undocumented rules. One input varies, Tier 1 outputs go to a
table, a rule is proposed and implemented, and a *fresh* sweep that the rule has never
seen checks it.

- Discrete heuristics (tick count and step, limit rounding, when the scaled-tick
  factor appears, minor tick subdivision) are step functions of continuous inputs.
  Bisect the input to locate each transition exactly; a threshold found to 0.001 pt is
  a constant, while a guess from ten examples is a bug waiting.
- Sweep the inputs the manual says matter, and a few it does not mention (font size,
  label width), to catch hidden dependencies.
- The manual gives many defaults numerically (240 pt × 207 pt, 25 samples on −5:5,
  tick lengths, mark size). Where it names a default only by macro, read the value
  through the documented name at run time.

**Regression** keeps things fixed. Hand-written fixtures and corpus-derived cases with
saved `.oracle.json` data under `test/fixtures/pgfplots/`, so ordinary vitest runs
need no TeX. Oracles are refreshed by an explicit script, as for beamer.

A generator-based fuzzer comes later, once Phases 1–3 pass their fixtures. It reuses
the tex-fuzz machinery: stored choices rather than seeds, shrinking, bundles.

### 5.4 Tolerances

- pgfplots computes in TeX fixed-point and its own floating-point unit; we compute in
  doubles. Agreement to the last scaled point is not expected.
- Starting points: 0.02 pt for layout quantities (box, ticks, labels), looser for
  sampled curve points, exact equality for discrete outputs (tick lists, label
  strings, element counts).
- Set the curve tolerance from measured noise, not by taste: the difference between
  LuaLaTeX and pdfLaTeX on the same document is a floor no implementation can beat.
  The visual fuzzer normalises by renderer self-noise in the same way.
- Any later loosening is recorded with the case that forced it.

### 5.5 Engineering rules carried over

- One engine: LuaLaTeX, as for the other oracles. `compare:renderers` defaults to
  pdfLaTeX and gets a pgfplots mode that does not.
- Batch cases into one TeX run and cache by content hash plus toolchain fingerprint.
  pgfplots is slow to load and slow per axis; without this the loop is minutes, not
  seconds.
- **Mutation-test the oracle** before trusting it. The tex-fuzz gate was found to miss
  wrong geometry and lost content. Inject known errors (a tick off by one step, a
  dropped plot, a legend 2 pt low, a swapped fill) and confirm each tier catches what
  it should.
- The harness itself will have bugs; the includegraphics work needed two harness
  corrections. A disagreement is evidence about three things: us, the harness, and the
  reading of the manual.

### 5.6 Behaviour log

`design/pgfplots-behaviour.md` (or a fixtures-side equivalent): one entry per
non-obvious rule, with its source (manual section, or the experiment and its data) and
the tests that hold it. This is the lab notebook for the experiments in 5.3.

### 5.7 Where this loop is weak

- It converges on what is tested. A rule that is right on every sweep and wrong
  elsewhere stays wrong until a real document hits it. Real-document corpora are the
  counterweight (section 6).
- Rules with several interacting inputs are expensive to infer; tick placement with
  rotated or wide labels may be one.
- It cannot tell intended behaviour from upstream bugs. We reproduce what TeX does.
- Number formatting and math are exempt from all of this, since PGF source is readable.

## 6. Scope and evidence

**Manual surface.** Roughly 2.2 MB of manual source. The largest areas are 3D plots,
markers/colormaps/cycle lists, axis descriptions, 2D plot types, and `pgfplotstable`
alone at 4.8k lines. This is a multi-phase feature, not a single push.

**Local usage data is thin.** The beamer and poster corpora under `artifacts/` contain
only 15 files with axis environments, from about 12 sources:

- environments: `axis` only; no log axes, group plots, polar, 3D;
- 44 `\addplot`: 27 expressions, 17 coordinate lists, 2 tables;
- common keys: `width`, `height`, `xmin`/`xmax`/`ymin`/`ymax`, `grid`, `domain`,
  `samples`, `xlabel`/`ylabel`, `axis lines`, `scale only axis`, `legend style`,
  `legend pos`; plot keys `only marks`, `color`, `mark`, `mark options`, `mark size`;
- libraries: only `dateplot`, as template boilerplate.

This supports starting with 2D linear axes, expression and coordinate plots, marks and
basic descriptions. It says nothing reliable about what comes next: slides and posters
under-represent papers, where log axes, tables from files, bars, error bars and group
plots are common. Phase 0 therefore harvests a pgfplots-specific corpus (public
repositories, arXiv sources), kept untracked under `artifacts/`, and counts features by
distinct author, not by occurrence, so one prolific template does not set priorities.

## 7. Phases

Each phase ends with fixtures and saved oracles passing at the stated tolerances, a
reviewed gallery, updated capability rows, and behaviour-log entries.

**Phase 0 — groundwork**
- Generic environment fallback in the grammar (fixes the swallowed-statement bug).
- Oracle spike: Tier 1 probes and Tier 2 trace on three hand-written axes; verify the
  probe techniques actually work and do not disturb output; mutation-test.
- Corpus harvest and feature counts.

**Phase 1 — skeleton**
- Grammar and AST for axis and `\addplot coordinates`.
- Linear axis, explicit limits, explicit ticks, sharp lines, axis box, clip.
- Size model: `width`, `height`, `scale only axis`.
- Labels and title; `axis cs` and bare coordinates; embedded TikZ.
- Axis selectable and movable as one object; ids and incremental caching designed in.
- Export with package requirements.

**Phase 2 — automatic layout** (the experiment-heavy phase)
- Automatic limits and `enlargelimits`.
- Automatic tick placement, minor ticks, `xtick distance`.
- Number printing and scaled ticks.
- Grids, tick styles and alignment.

**Phase 3 — plots people write**
- Expression and parametric plots; pgfmath additions; `domain`, `samples`.
- Plot marks, cycle lists, `\addplot+`, line styles.
- Legend: entries, `legend pos`, `legend style`, columns, cell alignment.
- `\pgfplotsset`, user styles, `every …` styles.

**Phase 4 — axis variants**
- `axis lines` and per-axis line options, including arrow tips.
- Log axes, including bare-coordinate resolution and tick labels.
- `axis equal`, unit vector ratio, `x dir`, axis anchors and `at`.

**Phase 5 — more plot types and inputs**
- Bars (width, shift, stacking), area and `\closedcycle`, const, comb.
- `only marks` and scatter basics, error bars, `nodes near coords`.
- Tables: inline first, then files through the app's file resolver.
- `unbounded coords`, coordinate filters.

**Phase 6 — editing surface** (parts may move earlier)
- Resize handles writing `width`/`height`; drag legend and labels.
- Inspector sections for axis and plot.
- Insert templates: function plot, data plot, bar chart.
- Data editing for coordinate plots; dragging individual points.

**Later, ordered by corpus evidence**
- `groupplots`, `fillbetween`, symbolic coordinates and `dateplot`.
- Colormaps, colorbars, point meta, `statistics` (boxplot, histogram), `polar`.
- 3D is a separate decision: views, surface and mesh shading, and depth sorting are a
  project of their own.
- `pgfplotstable` typesetting is out of scope.

## 8. Editing model

The point of the editor is direct manipulation, so the source mapping is designed with
Phase 1, even where the UI arrives in Phase 6.

- The axis is one selectable object; its plots, labels, title and legend are
  sub-selections, in the way matrix cells and tree children are today. This needs new
  property-target kinds and inspector builders.
- Moves write `at=` or a shift; resizes write `width` and `height`. Both are pure
  option-list edits, which existing machinery handles.
- Text edits of labels, title and legend entries reuse canvas text editing with spans
  into the axis source.
- Handles for embedded TikZ work unchanged on linear axes (affine frame). Log axes
  need the inverse map in the coordinate writer.
- Point dragging rewrites one coordinate in a `coordinates` list; the reader for
  coordinate and table data therefore keeps per-point spans from the start.

## 9. What to take from the earlier work

- **The seam list.** Both prototypes found the same hooks this document names:
  environment claiming, coordinate systems, named geometry, export preamble, inspector
  sections, templates. That is reassurance that the list is complete for 2D.
- **Fixtures and specs.** The October worktree has about 30 self-written example files
  and about 25 specs across four packages. They are ours and MIT; each is re-checked
  against the oracle before it becomes a regression fixture.
- **UI ideas.** Insert templates, grouped inspector fields, the size handle, and
  `design/addon-ui-contributions.md` on the July branch.
- **The pgfplots add-on's pure modules** (`axis-scale.ts`, `plot-data.ts`,
  `syntax.ts`) as reading material. Its README is candid that tick selection, label
  spacing and legend layout are approximate, and it is not known how systematically it
  was checked against TeX, so nothing is ported without passing the oracle.
- **Not taken:** the add-on API, the host-context facade, runtime registration and
  loading, and the tcolorbox add-on (master has native tcolorbox now).

tikz-cd and circuitikz are separate, simpler projects (LPPL, source readable, no
oracle archaeology needed) and can follow the normal TikZ workflow.

## 10. Open questions

- **compat policy** (4.5): is "modern semantics plus a diagnostic" acceptable for
  documents without `compat`?
- **Legend layout**: reuse `matrix.ts` or a dedicated layout? Decide after measuring
  how closely the documented matrix description matches Tier 2 traces.
- **Probe viability**: the Tier 1 techniques are designed from the manual and have not
  been run. Phase 0 confirms or replaces each.
- **File-backed tables**: the web shell has no file system; which resolver do tables
  use, and what does the diagnostic say when the file is unavailable?
- **3D**: in scope eventually, or explicitly never?
- **Package boundary**: stay inside core, or split for lazy loading once the size is
  known?
