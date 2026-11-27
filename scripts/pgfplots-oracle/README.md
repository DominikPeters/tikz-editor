# pgfplots oracle harness (Phase 0)

Black-box LuaLaTeX oracle for the native pgfplots implementation planned in
`design/pgfplots.md` (sections 2 and 5). It compiles hand-written axes, reads
named quantities through documented pgfplots/PGF interfaces (Tier 1), records
everything painted on the page (Tier 2), and saves both as JSON fixtures that
vitest checks without TeX.

**Licence rule.** pgfplots is GPL; this harness never opens pgfplots
implementation files (`*.code.tex`, `pgfplots*.sty`, its Lua files), never
dumps definitions (`\meaning`, `\show`, tracing), and uses only keys and
macros documented in the manual (`pgfplots-docs/`). The toolchain fingerprint
`stat`s `pgfplots.sty` (path, size, mtime) for cache invalidation; it does not
read it. PGF internals used here (`\pgfsys@invoke`, `\pgfsys@hbox`,
`pgf@sh@ns@…`) are from `pgf-src` (LPPL).

## Running

```
npm run oracle:pgfplots                         # = refresh: rewrite test/fixtures/pgfplots/*.oracle.json
npm run oracle:pgfplots -- refresh --only legend-marks [--no-cache]
npm run oracle:pgfplots -- disturbance          # every probe kind vs. a bare page, both engines
npm run oracle:pgfplots -- noise-floor          # LuaLaTeX vs pdfLaTeX (design 5.4)
npm run oracle:pgfplots -- timing               # cold single / cold batch of 10 / warm
npm run oracle:pgfplots -- mutation [--oracle path/to/x.oracle.json]
npx vitest run test/pgfplots-oracle-fixtures.spec.ts
```

Output goes to `artifacts/pgfplots-oracle/` (gitignored): `cache/`, `work/<run>/`
(the batch `.tex`, `.pdf`, `-probe.tsv`, `-textbox.tsv`, kept for debugging),
`disturbance.tsv`, `noise-floor.txt`, `mutation-test.txt`.

The refresh command is the only way fixtures change. The spec fails with
"stale oracle" when a `.tex` changes without a refresh (source SHA-256).

## Files

| File | Role |
|---|---|
| `tex-source.ts` | fixed preamble, TeX instrumentation, probe injection, batch document |
| `lua-trace.ts` | LuaTeX page walk for PGF text boxes |
| `mutool-trace.ts` | Tier 2 from `mutool trace` of the PDF |
| `assemble.ts` | raw outputs to Tier 1 / Tier 2 |
| `run.ts` | batching, toolchain fingerprint, content-addressed cache |
| `schema.ts` | types, typed reader `parsePgfplotsOracle` |
| `compare.ts` | `compareTier1`, `compareTier2`, `comparePicture` |
| `mutations.ts` | mutation test of the comparison |
| `fixtures.ts` | fixture discovery, oracle file construction |
| `../capture-pgfplots-oracles.mts` | CLI entry |

## Fixture format

`test/fixtures/pgfplots/<name>.tex` is a **body**: exactly one `tikzpicture`
(comments allowed). The harness supplies the preamble, which is fixed:

```tex
\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\pagestyle{empty}
```

`refresh` also writes `artifacts/pgfplots-oracle/standalone-example.tex`, an
uninstrumented compilable document for the first fixture. Fixtures are written
by us; never copy manual examples (they carry the GPL header).

`<name>.oracle.json` (schema `pgfplots-oracle/v1`, see `schema.ts`):

```
{ schema, harnessVersion,
  case: { name, sourceSha256 },
  toolchain: { engine, engineVersion, pgfVersion, pgfplotsVersion, mutoolVersion, compat },
  tier1: { boundingBox, axes: [ { id, limits, limitsRaw, rect, limitCorners, map,
           anchors, ticks: { x: [ { index, value, valueRaw, label } ], y }, descriptions } ] },
  tier2: { page, primitives: [ path | glyphs | image | shading ], textBoxes } }
```

**Coordinate frame (everything):** TeX pt, PGF picture coordinates, y up,
origin at the tikzpicture origin; the frame `\pgfpointanchor` reports. Each case
is shipped on its own page whose size is exactly the picture box, so page
coordinates convert with `x = xPage + bbox.minX`, `y = bbox.maxY − yPage`.
Floats are rounded to 1e-5 pt in the files.

