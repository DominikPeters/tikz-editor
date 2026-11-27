# pgfplots behaviour log

Status: experiments of 2026-11-27, pgfplots 1.18.1, PGF 3.1.10, LuaHBTeX 1.17
(TeX Live 2023), `compat=1.18`, the oracle harness preamble (article, 10pt).
This is the lab notebook of `design/pgfplots.md` section 5.6: every rule an
implementer needs, where it came from, and how well it was checked.

**Licence.** Every rule below comes from the pgfplots manual (`pgfplots-docs/`),
from compiling documents and measuring the output, or from reading the *value*
of a documented key or macro at run time. No pgfplots implementation file was
opened; no definition was dumped. Number printing is PGF (`pgf-src`, LPPL) and
may be read directly.

## How to read an entry

- **Rule**: precise enough to implement. Units are TeX pt (1/72.27 in) unless
  stated. Coordinates are picture coordinates, y up, as in the oracle schema.
- **Source**: `manual: file, key` or `experiment: script, sweep`. Raw data is in
  `artifacts/pgfplots-experiments/<name>/` (gitignored; re-create it with the
  script).
- **Status**:
  - **VERIFIED**: proposed on one sweep, then checked on a *fresh* sweep (new
    seed, new values) it had not seen; the max error is given.
  - **CONFIRMED**: documented in the manual and confirmed by measurement (not
    separately re-swept).
  - **OBSERVED**: measured on a handful of cases; plausible, not swept.
  - **OPEN**: unresolved; what was tried is recorded.

"Noise" below means TeX fixed-point effects: they are not rules and should not be
emulated. Section 0 quantifies them so tolerances can be set.

## Experiment scripts

All under `scripts/pgfplots-oracle/experiments/` (run with
`node --import tsx scripts/pgfplots-oracle/experiments/<file>`; checkers are
plain `python3`). They reuse the harness unchanged (`runOracleCases`: batching,
content-addressed cache in `artifacts/pgfplots-experiments/cache`, Tier 1 probes,
mutool Tier 2), one LuaLaTeX process at a time, 120–250 axes per run.

| Script | What | Checker |
|---|---|---|
| `lib.ts` | runner: batches, cache, failure bisection, custom records (`\xrec{k=v}`, `\xpt{node}`, `\xanchor{node}{anchor}`), tables | — |
| `bisect.ts` | parallel batched bisection of step-function transitions | — |
| `disturbance.mts` | proves the experiment preamble does not change painting | — |
| `e01-defaults.mts` | run-time values of documented keys/macros | — |
| `e02-size.mts [seed]` | size model | `check-size.py` |
| `e03-map.mts [seed] [size]` | data-to-canvas exactness | (built in) |
| `e04-descriptions.mts [seed] [n]` | tick label / xlabel / ylabel / title placement | `check-desc.py` |
| `e05-tier2.mts` | paint order, styles, tick/grid/box/clip geometry digest | (read) |
| `e06-cycle.mts` | default cycle list, `\addplot` option semantics | (read) |
| `e07-limits.mts [seed]` | automatic limits, `enlargelimits` | `check-limits.py` |
| `e08-ticks.mts <sweep> [seed] [n]` | automatic tick step and list | `check-ticks.py` |
| `e09-tick-bisect.mts` | bisected tick-step transitions | (prints) |
| `e10-minticks.mts` | small-axis / `try min ticks` regime | (read) |
| `e11-scaled.mts <sweep> [seed]` | scaled ticks, label strings, scale label | `check-scaled.py` |
| `e12-tickspecs.mts` | minor ticks, `xtick distance`, lists, `data`, `\empty` | (read) |
| `e13-anchors-bbox.mts` | `at`/`anchor`, `current axis` anchors, bounding box | (read) |
| `e14-misc.mts` | labels without tick labels, empty axis, `label shift` | (read) |
| `e15-fewticks.mts [r] [L] [tmt]` | sliding-window data for rule I1b | (prints) |

Disturbance (`disturbance.mts`): the experiment preamble (custom records and the
`\ticknum` fallback, below) leaves the `mutool trace` of three test axes
**identical** to the plain harness (or to the bare page where the plain harness
cannot run).

---

## 0. Numerical noise (sets tolerances)

**N1 — Data-to-canvas map is affine; deviation is a scale error.** OBSERVED on
sweeps E03 seed 0 and 1 (26 limit ranges from 1e-6 to 1e9 wide, offsets to
±1e6, 8 points each).
- Default axis (195 × 162 pt box): max |actual − ideal| = **0.0092 pt**.
- 1000 × 1000 pt box: max **0.061 pt** (seed 0), 0.032 pt (seed 1). The error
  is linear in the position (a unit-vector error of up to ~6e-5 relative,
  e.g. 1000.061 pt for a 1000 pt axis), not random.
- Recommendation: compare layout positions with tolerance
  `max(0.02 pt, 1e-4 × axis length)`. Do not emulate.
- Data: `e03-map-seed{0,1}[-size1000]/map.tsv`.

**N2 — Limits are stored with limited precision.** `xmin` read back after the
axis is e.g. `-0.4000244` for an exact −0.4 (harness README). Effects found here:
- When the data range is tiny relative to its magnitude (range/|value| ≲ 1e-4)
  the limits and even the box size deviate (box 161.911 instead of 162 pt;
  enlargement apparently lost). Treat this as out of scope: compute the ideal
  rule and accept the difference (data: `e07-limits-seed0` rows l10, l12, l22).
- For range/|value| ~ 1e-2..1e-1 at small magnitudes (|v| < 0.1) limit errors
  reach ~3e-7 absolute, i.e. up to **0.1 pt** of canvas (`e07-limits-seed1`
  l77, l108; seed 0 l26). Again noise.
- Tick values carry relative noise ~3e-7 (`-1280.0003`, `11600.003`).

**N3 — Tier 2 vs Tier 1**: PDF paths are 1.2e-5 relatively larger (harness
README; pt→bp). Not re-measured.