## Tier 1 probes

All probes are injected textually around each `\begin{axis}`/`\end{axis}`
(also `semilogxaxis`, `semilogyaxis`, `loglogaxis`) and before
`\end{tikzpicture}`, as no-op hooks enabled per page by flags. Node names carry
the case id (`pgfplotsoracle-<case>-<axis>-…`) because PGF node names are
global: without it a later page read an earlier page's title node (found by the
determinism check; fixed).

| Quantity | Technique (TeX) | Manual | Disturbs output? |
|---|---|---|---|
| Final limits | before `\end{axis}`: `\pgfplotsextra{…\pgfkeysvalueof{/pgfplots/xmin}…}` written with `\immediate\write` | `pgfplots.reference.specifyrange.tex`, key `xmin` ("During the visualization phase … `\pgfkeysvalueof{/pgfplots/xmin}`"); `\pgfplotsextra` in `pgfplots.basic.reference.tex`; "Accessing Axis Limits" | no (3/3 fixtures, both engines) |
| Axis rectangle | `\coordinate[overlay] (…-r00) at (rel axis cs:0,0);` …(1,0),(0,1),(1,1); read after `\end{axis}` with `\pgfpointanchor{…}{center}` under `\pgftransformreset` | `rel axis cs`: `pgfplots.reference.gridoptions-axiscoordinates.tex` | no |
| Data-to-canvas map | `\coordinate[overlay] … at (axis cs:\pgfkeysvalueof{/pgfplots/xmin},\pgfkeysvalueof{/pgfplots/ymin});` and (xmax,ymin), (xmin,ymax); affine map derived from these and the limits | `axis cs`: same file; annotations may use `\pgfkeysvalueof` (specifyrange, `xmin`) | no |
| Axis anchors, outer bbox | after `\end{axis}`: `\pgfpointanchor{current axis}{<anchor>}` for all 35 documented anchors (rectangle, outer, mixed, origin sets) | `pgfplots.reference.alignment.tex` ("Basic Alignment", `current axis`) | no (read-only) |
| Tick values | harness version 4: `xticklabel style={execute at begin node={\pgfplotsoracle@tick…}}` in `every axis/.append style` (and in `every extra x tick` for extra ticks, reported as `xe`/`ye`); the macro writes `\ticknum` and `\tick` from inside each tick label node, so the label code (`xticklabel`, log labels) stays the document's. Version 2 replaced `xticklabel`, which broke `axis` with `xmode=log` (FPU error) and lost custom labels | `\tick`, `\ticknum`, `every extra x tick`: `pgfplots.reference.tickoptions.tex`, styleoptions; `execute at begin node`: TikZ | no (all fixtures; Tier 2 of the 28 older fixtures unchanged by the switch) |
| Tick label nodes | same style: `xticklabel style={name=pgfplotsoracle-<case>-a1-x\ticknum}`, anchors read after the axis | `xticklabel style={name=tick no \ticknum}` example, tickoptions "typeset ticklabels with strut" | no |
| Tick label strings | PDF glyphs (Tier 2) inside the label node's anchor quad | (derived) | — |
| Title, xlabel, ylabel, legend | `title style={name=…}`, `xlabel style`, `ylabel style`, `legend style={name=…}` in `every axis/.append style`; 13 node anchors each; text from PDF glyphs inside the quad | `title style={name=MyTitleNode}` example in alignment; description styles in `pgfplots.reference.axisdescription.tex`, `pgfplots.reference.styleoptions.tex` | no |
| Legend entry nodes (v3) | `legend style={nodes={name=pgfplotsoracle-<case>-<axis>-legend-\the\pgfmatrixcurrentrow-\the\pgfmatrixcurrentcolumn}}`; after the axis, rows/columns 1..16 are read silently | `legend style`, `nodes` in the documented `every axis legend` (axisdescription.tex "Legend Appearance"); `\pgfmatrixcurrentrow` is PGF's (pgfmodulematrix, LPPL) | no (legend-marks, both engines, "descriptions" row) |
| Picture bounding box | before `\end{tikzpicture}`: `\pgfpointanchor{current bounding box}{south west|north east}` | PGF/TikZ | no (read-only) |