---

## A. Size model and position

**A1 — Default target size.** `width` = 240 pt, `height` = 207 pt.
CONFIRMED. Source: manual `pgfplots.reference.scaling.tex`, `\axisdefaultwidth`,
`\axisdefaultheight`, style `normalsize`. Run-time read (E01):
`\pgfkeysvalueof{/pgfplots/width}` = `240pt`, `height` = `207pt`,
`\axisdefaultwidth` = `240pt`, `\axisdefaultheight` = `207pt`.

**A2 — Box size from width/height.** With unit vectors not given:
```
W_target = width  (if given) else (height given ? height * 240/207 : 240pt)
H_target = height (if given) else (width  given ? width  * 207/240 : 207pt)
box width  = W_target - (scale only axis ? 0 : 45pt)
box height = H_target - (scale only axis ? 0 : 45pt)
```
The 45 pt is a constant: tick labels, axis labels, title, fonts (`\tiny` to
`\Huge`), wide tick labels (6-digit) and absent ticks (`xtick=\empty`) never
change the box. VERIFIED. Source: manual (scaling.tex, `width`: "fixed amount
… 45pt"; aspect rule under `width`), experiment E02. Discovery sweep seed 0
(320 axes: width 80–540, height 60–451, ×5 decorations × scale only axis,
plus width-only/height-only), fresh sweep seed 1 (320 axes, random
60–560 pt): max error **0.0071 pt** (excluding axes whose limits are near 1e5,
where N2 gives 0.013 pt). Data: `e02-size-seed{0,1}/rect.tsv`;
`check-size.py`.

**A3 — Explicit unit vectors.** `x=<dimen>` sets e_x = (dimen, 0): the box
width is `dimen × (xmax − xmin)`; the other direction is still derived from
`height` (A2: x=5pt gives box height 162 pt = 207 − 45). VERIFIED (same sweeps,
modes `units`/`xunit`), max error 0.0037 pt (unit vector stored with ~6e-5
relative noise, e.g. 5.000306 pt for `x=5pt`).

**A4 — `scale=<f>`** multiplies the final box (after the 45 pt subtraction or
`scale only axis`): default axis with `scale=0.5` is 97.5 × 81 pt; with
`scale only axis,width=150pt,height=100pt,scale=0.5` it is 75 × 50 pt. Labels
are not scaled. VERIFIED (E02 modes `scale`, `scale-soa`), max error 0.0029 pt.
Source: manual scaling.tex `scale` ("rescales the resulting vector(s)").

**A5 — Default position.** The box's lower-left corner (`rel axis cs:0,0`) is at
the picture origin (0,0). VERIFIED (all E02 axes: error 0).

**A6 — `at`/`anchor`.** The axis is translated so that `current axis.<anchor>`
lands on `at` (default `at={(0,0)}`, `anchor=south west`). Works for box anchors
(`north east`, `center`, …), outer anchors (`outer north east`,
`outer south west`), mixed anchors (`left of south west`) and `origin` (the
canvas point of data (0,0)). OBSERVED (E13, 6 cases, exact to 1e-4 pt).
Source: manual `pgfplots.reference.alignment.tex`.

**A7 — Axis anchors.** For the default boxed axis, with box `[x0,x1]×[y0,y1]`
and the axis' own bounding box `[X0,X1]×[Y0,Y1]` (F1):
- box anchors (`south west` … `north east`, `center`) are the box corners/edge
  midpoints;
- `outer <dir>` anchors are the corresponding points of the outer bounding box;
- `left of south west` = (X0, y0); `below south west` = (x0, Y0); the other
  mixed anchors analogously (outer coordinate across the edge, box
  coordinate along it);
- `origin` = canvas image of data (0,0).
OBSERVED (E13, 14 cases). Source: manual alignment.tex (anchor list).

**A7a — Origin anchors stay on the box** (correction, 2026-11-27). `origin`
is data (0,0) *clamped into the box*; `above origin` = (origin.x, y1),
`below origin` = (origin.x, y0), `left of origin` = (x0, origin.y),
`right of origin` = (x1, origin.y) — box edges, not the outer box. The four
projections carry noise: they come out up to **0.042 pt** off the edge
(28 fixtures; e.g. `right of origin` x = x1 + 0.0417 in default-axis, + 0 in
xtick-data), no pattern in limits or size. Not emulated; the comparison
gives these four anchors 0.05 pt (`compare.ts`, `originProjectionPt`).
OBSERVED on all 28 oracle fixtures (`test/fixtures/pgfplots/*.oracle.json`).

---

## B. Data-to-canvas map (linear axes)

**B1** canvas(x, y) = (x0 + W·(x − xmin)/(xmax − xmin), y0 + H·(y − ymin)/(ymax − ymin)).
Exact up to N1. VERIFIED (E03 two sweeps; see N1 for the error budget).

---

## C. Axis box, ticks, grid as drawn (Tier 2)

All CONFIRMED/OBSERVED from E05 (16 variants, `e05-tier2/digest.txt`) and E12.

**C1 — Paint order** (default `axis on top=false`, `clip=true`, no legend):
1. grid lines: minor x, major x, minor y, major y (only those enabled);
2. tick marks: minor x, major x, minor y, major y;
3. the axis box;
4. x tick labels (left to right), then y tick labels (bottom to top);
5. begin clip (the box rectangle); plot paths in `\addplot` order, and embedded
   TikZ (`\draw`, `\node`) in source order, all clipped;
6. end clip; then the **markers of each plot**, plot by plot, unclipped (each
   plot's marker block is followed by an empty, unpainted stroke path);
7. axis descriptions: xlabel, ylabel, title (in that order).

With `axis on top`: clip + plot paths first, then ticks, box, tick labels,
markers. Matches the manual's layer list
(`pgfplots.reference.layers.tex`, `layers/standard`: axis background, axis
grid, axis ticks, axis lines, axis tick labels, pre main, main, axis
descriptions, axis foreground) and `clip marker paths=false` (initially false,
`pgfplots.reference.bb-clip.tex`: markers drawn after the clipped region; only
their positions are clipped).

**C2 — Axis box.** One stroked closed path, `M(x0,y0) L(x0,y1) L(x1,y1) L(x1,y0)
L(x0,y0) Z` (starts lower-left, goes **up** first, clockwise, explicit closing
lineto then closepath), black, line width = current line width (0.4 pt
default; `every axis/.append style={thick}` gives 0.8), butt cap, miter join,
miter limit 10. Its bounding-box contribution includes half the line width
(F1).

**C3 — Clip path.** Exactly the box rectangle (PDF `re`, counter-clockwise from
(x0,y0)), no outset. Plot paths and embedded TikZ are inside it; markers are not.

**C4 — Ticks.** Style `every tick` = `very thin, gray`: line width **0.2 pt**,
gray 0.5 (DeviceGray), butt caps. Lengths: `major tick length` = 0.15 cm =
**4.26791 pt**, `minor tick length` = 0.1 cm = **2.84528 pt** (run-time read,
E01). One path per (axis, minor/major); each tick is a separate subpath
`M L`. x ticks: all bottom-edge ticks (left to right) then all top-edge ticks;
y ticks: left edge then right edge.
- `tick align=inside` (default): segment from the edge inward
  (bottom: (X,y0)→(X,y0+len); top: (X,y1)→(X,y1−len)).
- `outside`: from the outer end to the edge ((X,y0−len)→(X,y0)).
- `center`: from −len/2 to +len/2 across the edge.
- `tick pos=left` (or `xtick pos=left`): bottom and left only; `right`: top and
  right only. `xticklabel pos=right` moves only the labels.
- With `xtick=\empty` an empty (unpainted) tick path is still emitted.
Sources: manual styleoptions.tex `every tick (initially very thin,gray)`,
tickoptions.tex `major tick length`, `minor tick length`, `tick align`.

**C5 — Grid.** `every axis grid` = `thin, black!25`: line width 0.4 pt, gray
0.75. One path per (axis, minor/major); each grid line spans the full box
(x: (X,y0)→(X,y1); y: (x0,Y)→(x1,Y)), including lines on the box edges.
Drawn before the ticks. Source: manual styleoptions.tex `every axis grid`.

**C6 — Default plot line width** 0.4 pt, butt cap, miter join (TikZ defaults).

**C7 — Content order under the clip** (2026-11-27). Plot paths and embedded
TikZ are painted interleaved in source order (fixture embedded-tikz: a
`\draw` written before the first `\addplot` is painted before it). The
clip path is emitted even when nothing is drawn under it (single-point:
`only marks`). With `axis on top`, the clipped content comes first, then
grid, ticks, box and tick labels, then markers (axis-on-top). OBSERVED
(fixtures embedded-tikz, single-point, axis-on-top; Tier 2 paint order
checked).

**C8 — Plot marks.** Each mark is its own path (fill then stroke for
`*`-type marks), positioned only for points inside the box, painted
unclipped after the content (C1.6). Marks inherit the plot's dash pattern
(legend-marks: `\addplot+[mark=square*, dashed]` has dashed mark outlines)
except for the dashed cycle-list entries 5–9, whose marks are **solid**
(cycle-list fixture, all ten entries). Marks are PGF's plot marks
(`semantic/path/plot-marks.ts`). OBSERVED/CONFIRMED by Tier 2 on
cycle-list, addplot-plus, plot-options, legend-marks.

---

## D. Tick labels

**D1 — Placement.** An x tick label is a node with anchor `north` at
(X_tick, y0 − s); a y tick label has anchor `east` at (x0 − s, Y_tick), where
s = 0 for `tick align=inside`, `major tick length` for `outside`, half of it
for `center`. Labels on the top edge (`xticklabel pos=right`) use anchor `south`
at (X, y1 + s). The anchor includes the node's outer sep (TikZ default
0.5 × line width = 0.2 pt), inner sep is TikZ default 0.3333 em, font
`\normalsize`, content `$\pgfmathprintnumber{\tick}$` (`\axisdefaultticklabel`,
manual tickoptions.tex). The manual's general statement is
`anchor=near ticklabel` (axisdescription.tex); for boxed 2-D axes it resolves
to north/east as above. VERIFIED (E04: discovery seed 0, 160 axes; fresh seed 1,
200 axes; random tick label fonts `\tiny`–`\Huge`, tick align, tick lengths
0–10 pt, value ranges with 1–6 digit labels, scale only axis): max error
**0.0020 pt**. Data `e04-desc-seed{0,1}/desc.tsv`, `check-desc.py`.

**D2 — Line width dependence.** With `every axis/.append style={line width=3pt}`
the tick labels move outwards by (3 − 0.4)/2 = 1.3 pt: their outer sep follows
the line width (TikZ semantics). OBSERVED (E13 `thick`).

**D4 — `\ticknum`.** Automatic ticks and `xtick distance` count from the
grid point one step below trunc(lo/step) (trunc towards zero):
`\ticknum` of tick j·step is j − (trunc(lo/step) − 1). So the first drawn
tick has `\ticknum` 1 when lo ≤ 0 < first tick and 2 when 0 < lo
(default-axis x 1, y 2; negative-ranges, expression-plot, limits-enlarge,
description-styles all fit). For a degenerate data range (H2) the count
starts from the value before widening: single point (2,3) gives x ticks
1.8, 2, 2.2, 2.4 with `\ticknum` 0, 1, 2, 3 — the tick at the widened lower
limit 1.6 is **not drawn** although it is inside. Explicit lists number
their entries from 0 in list order (explicit-axis). OBSERVED on 24 axes
of the oracle fixtures (exact), not swept.

**D3 — Tick placement tolerance.** A tick (mark and label) is drawn when it lies
no more than `x tick placement tolerance` = 0.05 pt (manual tickoptions.tex)
outside the limits: limits [0.0001, 4.9999] (0.004 pt) keep ticks 0 and 5;
[0.01, 4.99] (0.39 pt) drop them. OBSERVED (E12).

---

## E. Axis descriptions (compat 1.18)

**E1 — xlabel.** Anchor `north` (including its outer sep) at
((x0 + x1)/2, b − label shift), where b is the bottom of the union of the x
tick label node boxes (node borders, *without* their outer sep); equivalently
`xlabel.north.y = min(xticklabel.south.y) + 0.2pt`. If there are no tick
labels (`xtick=\empty`), b = y0 − s (s as in D1: 0 inside, 4.268 pt outside).
Empty label nodes (`xticklabels={}`) still count (height 2 × inner sep).
`label shift` (initially 0pt) moves it further out. VERIFIED for b (E04, 360
axes, max **0.0019 pt**); no-tick-label and `label shift` cases OBSERVED (E14).
Source: manual axisdescription.tex `xlabel near ticks` (`at={(ticklabel
cs:0.5)}, anchor=near ticklabel`), `ticklabel cs` ("the length of the largest
x tick label"), `label shift`.

**E2 — ylabel.** Rotated 90° (reads bottom to top); anchor `south` (the side
facing the axis after rotation, incl. outer sep) at (l − label shift,
(y0 + y1)/2), where l is the left edge of the union of the y tick label node
boxes (without outer sep): `ylabel.south.x = min(yticklabel.west.x) + 0.2pt`.
VERIFIED (E04), max **0.0020 pt**. Source: manual `ylabel near ticks`.

**E3 — title.** Anchor `south` at ((x0 + x1)/2, y1 + 6pt), independent of
everything else measured. VERIFIED (E04), max **< 1e-5 pt**. Source: manual
styleoptions.tex `every axis title` (`at={(0.5,1)},above,yshift=6pt`; the shift
is `every axis title shift`, initially 6pt).
Surprise: with x tick labels on top (`xticklabel pos=right`) the title does
**not** move; it overlaps the labels (E14 `title-topticks-labels`: title south at
y1 + 6 pt, top labels reach y1 + 13.5 pt).

**E4 — Description font.** Text in the document font (LuaLaTeX: Latin Modern
`LMRoman10-Regular` 10 pt); tick labels are math (`CMR10`, `CMMI10` for the
decimal point).

---

## F. Bounding box

**F1 — Picture/axis bounding box** = union of
- tick marks outset by half *their* line width (tick-styles fixture:
  `tick style={thick}` gives x0 − 0.4 pt; OBSERVED, 1 case),
- with `clip=false`, plots and embedded TikZ, outset by half their line
  width (axis-on-top: a 0.4 pt `\draw` to (5,5) puts the box edge at
  its endpoint + 0.2 pt; OBSERVED, 1 case),
- the box rectangle outset by half its line width (0.2 pt default; 1.5 pt with
  `line width=3pt`),
- tick label, xlabel, ylabel, title node boxes (border without outer sep),
- marker paths (geometric extent, **no** line-width outset: mark size 6 pt at
  the box corner gives x1 + 6.000 pt),
- unclipped embedded TikZ (e.g. a node with `clip=false`).
Clipped content (plots, `\draw` outside the limits with `clip=true`) does
**not** enlarge it. `current axis.outer …` anchors equal this box. OBSERVED
(E13, 14 cases; union reproduced to 1e-4 pt where only nodes and box
contribute). Default axis: [−19.644, 195.198] × [−13.310, 162.199].

---

## G. Default plot styling

**G1 — Default cycle list (`cycle list name=color`)**, period **10** (index 10
repeats index 0). Index = position of the `\addplot` among all plots of the
axis, including those with explicit options (manual markers-meta.tex,
`cycle list`). Measured (E06, Tier 2 colours exact):

| i | line colour (RGB) | dash | mark | mark fill |
|---|---|---|---|---|
| 0 | blue (0,0,1) | solid | `*` | blue!80!black (0,0,0.8) |
| 1 | red (1,0,0) | solid | `square*` | red!80!black (0.8,0,0) |
| 2 | brown!60!black (0.45,0.3,0.15) | solid | `otimes*` | brown!80!black (0.6,0.4,0.2) |
| 3 | black | solid | `star` | — |
| 4 | blue | solid | `diamond*` | blue!80!black |
| 5 | red | densely dashed [3pt on, 2pt off] | `*` | red!80!black |
| 6 | brown!60!black | densely dashed | `square*` | brown!80!black |
| 7 | black | densely dashed | `otimes*` | gray 0.5 |
| 8 | blue | densely dashed | `star` | — |
| 9 | red | densely dashed | `diamond*` | red!80!black |

Note the mark fill of entry 2 is brown!80!black, not a mix of the line colour.
Mark size 2 pt (TikZ `mark size` initially 2pt); marks stroked with the line
colour, line width 0.4 pt. Mark geometry is PGF's plotmarks (`*`: circle r = 2
as four Béziers + final moveto to the centre; `square*`: ±2; `diamond*`: ±1.5 ×
±2; `otimes*`: circle + two diagonals; `star`: five rays starting upward).
CONFIRMED (manual shows the list only as a picture; values measured).

**G2 — Option semantics.** OBSERVED (E06 `variants`, `plus`):
- `\addplot[opts]`: cycle list ignored; black line, no marks unless `mark=`
  given (`mark=*` is then filled and stroked in the current colour).
- `\addplot+[opts]`: cycle entry, then opts. `\addplot+[green]` or
  `[color=green]` or `[draw=green]` changes line and mark stroke, but the
  **mark fill stays** the cycle's (blue!80!black); `mark options={fill=…}`
  changes it. `+[only marks]` draws no line. `+[mark=none]` removes marks.
  `+[thick]` thickens line and mark stroke.

---

## H. Automatic limits

**H1 — Enlargement.** Data range [a, b] per axis (only points inside any
explicitly given limits of the *other* axis count, and only points on the free
side of a given limit of the same axis; manual specifyrange.tex `xmin`, "clip
limits"). Default `enlarge x limits=auto` (manual, initially auto) = relative
0.1, applied only to limits not given explicitly:
```
lo = a - 0.1 (b - a)    (if xmin not given)
hi = b + 0.1 (b - a)    (if xmax not given)
```
where (b − a) uses the given limit if one side is fixed (xmin=0.5, data max 3
→ xmax = 3 + 0.1 × 2.5 = 3.25). `true` = both sides even when given (xmin=0.5,
true → [0.25, 3.25]); `false`/`0` = tight; `<v>`, `value=<v>`, `rel=<v>`:
fraction v; `upper`/`lower`: one side only (fraction 0.1 unless `value=`);
`abs=<v>`: v data units per side; per-axis `enlarge x limits` overrides
`enlargelimits`. VERIFIED (E07: discovery seed 0, 120 random ranges; fresh seed
1, 150 ranges, 12 option sets): max canvas error **0.0027 pt** for all forms
above, outside the precision regime N2. Data `e07-limits-seed{0,1}`,
`check-limits.py`.

**H2 — Degenerate range.** If after enlargement lo = hi = v, the axis becomes
[v − 0.2|v|, v + 0.2|v|], or [−1, 1] when v = 0. Relative enlargement of a zero
range is zero, so a single point gives ±20 % for `auto`, `true`, `0.3`,
`upper`, `false` alike; `abs=3` gives [v − 3, v + 3] (no widening). Single point
(2,3) → x [1.6, 2.4], y [2.4, 3.6]; (0,0) → [−1,1]². VERIFIED on the
special cases in E07 (both seeds share them, so this is OBSERVED on ~15
cases, exact).

**H3 — Empty axis.** No plots and no limits: the data range is [0, 1]² and
is **enlarged like data** (default: [−0.1, 1.1]², ticks 0, 0.2, …, 1). The
original entry said "no enlargement", inferred from the tick list only; the
empty-axis fixture's rectangle, tick label positions and Tier 2 trace show
the 10 % enlargement (corrected 2026-11-27, max error 0.003 pt). The limits
probe (`\pgfplotsextra`) does not run in an empty axis. `\draw`/`\node` at
`axis cs` do not update limits. OBSERVED (E07, E14, empty-axis fixture).

**H4 — `enlargelimits={abs=<dimen>}`** (e.g. 1cm): limits grow so that the data
range occupies about (box length − 2 dimen); applied after H2 widening.
Measured box/ratio errors up to 0.12 pt and the box size itself changes by up
to ±0.09 pt (e.g. 161.924 instead of 162). **OPEN** for exactness; the manual's
`enlargelimits respects figure size` hints at an iteration.

**H5 — `xmin > xmax`**: the axis fails (no output probe). Should be diagnosed.

---

## I. Automatic tick placement (linear axes)

Read at run time (E01): `\axisdefaulttickwidth` = **35** (initial `max space
between ticks`), `\axisdefaulttryminticks` = **4** (initial `try min ticks`).

**I1 — Step and list.** For final limits [lo, hi] and axis length L (box side
in pt):
```
n    = max( floor(L / msbt), tmt - 1 )           msbt = max space between ticks (35), tmt = try min ticks (4)
raw  = (hi - lo) / n
k    = floor(log10(raw)),  m = raw / 10^k        (1 <= m < 10)
step = 10^k * (1 if m < 1.5, 2 if m < 3.5, 5 if m < 7.5, else 10)
ticks = { j*step : j integer, lo - tol <= j*step <= hi + tol },  tol = 0.05pt in data units (D3)
```
Candidate steps are only {1, 2, 5} × 10^k (never 2.5, 0.25, 3, …). Ticks are
multiples of the step (not offsets from lo). The step does not depend on `lo`,
tick label font, label width, `text width`, `xlabel`, or number format
precision.
Thresholds, bisected (E09, to 1e-6 relative): transitions in L lie at exact
multiples of 35 (245.0011, 490.0008, 174.99993, 350.0000, 735.0020 pt; the
±0.002 pt is N1 noise); transitions in range lie at n × {1.5, 3.5, 7.5} ×
10^k (0.0749995, 0.0174999, 0.0374999, 7.49995, 1.74999, 3.74999 at n = 5;
0.119998, 0.279998, 0.599998 at n = 8), i.e. the thresholds are 1.5/3.5/7.5
with pgfplots reaching them ~6e-6 relatively early (do not emulate).
VERIFIED: rule proposed on E08 `range`/`length` + E09, `n` floor corrected
on E08 `random` seed 1 (600 axes), then fresh: seed 2 random (600 axes, 0
mismatches), `msbt` seed 3 (msbt 20–100, tmt 2–8; 600 axes, 0 mismatches after
I1b), `font` seed 4 (fonts, text width, precision; 600 axes, 0 mismatches).
The one mismatch in seed 1 is a tick 1e-6 inside the placement tolerance
(N2). Data `e08-ticks-*`, `e09-tick-bisect/transitions.tsv`,
`check-ticks.py`.

**I1b — Few-ticks fallback.** After I1, count the grid points
{ j*step : trunc(lo/step) ≤ j, j*step ≤ hi } where trunc rounds **toward zero**;
while that count is < 2, replace step by the next smaller nice value
(10 → 5 → 2 → 1 → 0.5 …). The drawn ticks are still those inside
[lo − tol, hi + tol]; this can leave a single tick. It only matters when
n ≤ 2 (small axes with `try min ticks` ≤ 3, or large msbt); with the default
tmt = 4 it never fires. Found on E10 (L 10–160 × tmt 1–6) and E15 (sliding
window r = 8100, L = 50, tmt = 2: 60/60), VERIFIED on fresh E08 `fewticks`
seed 5 (566 axes, L 15–125 pt, tmt 1–3, 0 mismatches) and
retro-explains the 3 msbt seed 3 mismatches. Some tiny axes with
`try min ticks=1` make TeX itself fail with "Arithmetic overflow" (seed 5
cases t11, t47, t58).

**I2 — Minor ticks.** `minor tick num=N` (initially 0; `minor x tick num`)
puts N equally spaced minor ticks in every major interval, also in the
intervals that extend beyond the first/last drawn major tick, then keeps those
within the limits (limits [0.3, 4.6], step 1, N = 1 → minor at 0.5 … 4.5).
Minor ticks never coincide with major ones. Explicit `minor xtick={…}` draws
exactly the list. Drawn with `minor tick length` and the minor tick path
before the major one (C1/C4). OBSERVED (E12, 5 cases).

**I3 — `xtick distance=d`**: ticks at all integer multiples of d inside the
limits (d = 0.7 → 0, 0.7, …, 4.9; d = 2 on [0.3, 4.6] → 2, 4). OBSERVED (E12).

**I4 — Tick lists.** `xtick={…}` uses `\foreach` list semantics (PGF):
`{0,0.5,...,3}`, `{0.2,0.9,...,4.5}` → 0.2, 0.9, …, 4.4; `{-1,1,2,...,4,4.5}` →
−1, 1, 2, 3, 4, 4.5. Entries outside the limits (± tolerance) are dropped.
`xtick=data` = the x coordinates of the plot (one plot tested).
`xtick=\empty` = no ticks and no labels; **`xtick={}` = automatic ticks** (same
as not setting it). OBSERVED (E12).

---

## J. Tick label numbers and scaled ticks (linear axes)

**J1 — When the common factor appears** (`scaled ticks=true`, initially true,
manual tickoptions.tex): with e = floor(log10(max(|lo|, |hi|))) of the final
limits, the factor 10^e is taken out iff **e ≥ 4 or e ≤ −2** (so `scale ticks
above exponent` behaves as 3 and `below exponent` as −1 — manual: factor out
when e > above / e < below). It depends on the magnitude of the limits, not on
the range: [10000, 10001] is scaled by 10^4 (labels all "1"); [1000, 2000] is
not. The tick step is the same with or without scaling. VERIFIED: discovery E11
`decades` (354 axes, 1e-7 to 1e7, offsets), fresh E11 `random` seed 1 (400
axes): **0** decision/exponent mismatches. Data `e11-scaled-*`,
`check-scaled.py`.

**J2 — Label strings.** label = `\pgfmathprintnumber{t / 10^e}` (e = 0 when not
scaled) with PGF's default number format: `std`, precision 2, so fixed notation
for exponents −1 … 4 and sci `m·10^e` otherwise (PGF source
`pgfmathfloat.code.tex`: std lower bound = −precision/2 = −1, upper 4);
thousands separator `,` (`1,000`); trailing zeros dropped; minus sign is math
`−`. Examples: 0.02 → `2·10^{-2}` (unscaled [0, 0.1] axis), 0.1 → `0.1`.
VERIFIED on the same sweeps: remaining mismatches are (a) harness glyph-to-node
misassignment where labels overlap, (b) exact halfway values (1.015, 0.305,
9.85) that PGF rounds differently from Python's `round` — follow PGF's
rounding code.

**J3 — The scale label.** Text `$\cdot 10^{e}$` (`tick scale binop`, initially
`\cdot`). Placement (manual styleoptions.tex `every x tick scale label`, compat
≥ 1.8):
- x: `at={(xticklabel cs:0.9,5pt)}, anchor=near xticklabel, inner sep=0pt`
  → node `north` (incl. 0.2 pt outer sep) at (x0 + 0.9 W, b − 5pt), b as in E1.
- y: `at={(yticklabel* cs:1.03,-0.3em)}, near ticklabel align=outside, anchor=near
  yticklabel opposite, inner sep=0pt` → node `south west` (incl. outer sep) at
  (x0 + 3pt, y0 + 1.03 H).
CONFIRMED to 0.002 pt (E11, all scaled axes). The xlabel is **not** moved by
the x scale label (they can overlap; E14 `xlabel-scaled`).

**J4 — `\tick` is the scaled value.** Inside `xticklabel` code `\tick` is
t / 10^e when scaling is active. Consequence for the harness: its tick
`value` is the scaled value on scaled axes (E04/E11).

---

## K. Implementation cross-checks (2026-11-27)

The evaluator (`packages/core/src/pgfplots/`) reproduces all of A–J on 28
hand-written fixtures (`test/pgfplots-oracle-compare.spec.ts`): structural
geometry to ≤ 0.009 pt, text boxes and glyphs to ≤ 0.010 pt where the
editor's text engine has the font. Found on the way:

- **K1 — TikZ node `em` and `mid`.** `inner sep=.3333em` and the `mid`
  anchor's `.5ex` are evaluated outside the node's text box, in the
  ambient font, not in the node's `font=` (axis `font=\small`: tick label
  inner sep 3.333 pt, not 3.0; `mid` 2.153 pt above the baseline). PGF:
  `\tikz@textfont` is applied inside the text box only; `\anchor{mid}` in
  pgfmoduleshapes.code.tex. Fixed in the TikZ node layout.
- **K2 — The editor's default font size was 9.96264 pt** (10 bp) instead of
  `\normalsize` = 10 pt; every text box came out 0.37 % small (0.065 pt
  on a tick label, 0.17 pt on the picture box). Set to 10 pt.
- **K3 — `densely dashed`/`loosely dashed`** were [4,2]/[6,4] in the
  editor; tikz.code.tex says on 3pt off 2pt / on 3pt off 6pt. Fixed.
- **K4 — Text at 8–9 pt** (e.g. `label style={font=\small}`) is set by
  LuaLaTeX in LMRoman9/LMRoman8 with their own metrics; the editor's text
  engine has only lmroman10/12/17 and scales lmroman10, so such labels are
  up to 0.6 pt wide off (description-styles, axis-font-thick). Math at
  8 pt (CMR8) is right. Not a pgfplots rule; recorded as the cause of
  those two fixtures' text findings.
- **K5 — Oracle `map` probe at large magnitudes.** With limits ≈ 1e4
  (scaled-ticks: y ∈ [10100, 32900]) the `axis cs` probe points are 0.16 pt
  off the oracle's own `rel axis cs` rectangle, while the plotted data in
  Tier 2 match ours to 0.002 pt: probe noise (N2), not a rule.

## Surprises (manual silent or different)

1. The size model's 45 pt is truly constant; descriptions never feed back into
   the box (manual says so; confirmed even for `\Huge` labels).
2. `try min ticks=4` acts as "at least tmt − 1 = 3 intervals", not 4 ticks
   (I1). Default small axes therefore show as few as 3 ticks.
3. Few-ticks fallback counts from trunc-toward-zero of lo (I1b): undocumented.
4. `xtick={}` means automatic; only `xtick=\empty` removes ticks.
5. Degenerate ranges widen by ±20 % of |v| even with `enlargelimits=false`.
6. Cycle entry 2's mark fill is brown!80!black; entry 7 fill gray. `+[colour]`
   does not change mark fills.
7. Markers are painted after all embedded TikZ and outside the clip.
8. The title ignores top tick labels; the xlabel ignores the scale label.
9. Scaling is decided by the limits' magnitude, not range (so [1e4, 1e4+1]
   gets six "1" labels).
10. Empty axis: `\pgfplotsextra` code is not executed.
11. A degenerate range drops the tick on its widened lower limit (D4).
12. Dashed cycle-list entries draw solid marks; a user `dashed` dashes marks (C8).

## Harness notes (to upstream into `scripts/pgfplots-oracle`)

- **Crash on scaled ticks**: the tick-label name probe
  (`xticklabel style={name=…\ticknum}`) is also applied to the tick-scale
  label, where `\ticknum` is undefined → "Undefined control sequence". The
  experiments define `\ticknum` as `S` globally (`lib.ts`), which names the
  scale label node `…-xS`/`-yS` and leaves painting identical
  (`disturbance.mts`). Upstreamed into the harness (harness version 2,
  2026-11-27): `\ticknum` is `S` outside tick labels.
- **Extra ticks** (`extra x ticks`) reuse `\ticknum`, so `assembleTier1` throws
  "reported twice with different values".
- **Case ids** must match `[A-Za-z0-9-]` (no `.` or `_`).
- `\tick` on scaled axes is the scaled value (J4); Tier 1 tick `value` should
  be multiplied by 10^e or the factor recorded.
- Useful additions: return raw records from `runOracleCases` (experiments read
  them from the cache), a generic custom-record macro (`\xrec`), a named-point
  reader (`\xpt`), Tier 2 tick-mark extraction (E12 does it from gray 0.2 pt
  strokes on the box edge, classified by length).