"Disturbs output?" comes from `disturbance`: each probe kind alone, all
probes, and all probes plus the text-box walk, each compared with a bare page,
on all three fixtures, in LuaLaTeX and pdfLaTeX. The comparison is the raw
`mutool trace` text plus page size (font subset tags removed): identical means
identical painting. The bare page is itself compared with a fully
uninstrumented document (identical). A positive control (an extra
`\draw[draw opacity=0]`) is reported as different, so the check is not blind.
Informational: a named `\coordinate` without `overlay` far outside the axis
did not change the output either.

Observations worth knowing:

- Limits carry fixed-point noise: `-0.4000244` for an exact −0.4. `limitsRaw`
  keeps the TeX strings; comparisons measure a limit error as the canvas
  distance it causes.
- `\ticknum` is not "the n-th drawn tick": in `default-axis` the first drawn x
  tick has `\ticknum`=1 (the generated list starts outside the limits). The
  manual says "starting with 0".
- Tick label nodes hang exactly on the axis edge (`north` of an x label is on
  the bottom edge at the tick's x; `east` of a y label on the left edge).
- `scale only axis, width=6cm` gives a 170.71826 pt rectangle (6 cm =
  170.71654 pt).

Harness version 2 (2026-11-27) defines `\ticknum` as `S` outside tick
labels, so the tick scale label of scaled ticks (typeset with the tick label
style, where the name probe uses `\ticknum`) no longer crashes the run; the
scale label node is named `…-xS`/`…-yS` and is not read.

Harness version 3 (2026-11-27) adds the legend entry nodes above
(`OracleAxis.legendEntries`, compared anchor by anchor as `legend-entry`)
and assigns glyphs to *text boxes* by their baseline probes only (origin
and advance end): text boxes are tight, so the 0.6 em ink probe left
x-height glyphs of a short box (a legend entry with `text depth`) to the
enclosing box. Node quads keep the three probes.

Harness version 4 (2026-11-27, merged with version 3's legend probe): the
tick probe runs from the tick label node (`execute at begin node`) instead
of replacing `xticklabel`; extra ticks are probed (`xExtra`/`yExtra`); a
`MODE` record gives Tier 1 a per-direction `scale`, and log directions take
their map from `rect` and the limits; description node names are appended
in `every axis post`, after the axis options (an `axis x line=middle`
redefines `every axis x label` with `.style`, which dropped the name).

## Renderer comparison

`adapter.ts` converts the editor's evaluated scene and the axis evaluations
the pgfplots evaluator records into Tier 1 / Tier 2; `test/pgfplots-oracle-compare.spec.ts`
compares every fixture (known deviations listed there with their causes) and
writes `artifacts/pgfplots-oracle/compare.tsv`. `gallery.mts` renders editor
and LuaLaTeX side by side into `artifacts/pgfplots-gallery/`;
`corpus-run.mts` runs the evaluator over the untracked arXiv corpus.

## Tier 2 primitive trace

**Source: `mutool trace` of the final PDF** (MuPDF interprets the content
stream and reports each fill/stroke/clip path, glyph, image and shading with the
full CTM and resolved graphics state). Chosen over the alternatives because:

- it sees everything that is painted, whoever emitted it (PGF, pgfplots, TeX
  rules, fonts), with no hooks, so it needs no cooperation from pgfplots and
  cannot disturb the output;
- it works identically on LuaLaTeX and pdfLaTeX PDFs (needed for the noise
  floor);
- it resolves what a TeX-side hook cannot see: ExtGState alpha, transparency
  groups, final colour space values, dash and line width after the CTM.

PGF driver hooks (`\pgfsys@moveto` …) would see only PGF paths in PGF's own
frame; a LuaTeX walk of `pdf_literal` nodes would need the same PDF-operator
parsing, only for LuaLaTeX and only for literals.

Recorded per primitive: paint order, operation (stroke/fill/clip), fill rule,
segments `M L C Z` (rectangles are flagged with `rect`; PDF `re` arrives as
`M L L L Z`), paint `{space, components, alpha}` (alpha includes enclosing
group alpha), line width, dash, cap, join, miter limit (scaled by the CTM),
clip depth and the intersection of active clip bounding boxes. Glyph runs:
font (subset tag removed), size, baseline direction, glyph origin, advance and
Unicode (NFKC; pdfTeX's multi-character "fi" mapping is merged).

**Text boxes** (LuaLaTeX only): `\pgfsys@hbox` (PGF's driver macro that inserts
every node text box) is wrapped to set a LuaTeX attribute on the box; a
`pre_shipout_filter` walk records each tagged box's reference point, transform
(2×2), width/height/depth, TeX glyph slots and fonts. To follow the PDF
transform stack the walk must read `q`/`Q`/`cm` literals, and LuaTeX cannot read
token-backed literal payloads, so `\pgfsys@invoke` is redefined to emit a
string-backed origin-mode literal with the identical payload (as in the beamer
oracle). Painting is unchanged (disturbance check, "trace" rows). The box text
is the PDF glyphs inside the box, each glyph assigned to the innermost box. The
axis picture itself shows up as a nesting-0 box.

**Coverage gaps (not seen, or seen only coarsely):**

- shadings and images: bounds only (no colour function, no pixels); patterns
  (`<tile>`) are not interpreted; soft-mask content is skipped;
- clipping is summarised as the intersection of clip-path bounding boxes:
  non-rectangular and even-odd clips are approximated; text clip is a glyph-origin box;
- blend modes, knockout and isolation of transparency groups are ignored;
- glyphs are origin + advance + Unicode; no outlines, no ink box, no text
  rendering mode; inter-word spaces do not exist in the PDF, so recovered
  strings have none (`Explicitlimits`);
- per-end line caps (`linecap="a,b,c"`): only the first is kept;
- text boxes: only boxes that pass through `\pgfsys@hbox`; no pdfLaTeX version.

## Comparison (`compare.ts`)

Both functions take the neutral `Tier1`/`Tier2` structures, not SVG; the
renderer side will need an adapter from its scene to these.

- Tier 1: layout points (bbox, rect, anchors, label/description anchors, map
  images of the four limit corners) to `layoutPt` = 0.02 pt; limits as canvas
  distance (0.02 pt); tick count, `\ticknum`, label strings and description
  presence exactly; tick values to 1e-6 of the axis range.
- Tier 2: paths split into subpaths (so one path with many subpaths equals many
  paths), canonicalised (a closing `L` before `Z` dropped), and matched per
  operation/fill rule by geometry with a greedy minimum-distance assignment:
  same segment structure gives the max control-point distance (polylines may be
  reversed; closed ones may start anywhere), different structure gives a
  sampled Hausdorff distance. Unmatched within 4 pt are missing/extra. Matched
  pairs then compare paint, line width (0.01 pt), dash, cap, join and clip box.
  Glyphs match by Unicode and position (0.02 pt), then size, font and colour.
  Text boxes match by origin with equal rotation and nesting. Paint order is
  checked only for overlapping matched painted items.
- Curves use `curvePt` = 0.02 pt, from the noise floor below (0.0025 pt).

## Mutation test

`mutation` (and the vitest spec) runs these against every fixture; all rows
come out as designed:

| Mutation | Expected T1/T2 | Detected |
|---|---|---|
| identity (control) | no/no | no/no |
| everything shifted 0.01 pt (sub-tolerance control) | no/no | no/no |
| x ticks off by one step (values, labels, tick marks, glyphs) | yes/yes | yes/yes |
| dropped plot path | no/yes | no/yes |
| one plot vertex 0.05 pt off | no/yes | no/yes |
| legend 2 pt low (fixtures with a legend) | yes/yes | yes/yes |
| legend entry 1 pt right (fixtures with legend entries) | yes/yes | yes/yes |
| swapped fill colour | no/yes | no/yes |
| tick label string changed | yes/yes | yes/yes |
| axis box 0.05 pt wider | yes/yes | yes/yes |

The first version of the axis-box mutation was not detected by Tier 2, because
the mutation selected points with a 1e-3 pt window and the PDF axis box is
0.0024 pt wider than `rel axis cs` says (next section); the window is now
0.01 pt. The mutation test also exposed a tokenizer bug (attribute names with
digits, so `curveto x1=` was dropped) before any fixture was trusted.

## Noise floor (LuaLaTeX vs pdfLaTeX)

`noise-floor` compiles the fixtures with both engines, with two preambles:

- default: max Tier 1 0.226 pt (bbox/outer anchors), Tier 2 paths 0.103 pt,
  glyphs 0.116 pt. Not engine noise: LuaLaTeX sets text in Latin Modern
  OpenType, pdfLaTeX in CM Type 1, and the metric differences move labels and
  everything sized from them. Math (tick labels) uses CM in both and differs by
  0.0022 pt.
- metric-matched (`\usepackage[OT1]{fontenc}` + `cmr`/`cmss`/`cmtt`): **Tier 1
  identical to the scaled point**; Tier 2 paths max 0.00245 pt (straight and
  curved), glyphs 0.011 pt, nothing unmatched. The path difference is entirely
  pgfplots' `lua backend` (initially true under LuaLaTeX, manual
  `pgfplots.resources.tex`, key `lua backend`; `pgfplots.preliminaries.tex` on compat 1.12): with
  `\pgfplotsset{lua backend=false}` LuaLaTeX paths equal pdfLaTeX's exactly.
  The 0.011 pt glyph difference is (probably) PDF text positioning granularity
  in pdfTeX.

## Timings (this container, LuaHBTeX 1.17, pgfplots 1.18.1)

cold single case 1.16 s (TeX 1.06 s); cold batch of 10 cases 1.94 s (TeX
1.87 s, ~0.19 s/case); warm (cache hit) 0.04 s for all 10; mutool trace ~0.01 s
per batch.

Cache: `artifacts/pgfplots-oracle/cache/<k[0:2]>/<k>.json`, key = SHA-256 of
harness version, the case rendered as its own one-page document (so preamble,
instrumentation, injected hooks, flags, case id and body), the Lua walk source,
and the toolchain fingerprint (engine and mutool version lines; path, size and
mtime of pgfplots.sty, pgf.sty, tikz.sty and the luatex/pdftex PGF drivers). The
cache stores raw TeX/mutool outputs; assembly into Tier 1/2 reruns on every
read, so parser changes never need a flush.

## Limitations and open problems

- PDF path coordinates are PGF's pt→bp conversion with factor 0.99627
  (`pgfsys.code.tex`), so Tier 2 paths are ~1.2e-5 larger (relative to the
  current cm origin) than Tier 1 says: 0.0024 pt at 195 pt. It would reach
  the 0.02 pt tolerance at ~1600 pt. The spec compares the tiers with 0.01 pt.
- A probe is **lost, not wrong**, when the fixture's own options override the
  probe key: a custom `xticklabel`/`xticklabels`, or `title style={name=…}`
  (checked: painting identical, probe empty). `refresh` warns about missing
  tick/limit/map probes; description names are not warned about.
- Log mode (the `MODE` record, Tier 1 `scale`) is detected from the
  environment name, a literal `xmode=log` in the axis options, or one in an
  `every axis` style defined earlier in the body (a bare
  `\pgfplotsset{xmode=log}` has no effect, behaviour Q1). It no longer affects
  painting (the tick probe does not choose a label macro), only how Tier 1 is
  assembled: on a log direction limits and `\tick` are logarithms and the map
  is derived from `rect` and the limits. A mode set through a macro is missed.
- Positive controls of `disturbance` are injected before the axis end of any
  of the four environments (before version 4 only `\end{axis}`, so log
  fixtures got no control).
- Not probed: minor ticks, z axis, tick mark lengths (Tier 2
  has them), legend images (Tier 2 has them), colorbars, multiple axes beyond reading each one's `current axis`
  (two side-by-side axes were tried once and read correctly).
- Description/tick text is recovered from PDF glyphs inside the node quad,
  using an approximate ink box (origin, advance end, 0.6 em up), which is what
  keeps a neighbouring label corner out; very tight layouts could still
  mis-assign.
- The tick probe relies on each tick label node being typeset once per drawn
  tick; duplicates with different values throw (the message names the case).
  Text boxes: a glyph's upper probe point is capped at 90 % of a tight TeX
  box's height (a lone math `y` is 4.3 pt high).
- The text-box walk relies on all `q`/`Q`/`cm` going through `\pgfsys@invoke`;
  anything else that emits a transform literal would misplace boxes. The spec's
  "label text box centred on the label node" check would notice.
- Only Tier 1 and Tier 2 exist; Tier 3 (pixels) is not part of this spike.