- Glyph-to-node text assignment fails when neighbouring tick labels overlap.

## Not done

- Log axes (ticks, labels, limits), `axis lines` variants, `x dir=reverse`,
  `axis equal`, legends (geometry, `legend pos`), `xticklabel` rotation,
  bar plots, 3D.
- `enlargelimits={abs=<dimen>}` exact rule (H4).
- Minor tick rules beyond the observed cases (e.g. with `xtick distance`).
- Number formatting edge cases (rounding ties) — follow PGF source.
- `extra x ticks` (harness limitation).

---

## V. Tables (and how the axis body is read)

Experiments E16 (`e16-syntax.mts`, axis-body syntax) and E17
(`e17-tables.mts`, 44 table cases). Each case plots into fixed limits; the
digest (`experiments/digest.ts`) gives the painted path in data units, so
these are exact (discrete) observations. All are held by
`test/pgfplots-tables.spec.ts` (the same inputs, expected paths copied from
the TeX digests) and `test/pgfplots-parse.spec.ts`.

**V0 — Reading the axis body.** OBSERVED (E16, one case each, exact):
- `\addplot[a][b] {…}` applies `a` then `b`, as one list (also with `+`).
- `\pgfmathsetmacro`, `\pgfmathtruncatemacro`, `\def` in the body take
  effect in order for the plots after them (an expression or coordinate
  sees the value current at its `\addplot`). Embedded TikZ (`\draw`,
  `\node`) is executed at `\end{axis}` and sees the **final** value: two
  `\draw (axis cs:\va,0)…` around a redefinition both use the last value.
- `\foreach`, `\pgfplotsforeachungrouped`: each iteration's `\addplot` is a
  plot of the axis (cycle list advances); its input (expression,
  coordinates, inline table) sees the loop value, but its **options** and
  any TikZ statement in the loop are evaluated after the loop and TeX stops
  with "Undefined control sequence" (manual basic.reference.tex says so for
  TikZ). `\pgfplotsinvokeforeach{list}{… #1 …}` substitutes `#1`
  everywhere and works for both. The editor draws every iteration and warns
  (`pgfplots-foreach-late-variable`) where TeX would stop.
- A brace group `{ \addplot …; }` in the body is transparent; stray text
  (`],` left after the options) draws nothing.
- pgfmath accepts `<`, `<=`, `>`, `==`, `&&`, `and(…)` in expressions, and an
  unclosed `(` at the end of an expression (`{0.4 + 1.1*(x-0.8 }`).
- `[yshift=3pt]` after the input (trailing path) moves nothing that is
  already drawn.

**V1 — Header.** The first line that is neither skipped, empty nor a
comment is a header iff one of its cells is not a number (`header=true`,
initial); `header=false` makes it data, `header=has colnames` makes it
names even when numeric (`x=3` then names the column called "3").
Without a header, columns are named by their indices. CONFIRMED (manual
pgfplotstable.tex `header`; E17 `no-header-default`, `header-false`,
`has-colnames`).

**V2 — Column selection.** `x`/`y` (name) beats `x index`/`y index`;
initially `x index=0`, `y index=1`; `x expr`/`y expr` replace the value and
may use `\thisrow{name}`, `\thisrowno{i}`, `\coordindex`, `\lineno`.
CONFIRMED (manual axis-addplot.tex; E17 `names`, `index`, `name-over-index`,
`x-expr-only`, `y-expr-columnx`).

**V3 — Lines.** Rows end at newlines (`row sep=newline`) or at `\\`
(`row sep=\\`; `row sep=crcr` is the same — undocumented but written by
matlab2tikz, E17 `crcr`). In an **inline** table TeX has already removed
each `%` comment *together with its end of line*, so `1 2 % c⏎3 4` is one
row `1 2 3 4` and a line holding only `% c` vanishes (E17
`trailing-percent`, `percent-line-empty`). The newline right after the
opening brace makes an empty first line (manual `skip first n` example, E17
`expr-lineno-skip`). `#` (and `comment chars`) start a comment to the end of
the line; in a file `%` does too (`percent is letter=false`). `ignore
chars` are removed, `white space chars` become spaces. OBSERVED (E17).

**V4 — Unbounded and filtered coordinates.** A point with `nan`, `inf`,
`-inf` (or a cell that is not a number) is dropped: with `unbounded
coords=discard` (initial) the line connects its neighbours, with `jump` it
is interrupted. Such points do not count for the limits. A point alone
between two jumps paints nothing (its moveto is dropped; the Tier 2
comparison ignores moveto-only subpaths too). CONFIRMED (manual
2dplots.tex `unbounded coords`; E17 `nan-discard`, `nan-jump`,
`nan-limits`).

**V5 — Empty lines** are jumps (compat ≥ 1.4, `empty line=auto`);
leading ones do nothing. CONFIRMED (E17 `empty-line`).

**V6 — `\coordindex` and `\lineno`.** `\coordindex` counts data rows from
0, including rows later discarded (nan), not comments, empty lines or the
header. `\lineno` counts every line from the first (skipped lines, header,
empty lines; in a file also comment lines), from 0. OBSERVED (E17
`expr-coordindex`, `expr-lineno`, `coordindex-nan`, `expr-lineno-skip`).

**V7 — `skip first n`** skips the first n lines counted as in V6 before the
header is looked for. OBSERVED (E17 `skip-first`, `skip-first-brace`).

**V8 — Separators.** `col sep=comma|semicolon|colon|tab|&` split at that
character; cells are trimmed for number reading (`1, 2` reads); `col
sep=&` turns on `trim cells`. CONFIRMED (E17 `comma`, `semicolon`,
`colon`, `ampersand`).

**V9 — A short row** (fewer cells than the selected column) keeps the
value the column had in the previous row. OBSERVED (E17 `short-row`, one
case; probably an artefact of TeX macro reuse, reproduced as measured).

**V10 — Coordinate filters** (manual coordfiltering.tex): `each nth
point=n` keeps `\coordindex` 0, n, 2n, … (as a plot option or a table
option); `restrict expr to domain={e}{a:b}` sets x to ∓inf where e is
outside [a, b] (inclusive) and switches `unbounded coords=jump`; the
starred form sets x itself to a or b (not e); limits use only the
surviving points. `skip coords between index={b}{e}` drops b ≤ i < e
(documented, not measured). OBSERVED (E17 `each-nth*`, `restrict-expr*`).

**V11 — `\pgfplotstableread[opts]{arg}\macro`.** The argument is inline
data when it holds a row separator (newline, or `\\` with `row sep=\\`),
otherwise a file name (manual `table/format=auto`); `\addplot table
[x=…]{\macro}` then plots it. `\pgfplotstableset{k=v}` is
`\pgfplotsset{table/k=v}` and applies to later tables. Cells: `+1`, `.5e1`,
`2E0`, `1e-0` all read. OBSERVED (E17 `pgfplotstableread*`, `table-set`,
`numbers`).

**V12 — Files.** `\addplot table {name}` reads `name` as written, relative
to the main document (manual `search path`, initially `.`). The editor
reads it through the document resolver (`readTextFile`); see
`design/pgfplots.md` open question on file-backed tables. Not measured
(the harness has no file fixture).

Performance (not a rule): a 20,000-row inline table (x y) evaluates in
~45 ms warm (whole axis), table reading ~20 ms; with `x expr`/`y expr`
compiled once per plot.

## Y. Document lengths

Experiment E18 (`e18-lengths.mts`, 11 cases) and direct LuaLaTeX runs.

**Y1 — Class values.** LuaLaTeX (TeX Live 2023) after `\begin{document}`:
article 10pt letter `\textwidth` = `\linewidth` = `\columnwidth` = 345pt,
`\textheight` 550pt; 11pt 360 / 541.40024; 12pt 390 / 548.5; `a4paper`
textheight 598 / 595.80026 / 592; `twocolumn` textwidth 469 (letter) or
452 (a4), columnwidth (textwidth − 10)/2; standalone: article's widths,
`\textheight` = `\maxdimen`; amsart 360 / 584; beamer 307.28987 /
269.14662. Paper: letter 614.295 × 794.96999, a4 597.50787 × 845.04684.
Classes not installed here (IEEEtran, revtex, llncs, elsarticle) are not
known; the editor assumes article 10pt for them and for a bare picture and
says so (`pgfplots-assumed-document-length`, a warning: the diagnostics
model has no info level).

**Y2 — Use in axis options.** `width=0.5\textwidth`, `0.48\linewidth`,
`{0.9\columnwidth}`, `\textwidth/2.3`, `0.5*\columnwidth`, a register set
with `\newlength`/`\setlength` in the preamble, a `\def` macro, and
`0.2\textheight` all give the box predicted by A2 from the TeX value of the
length. VERIFIED on E18 (10 cases): max error **0.0035 pt**.

**Y3 — `\axisdefaultwidth` is a macro, not a length.** It holds `240pt`
(A1), so `0.8\axisdefaultwidth` is the text `0.8240pt` and pgfplots stops
("Plot width 0.824pt is too small"); `1\axisdefaultwidth` is 1240pt (E18
`axisdefault-text`, box 1240.0028pt). The editor substitutes it as text.
