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
  engine scaled lmroman10, so such labels were up to 0.6 pt wide off
  (description-styles, axis-font-thick). Math at 8 pt (CMR8) was right.
  Not a pgfplots rule. **FIXED (2026-11-27)**: the default (TU, fontspec-less)
  text profile now follows tulmr.fd/tulmss.fd/tulmtt.fd with NFSS's
  half-open size ranges (`<8.5-9.5>` = 8.5 ≤ size < 9.5) and substitutions,
  checked against LuaLaTeX's `\fontname` for every size command × 19
  family/series/shape combinations in the 10/11/12pt article classes:

  | size (pt) | rm m/n | rm bx/n | rm it | rm sl | sf m/n, sl, it | tt m/n |
  |---|---|---|---|---|---|---|
  | 5 | lmroman5 | lmroman5-bold | lmroman7-italic | lmromanslant8 | lmsans8 | lmmono8 |
  | 6 | lmroman6 | lmroman6-bold | lmroman7-italic | lmromanslant8 | lmsans8 | lmmono8 |
  | 7 | lmroman7 | lmroman7-bold | lmroman7-italic | lmromanslant8 | lmsans8 | lmmono8 |
  | 8 | lmroman8 | lmroman8-bold | lmroman8-italic | lmromanslant8 | lmsans8 | lmmono8 |
  | 9 | lmroman9 | lmroman9-bold | lmroman9-italic | lmromanslant9 | lmsans9 | lmmono9 |
  | 10, 10.95 | lmroman10 | lmroman10-bold | lmroman10-italic | lmromanslant10 | lmsans10 | lmmono10 |
  | 12, 14.4 | lmroman12 | lmroman12-bold | lmroman12-italic | lmromanslant12 | lmsans12 | lmmono12 |
  | 17.28, 20.74, 24.88 | lmroman17 | lmroman12-bold | lmroman12-italic | lmromanslant17 | lmsans17 | lmmono12 |

  At every size: rm bx/it lmroman10-bolditalic, rm bx/sl lmromanslant10-bold,
  rm m/sc and sf m/sc lmromancaps10, rm bx/sc = rm bx/n of that size (bx/sc
  is undeclared; NFSS falls back to the n shape), sf bold (any shape)
  lmsans10-bold/-boldoblique, tt bold lmmonolt10-bold/-boldoblique, tt it
  lmmono10-italic, tt sl lmmonoslant10, tt sc lmmonocaps10. Class sizes:
  10pt `\tiny`…`\Huge` = 5, 7, 8, 9, 10, 12, 14.4, 17.28, 20.74, 24.88;
  11pt = 6, 8, 9, 10, 10.95, 12, 14.4, 17.28, 20.74, 24.88; 12pt = 6, 8,
  10, 10.95, 12, 14.4, 17.28, 20.74, 24.88, 24.88. Range edges: 15pt is
  already lmroman17 but still lmsans12 (tulmss `<11-15.5>`).
  Two neighbouring findings on the way: (a) interword glue of a
  natural-width TikZ node is the font's space and extra space
  (`a: b` gets fontdimen 7 after the colon), not `.3333em`/`.5em`: TikZ
  sets `\spaceskip.3333em \xspaceskip.5em` only inside the minipage of a
  `text width` node (tikz.code.tex `\tikz@text@action`); (b) Latin Modern
  Mono is loaded without TeX ligatures (tulmtt.fd has no
  `\UnicodeFontTeXLigatures`): `--` stays two hyphens, `` ` ``/`'` stay
  the ASCII grave/straight quote. Verified by
  `test/tex-lm-optical-text-oracle.spec.ts` (fixture from
  `scripts/capture-lm-optical-text-oracle.mjs`): 570 selections, 192
  distinct (face, size) pairs × 197 strings = 37,824 `\wd/\ht/\dp` boxes,
  max error 0.0002 pt at a 0.005 pt tolerance; the only exclusion is the
  width of 4 accented strings in italic and small-caps faces, whose pair
  kerns with non-ASCII letters the generated tables do not carry (an
  existing generator limit, see the spec). description-styles and
  axis-font-thick now pass both tiers with no KNOWN entry; E17 `heights`
  (`\Large`), `entryopts` and `font` (`\small` legend) pass. `font` also
  needed the legend matrix's `mid` from the ambient font: an empty text
  box with `text height`/`text depth` (the legend matrix) keeps `mid` at
  .5ex of the surrounding font (2.155 pt), as K1.
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

## Q. Log axes

Experiments E16–E20 (`e16-log-explore.mts`, `e17-log-ticks.mts <sweep> [seed]`
with checker `check-log-ticks.py`, `e18-log-probe.mts`, `e19-log-bisect.mts`,
`e20-log-minor-bisect.mts`), fixtures `log-*`. Harness version 3 records
the scale per direction; on a log direction Tier 1 limits, `\tick` and the
map are internal coordinates (below).

**Q1 — Internal coordinate and modes.** A log direction works in the
logarithm of the data value: natural log by default, log_b with
`log basis x=b`. `\pgfkeysvalueof{/pgfplots/xmin}` and `\tick` are that
logarithm (e.g. `xmin=1e-10` reads −23.02582; with `log basis x=2`,
`xmax=64` reads 6.00073, i.e. TeX's fixed-point ln 2 — 0.024 pt on a 195 pt
axis, not emulated). The data-to-canvas map is B1 applied to internal
coordinates. `semilogxaxis`/`semilogyaxis`/`loglogaxis` are `xmode`/`ymode`
`=log` (manual axis-addplot.tex); **every axis environment sets both modes
at its start**, after `\pgfplotsset` defaults: a bare
`\pgfplotsset{xmode=log}` before `\begin{axis}` changes nothing (fixture
log-pgfplotsset-mode: the x axis stays linear on [−51.1, 550.1]), while
`every axis/.append style={xmode=log}` and axis options do (log-xmode-discard).
`\pgfkeysvalueof{/pgfplots/xmode}` has no stored value (reads `\pgfkeys@relax`).
CONFIRMED (manual + 3 fixtures, exact).

**Q2 — Limits.** Automatic limits and `enlargelimits` (H1) act on internal
coordinates: data 1…1000 → ln range [0, 6.90775] → enlarged
[−0.69081, 7.59856] (E16 `ll-1-1000`; fixtures log-loglog-default,
log-semilogy-grid, log-xmode-discard to < 0.003 pt). A point whose
coordinate on a log direction is ≤ 0 is discarded as a whole (also its other
coordinate drops out of the other direction's range: E16 `sy-neg` x range
from the kept points only), and the line joins its neighbours
(`unbounded coords=discard`, initially; log-xmode-discard Tier 2).
`enlarge x limits={abs=v}` adds log v (manual specifyrange.tex,
"multiplicatively"; implemented, not measured). Degenerate ranges on log
axes: not measured. CONFIRMED/OBSERVED.

**Q3 — Automatic ticks** (display exponents d = internal/ln 10, or the
internal value itself when `log basis` is set; lo, hi the limits in d; L the
axis length; f = floor(L / `max space between ticks`)):
```
R     = hi − lo + δ                δ = 0.001 internal units (0.000434 decades)
k     = max(1, floor(R / max(f, 2)))
s     = floor(lo') + 1             lo' = lo nudged away from 0 (exact decades: 1e2 → 2, 1e-3 → below −3)
c     = #{ s + j·k ≤ hi + δ, j ≥ 0 }
if c ≥ (k = 1 ? 2 : 3):            decade mode
   k ≥ 2: ticks s + j·k inside [lo − tol, hi + tol], \ticknum j (from 0).
          The decade at an exact positive lower limit is skipped (lo = 0 → 1, 1+k, …).
   k = 1: every integer d inside [lo − tol, hi + tol]
else:                               fractional mode
   step = nice(R / max(f − 1, 2))   nice: {1,2,5}·10^n with thresholds 1.5/3.5/7.5 (as I1)
   while #{j : trunc(lo/step) ≤ j, j·step ≤ hi} < 2: step = next smaller nice value (as I1b)
   ticks j·step inside [lo − tol, hi + tol]
\ticknum (k = 1 and fractional) = j − floor(lo'/step)
```
tol = 0.05 pt in internal units (D3). Thresholds bisected (E19, 16
transitions at L = 120, 195, 300): fractional steps switch at
R·(f−1)^{-1} = 1.5/3.5/7.5·10^n, decade mode starts where c reaches 2
(L = 195: R = 2), integer k at R = n·k (195 pt: 10, 15 …; 300 pt: 16); every
transition sits 0.00043 decades = 0.001 internal units early (δ). The
manual's prose ("if log plots contain just one (or two) positions 10^i …
feasible step sizes as in the linear case", tickoptions.tex) is the
fractional mode; the c ≥ 2 / c ≥ 3 acceptance and s = floor(lo')+1 are
undocumented. `try min ticks` (linear) has no effect on log directions.
Discovery: E17 `range`, `offset`, `length`, `smallL` (1162 axes), fresh
validation: E17 `random` seed 1 (326 axes, L 25–625, exponents ±30, R 0.05–60)
and `msbt` seed 2 (249 axes, msbt 20–100, try min ticks 2–8): **0 mismatches in
decade mode; 19 of 575 axes in fractional mode differ** — all by the
fixed-point drift of Q3b (an edge tick in or out, `\ticknum` shifted by
it). VERIFIED for decade mode; step choice VERIFIED for fractional mode,
tick values approximate (Q3b).
- **Q3b — Fractional-step drift (OPEN).** TeX's fractional ticks are not exact
  multiples: tick_j = d₀(1+ε) + j·step·ln10 with `step·ln10` rounded to 5
  decimals (0.02 → 0.04605) and an offset growing with |d|: ε ≈ +2e-4
  (step 0.02), +6e-5 (0.05, 0.1), −1.7e-5 (0.2), −5.6e-4 (0.01), ~0 (0.5);
  e.g. 10^{8.14} sits at d = 8.14172 (`h.tex` probe: `\tick` 18.747 for
  8.14·ln 10 = 18.7430). Not emulated: on fixtures with |d| ≲ 1 it stays
  below 0.01 pt (log-small-range); at |d| ≈ 10 a narrow axis is off by up to
  ~1 pt. The cause looks like pgfplots' fixed-point arithmetic; pgfmath
  candidates (`10^…`, `exp`, `ln`) did not reproduce it.
- **Q3c — `try min ticks log`** (manual, initially 3) changes the fractional
  step in a way not yet captured (E17 `tmtlog` seed 3: with 5 the effective
  divisor is 3 at f = 3; with 7 it is 5; with 2 it is 1 at f = 1). OPEN;
  the evaluator implements only the initial value and diagnoses others.

**Q4 — Minor ticks and labels.** In decade mode with k = 1 and display
basis 10, minor ticks are at d = i + log10(m), m = 1…9 (m = 1 coincides
with a major tick and is drawn as a minor mark too), for decades
i = floor(lo') … floor(hi + δ + 0.5) − 1, inside [lo − tol, hi + tol]: the
decade above the last major tick gets its minor ticks only when
hi + δ ≥ last + 0.5 (E20, bisected at 6 configurations to 1e-5: always
last + 0.49958). No minor ticks in fractional mode, for k ≥ 2, with
`log basis x=2`, or for explicit tick lists. `minor tick num` does not apply
(manual tickoptions.tex). Labels: `$10^{\pgfmathprintnumber{d}}$` (manual
numberformatting.tex, `log number format basis`), `$b^{…}$` with
`log basis x=b`; explicit values print their exponent (`xtick={5}` →
10^{0.7}). `log ticks with fixed point` prints the value in fixed notation
(1, 10, 1,000; 0.01) — log-explicit-ticks. Grids on log axes use the same
major/minor positions (log-semilogy-grid). VERIFIED on E17 (minor counts in
all sweeps, same pass rate as Q3) and the fixtures.

**Q5 — Coordinates in a log axis.** `axis cs:` and bare coordinates take
data values; their logarithm goes through the map (log-explicit-ticks: a
`\draw` from (10,0.1) and a node at `axis cs:300,0.05`, Tier 2 exact). The
`origin` anchor of a log direction is internal 0 (data 1) **not** clamped
into the box (log-small-range: origin at (−97.48, −77.29), 97 pt outside;
its four projections lie on the box edges as in A7a). CONFIRMED on 2
fixtures.

**Q6 — Expression plots** on a log y direction sample x linearly over
`domain` (log-semilogy-grid, Tier 2 path exact). On a log x direction the
samples are also taken linearly in x and then mapped (implemented, not
separately measured).

**Q7 — Bars and `\closedcycle` on a log direction** start at internal 0
(data 1), **not** clamped into the limits: fixture log-bars-base (ybar and
an area on `semilogyaxis`, limits 10^0.5…10^2.9) puts the base 21.83 pt below
the box, where data 1 lies, clipped by the axis clip. This is `log origin=0`,
the default since compat 1.5 (manual preliminaries.tex; the reference entry
still says `infty`). On linear directions the base stays 0 clamped (U1/W1).
Stacked plots on log axes (sums of logarithms) are not handled. CONFIRMED on
the fixture (Tier 2 exact).

## M. Function plots (2026-11-27)

Experiment `e16-functions.mts` (sets `a` discovery, `b` fresh): one
expression plot per axis with explicit, exactly representable limits and
`clip=false`; the ideal points are computed with the editor's float pgfmath
(`compilePgfMathExpression`, mode `float`) and mapped through the axis box
*as painted* (Tier 2 box stroke), which cancels the PDF pt→bp scale (N3).
Raw data `artifacts/pgfplots-experiments/e16-functions/functions-{a,b}.tsv`.

**M1 — Float evaluation everywhere.** pgfplots evaluates plot expressions,
`domain` bounds, `samples at` entries, coordinates with math and numeric
options (`xmin=1e5`) with the fpu (manual axis-addplot.tex, "About the
precision and number range": "\addplot expression uses a floating point
unit"; `plot coordinates/math parser` initially true). No TeX dimension
limit applies: an axis with `domain=0:1e5` and `{x^2}` (y up to 1e10)
compiles. Implemented: `readPgfNumber`/`readPgfFloat` (model.ts) and
expression sampling (data.ts) evaluate in `mode: "float"`. CONFIRMED (a-big,
a-exp, b-huge: values to 4e6 match to ≤ 0.0011 pt).

**M2 — Sample positions.** `samples=N` (initially 25) equally spaced values
over `domain=a:b` (initially −5:5), both ends included: x_i = a + i(b−a)/(N−1);
`a > b` samples downwards (b-rev). `samples at={…}` is a `\foreach` list
(dots allowed) and overrides `domain`/`samples` (manual). The last point is
exactly b (no accumulated rounding: with `lua backend` the positions are
doubles). VERIFIED: vertex count and positions of all 44 cases (22 + 22
fresh), max point error **0.0035 pt** (set a), **0.0034 pt** (set b).

**M3 — Variables, trig format, functions.** `x` and `\x` are the same
sample (manual "Remarks"); `variable=t` (or `\t`) renames both. `trig
format plots=rad` switches trigonometry to radians for plot expressions
only (initially `default`: the enclosing `/pgf/trig format`). Functions from
`declare function` (axis option, `\pgfplotsset`, `\tikzset`, plot option)
and macros defined before the axis (`\def`, `\pgfmathsetmacro`) reach the
expressions. Parametric `({x expr},{y expr})` samples both with the same
variable. VERIFIED (a-sinrad, a-var, a-param, a-decl, a-pi; fresh b-rad,
b-param, b-decl, b-ellipse), same tolerance as M2.

**M4 — Unbounded samples.** A sample whose value is `nan` or ±`inf` in the
fpu (`1/0`, `ln` of a negative number) is handled by `unbounded coords`
(initially `discard`, manual 2dplots.tex): the point is dropped and the
line joins its neighbours; with `jump` the path is split there (a new
`moveto`). `restrict x/y to domain=min:max` maps values outside to ∓inf
and sets `unbounded coords=jump`; the starred variant clamps instead
(manual coordfiltering.tex). VERIFIED on subpath structure: a-recip (4
points, one path), a-recipjump (2+2), fresh b-recip (8), b-recipjump
(4+4), b-lnneg (6 of 11 kept). `restrict … to domain` is implemented from
the manual, not swept.

**M5 — Curve tolerance.** Measured float-vs-TeX difference on 44 varied
expressions: ≤ 0.0035 pt, the size of the LuaLaTeX/pdfLaTeX path noise
floor (0.00245 pt, harness README). The comparison's `curvePt` = 0.02 pt
therefore stands; no loosening.

---

## L. Legend (2026-11-27)

Experiment E17: `e17-legend.mts` prints a Tier 1/Tier 2 digest of the
discovery cases; `e17-cases.ts` holds the discovery set (29 cases) and a
fresh validation set `b` (18 cases, new values and combinations);
`check-cases.mts ./e17-cases.js` renders every case with the editor and
compares it with the cached LuaLaTeX result at the design tolerances
(`E17_SET=b` for the fresh set). Raw output
`artifacts/pgfplots-experiments/e17-legend*/`.

**Result.** Discovery set: 26 / 29 pass both tiers; fresh set: 16 / 18 pass
first time after the rules below were fixed on the discovery set. Max error
over the passing cases: layout (legend node anchors, bbox) **0.0077 pt**,
paths **0.0078 pt**, glyphs **0.0080 pt**. The five failures: `\Large` and
`\small` legend text (K4: LuaLaTeX uses LMRoman12/LMRoman9, the editor's
text engine scales lmroman10; 0.14–0.37 pt; **fixed with K4, 2026-11-27**:
discovery set 29/29, fresh set 16/18 with only the two below failing),
`rounded corners` on the legend
(a TikZ node-path start-point difference, not a legend rule), and
`nodes={text width=…}` multi-line entries (OPEN, below).

**L1 — The legend is a TikZ matrix node.** Documented initial style
(manual axisdescription.tex, "The default every axis legend style is"):
`cells={anchor=center}, inner xsep=3pt, inner ysep=2pt, nodes={inner
sep=2pt, text depth=0.15em}, anchor=north east, shape=rectangle,
fill=white, draw=black, at={(0.98,0.98)}`. `legend style={…}` appends to it.
`at` is in `axis description cs` (a plain pair is relative to the box);
`anchor` is the matrix node's anchor *including* its outer sep (0.5 ×
line width). The node's text box is the cell grid; its `base` anchor is the
last row's origin (Tier 2 text box of the matrix: origin = content left
edge on that baseline, height/depth = grid above/below). VERIFIED (all
cases; e.g. base: node NE at (195.996, 146.993) = 0.98 × box).

**L2 — `legend pos`.** `south west` = `at={(0.03,0.03)},anchor=south west`,
`south east` (0.97,0.03), `north west` (0.03,0.97), `north east`
(0.97,0.97), `outer north east` = `at={(1.03,1)},anchor=north west`.
Surprise: `legend pos=north east` is **not** the initial position
(0.98,0.98); the four inner positions sit 3 % in. The manual names the
values only. VERIFIED (pos-* discovery, b-title, b-dots, b-cycle10 fresh).

**L3 — Cell layout = PGF's matrix.** pgfmodulematrix.code.tex (LPPL): each
cell is a picture; per column, its width is max(extent left of the origin)
+ max(extent right of it) over the rows that have that cell; per row, the
height is max(0, extents above) and the depth max(0, extents below); the
origins are aligned per column and per row; `column sep` in effect in a
column's cell (matrix `column sep`, or `every odd/even column` styles —
the documented `/tikz/every even column/.append style={column sep=…}`)
separates it from the next column; `row sep` separates rows. Defaults: no
separation. Cell extents: a text node's border box without outer sep; a
stroked image path grows by half its line width; marks count by their
geometric extent; an empty image (`empty legend`) is a zero box at its
origin. `matrix.ts` lays out cells by their centres and only holds nodes,
so the legend uses a dedicated implementation of this algorithm
(`pgfplots/legend.ts`) and TikZ nodes for the texts and the box (open
question of design/pgfplots.md settled). VERIFIED (heights: rows of
`$x^2$`, `g`; wide; cols2; colsall; transpose; b-colsep, b-evencol,
b-cols3, b-revtrans fresh).

**L4 — Entries.** `\legend{…}` replaces all other entries (the last one
wins); otherwise `\addlegendentry` in order (position in the body does not
matter: b-addleg-order); `legend entries` only when the axis has no legend
command (b-legend-wins). `\legend` lists are `\foreach` lists (dots:
b-dots). `[opts]text` or `{[opts]text}` give per-entry node options
(b-entrykey, b-entryopts). Images come from every `\addplot` that is not
`forget plot` and from `\addlegendimage{opts}` (as `\addplot[opts]`, no
cycle list), in body order. Entry i pairs with image i; the legend has
min(#entries, #images) pairs (fewer, more); an empty entry drops its pair
and its image (emptyentry: `\legend{a,,c}` shows plots 1 and 3).
`reverse legend` reverses the pairs; `legend columns=n` fills rows of n
pairs (−1: one row); `transpose legend` (n > 1) turns the input rows into
columns (a,b,c,d at n=2 → rows [a c], [b d]). `legend plot pos=left`
(initial) puts image then text in each pair, `right` text then image,
`none` text only. VERIFIED (reverse, transpose, cols2, plotright,
plotnone; fresh b-revtrans, b-entrykey).

**L5 — Images.** Drawn with the plot's style followed by `every legend
image post` (`legend image post style`), inside the matrix: a line width
set on the legend (`legend style={thick}`) reaches the images (b-sep).
`line legend` (initial): one path (0,0)–(0.3cm,0)–(0.6cm,0) (three points,
as documented) and the plot's mark at the middle point only (`mark
repeat=2, mark phase=2`); `only marks` draws the mark alone. `area legend`:
`(0cm,-0.1cm) rectangle (0.6cm,0.1cm)` filled/stroked per the plot style
(PDF path ends with a moveto to the far corner). `empty legend`: nothing.
Marks keep the cycle list's mark fill and the plot's `mark options`
(`scale=` scales the mark geometry, b-markopts). Bar legends and `legend
image code/.code` are diagnosed (image omitted; other agents' plot types
plug into `LEGEND_IMAGE_BUILDERS`). VERIFIED (onlymarks, area, empty,
postmark, marksize; fresh b-image, b-post, b-fill, b-markopts).

**L6 — Text cells.** `\node[<cells>, <every odd/even column>, <nodes>,
<entry options>]{text}`, i.e. anchor from `cells` (`legend cell align`
= `cells={anchor=west|east|center}`), `inner sep=2pt`, `text depth=0.15em`
with the em of the legend's font, `font`/`text` of `legend style` reaching
the cells. `text depth` replaces only the depth: the entry text box is
(natural height, 1.5 pt) — the editor's node layout replaced *both* height
and depth when either was given (fixed in `semantic/nodes/layout.ts`;
TikZ sets `\dp` of the text box only). VERIFIED (left, right, b-rounded's
cells, entries; Tier 2 text boxes of legend-marks: depth 1.49994).

**L7 — Paint order and bounding box.** After the axis descriptions (title,
labels): legend fill, legend stroke, then per row and column the image
paths (line, then mark fill/stroke) and the entry text. The legend node
(border plus half its line width when drawn) counts for the axis' bounding
box and `outer` anchors (pos-one: `current axis.outer east` = legend east).
OBSERVED/VERIFIED (b-title paint order checked by the comparison;
legend-marks fixture).

**L8 — `legend to name`.** The legend is not drawn in the axis (manual);
`\ref{name}` elsewhere is not rendered by the editor. Diagnosed.

**OPEN — multi-line entries.** `legend style={nodes={text width=40pt}}`
(b-textwidth): TeX's legend is 5.6 pt lower than ours. The manual notes the
initial `text depth=0.15em` clips multi-line entries unless reset; how the
editor's `text width` nodes report height/depth with a depth override needs
its own experiment.

---

## P. Plot styling (2026-11-27)

Experiment E18: `e18-cases.ts` (discovery set `a`, 29 cases; fresh set `b`,
10 cases with new values and combinations), checked with
`check-cases.mts ./e18-cases.js` at the design tolerances. Discovery: 28 / 29
pass; fresh: 9 / 10 pass. Max error over passing cases: layout 0.0080 pt,
paths 0.0074 pt, glyphs 0.0039 pt. The two failures are both `exotic`
(below, P2).

**P1 — Plot handlers are PGF's** (pgflibraryplothandlers.code.tex, LPPL),
applied to the canvas points, restarted after each jump: `sharp plot`
(initial), `smooth`, `const plot` = `const plot mark left`, `const plot mark
right`, `const plot mark mid`, `jump mark left/right/mid`, `ycomb`, `xcomb`
(lines from the canvas image of y = 0, resp. x = 0, to each point; checked
with `ymin=-1`/`xmin=-1` so the base is not the box edge). Surprise:
**`smooth` in an axis uses tension 0.5** (PGF's initial
`\pgfsetplottension{0.5}`), not TikZ's 0.55: with 0.55 the control points
were 1.09 pt off (smooth), with 0.5 they match to 0.003 pt; an explicit
`tension=` is honoured. Marks stay at the data points. The legend image
(`\draw[<plot style>] plot coordinates {…}`) is drawn with the plot's
handler too (b-const: a `jump mark mid` legend line has a gap). VERIFIED
(smooth, smooth-t1, smooth-2pt, const*, jump*, ycomb, xcomb, sharp,
smooth-jump; fresh b-smooth, b-const, b-comb).

**P2 — Predefined cycle lists** are the definitions the manual prints
(markers-meta.tex "The definitions of all predefined cycle lists follow"):
`color`, `black white`, `exotic`, `mark list`, `mark list*` (not added),
`color list`, `linestyles`, `linestyles*`; `mark list fill` initially
`.!80!black`. VERIFIED by Tier 2 colours, dashes and marks: black white,
color list (12 entries), linestyles*, mark list (8 entries); fresh b-bw,
b-linestyles. `exotic` fails only on paint *space*: xcolor's `cyan` is CMYK,
so `cyan!60!black` is painted as DeviceCMYK (0.6,0,0,0.4); the editor stores
RGB (0, 0.6, 0.6) = xcolor's own conversion (r = 1 − min(1, c + k)), while
the comparison converts CMYK multiplicatively ((1−c)(1−k) = 0.24 for red).
A colour-model question, not a pgfplots rule; recorded, not changed.
`dashdotted`/`dash dot dot` were missing from the editor's TikZ dash
presets (`linestyles*` exposed it); added from tikz.code.tex
(on 3pt off 2pt on \pgflinewidth off 2pt …).

**P3 — `cycle list={…}`**: top-level comma list (`{red,blue}`: one key per
entry), braced entries (`{{red,mark=*},{blue,mark=square}}`), or entries
terminated by `\\`. `cycle list shift=n` takes entry i + n. The index i
counts every `\addplot` except `forget plot` ones (manual; L4).
`every axis plot no i` is applied before the cycle list entry and the
options. `no markers` given to the axis is appended to `every axis plot
post`, so it removes cycle-list marks (manual `no markers`). VERIFIED
(cl-simple, cl-braced, cl-backslash, cl-shift, plotno, nomarkers; fresh
b-custom, b-exotic's shift, b-plotno).

**P4 — Mark selection.** Points are counted along the plot's (filtered)
coordinate stream from 1; `mark phase=p` (initially 1) and `mark repeat=r`
draw marks at p, p + r, p + 2r, …; `mark indices={…}` (a `\foreach` list)
draws exactly those. Only selected marks inside the box are drawn and count
for the bounding box. `mark options={scale=s}` scales the mark geometry
(line width unchanged). VERIFIED (mark-repeat, mark-indices; fresh b-marks,
b-markopts in E17).

**P5 — Plot styles.** `fill`, `fill opacity`, `draw=none`, `line width`,
`thick`…, `every axis plot post` reach the plot path as TikZ keys; a filled
line plot is filled as an implicitly closed path. VERIFIED (fill, widths,
post; fresh b-styles).

**Note on tick steps at exact multiples of 35 pt.** With `height=140pt`
(L = 140 = 4 × 35) TeX chose 3 intervals where I1 gives 4: at an exact
transition the side is decided by N1 noise (I1 lists 245.0011 but
174.99993). The E18 cases use 150 pt. Not a rule; do not test at exact
multiples.

**Note on A7a.** The fixture function-trig-rad shows `right of origin`
0.054 pt off the box edge in the oracle (A7a gave ≤ 0.042 pt on the first 28
fixtures); listed as a known oracle deviation for that fixture rather than
widening `originProjectionPt`.

**Not done.** `cycle multi list`, `mark list*` (half marks), `mark=text`
(`mark list` entries 9–10), `every axis plot` interactions with `\addplot3`.

---

## R. Axis lines

Experiment E21 (`e21-axis-lines.mts`, 30 variants: `e21-base`, `e21-labels`),
fixtures `axis-lines-*` (7, all Tier 1 and Tier 2 exact at the design
tolerances). Manual: axisdescription.tex "Axis Lines".

**R1 — Keys.** `axis lines=v` = `axis x line=vx, axis y line=vy` with
left → (bottom, left), right → (top, right), middle/center → (middle,
middle), box, none. `axis x line=none` = `hide x axis`; `hide axis` hides
both. A hidden direction draws no line, no ticks, no tick labels and no axis
label (E21 c12/c13, axis-lines-hide: the picture is only the plot marks).
The unstarred keys also install `every non boxed x axis` (documented
initial value `xtick align=center, enlarge x limits=false, x axis line
style={-stealth}`) or `every boxed x axis` (empty), in place, so later
options override them; the starred keys do not (E21 c7/c8: starred lines
keep enlargement and inside ticks). CONFIRMED.

**R2 — Lines.** `bottom`/`left` lie on the lower limit, `top`/`right` on
the upper limit, `middle` on the other direction's 0, or its lower limit when
0 is outside the limits (manual; axis-lines-center-offset). Each line spans
the whole box side. Painted where the box is (C1: after the ticks): with
both directions boxed, the one closed box path (C2); with one direction
boxed and the other hidden, one path of the box with the hidden sides
skipped by moves, `M(x0,y0) L(x0,y1) M(x1,y1) L(x1,y0) M(x0,y0) Z` for
`hide x axis`; otherwise one path per line, x lines first (a boxed
direction gives two lines, lower then upper). Styles: `every outer x axis
line` for edge lines, `every inner x axis line` for `middle`; `axis line
style` appends to all four, `x axis line style` to both x ones.
`-stealth` is PGF's legacy `stealth` arrow (pgfcorearrows.code.tex): with
d = 0.28pt + 0.3 × line width, the line is shortened by 5d and the tip is
the filled, unclosed path (T), (T−8d, 4d), (T−5d, 0), (T−8d, −4d) — at 0.4 pt
exactly the measured (195.0,0) (191.8,1.6) (193.0,0) (191.8,−1.6). The
editor drew arrows.meta `Stealth` for it; fixed in the TikZ arrow code.
Arrow tips count for the bounding box with their extent. CONFIRMED (E21,
fixtures; Tier 2 exact).

**R3 — Ticks.** With a single line (lower/upper/middle), the ticks of that
direction are drawn once, on the line, centred by the non-boxed style
(±2.134 pt); with `inside` (starred) they point into the box (upward and
rightward for middle). Tick labels hang on the line with the D1 rule
(anchor north/east below/left for lower and middle lines, south/west for
upper ones, shifted by the centred half length). OBSERVED (E21 all
variants, fixtures).

**R4 — Obscured ticks.** `hide obscured x ticks` (initially true): the
ticks (marks and labels) of a `middle` line at the position where the other
line crosses it are removed — 0 on both axes for `axis lines=middle`, the
lower limits when 0 is outside, x = xmax for x middle with y right. Ticks of
edge lines are never removed (E21 c1, c7). `=false` keeps them.
OBSERVED (E21 c2, c3, c6, c7, c11, labels/c11).

**R5 — Labels.** Edge lines: `xlabel` near the tick labels on the line's
side — E1 below for bottom, mirrored above the top tick labels (anchor south
at their top edge) for top; `ylabel` E2 left, mirrored for right (rotate 90,
anchor north at the right edge of the tick labels). Unstarred middle:
`xlabel` at `right of origin`, anchor south east (at `left of origin`,
south west, when the y line is on the right — manual); `ylabel` at `above
origin`, anchor north west, **not rotated** (measured; the manual shows only
the x case). Starred middle: labels stay E1/E2 relative to the tick labels at
the line. The title stays at E3. The label of a box axis with `xtick
pos=upper` also moves above its tick labels (tick-none-lengths).
Harness: the middle styles redefine `every axis x label` with `.style`,
which dropped the probe's `name=` (now appended in `every axis post`).
OBSERVED (E21 labels, fixtures).

Not done: `separate axis lines=true` (diagnosed), `axis line shift`,
`every boxed`/`non boxed` for z, the y label for `middle` with an x line on
top.

## S. Axis scaling and direction

**S1 — `x dir=reverse`** (manual specifyrange.tex): the map runs from the
upper limit at the lower box edge (x canvas = x1 − W·(x − xmin)/(xmax − xmin));
limits, ticks, tick labels follow the map, descriptions stay where they
are. CONFIRMED (fixture dir-reverse, both directions reversed, with an
`axis cs` node; exact).

Done 2026-11-27: `axis equal`, `axis equal image`, `unit vector ratio(*)`,
`unit rescale keep size` (section AA). Not done: `scale mode` other than
its default, H4 (`enlargelimits={abs=<dimen>}`) exactness.

## T. Tick variants

Fixtures `tick-extra`, `tick-majorticks`, `tick-none-lengths`,
`tick-rotated`, `log-extra-ticks` (all exact).

**T1 — Major tick switches.** `xmajorticks=false` removes the major tick
lines **and their labels** (tick-majorticks: no x labels, the bounding box
shrinks to the box edge); `ticks=none` likewise for both directions, and an
xlabel then hangs on the box edge (y0 − s). `yminorticks=false` left the
minor ticks of `minor tick num=1` drawn in the same fixture — not
understood; the evaluator diagnoses `xminorticks=false` instead of guessing.
`tickwidth`/`subtickwidth` are `major/minor tick length`. CONFIRMED/OPEN.

**T2 — Extra ticks.** `extra x ticks` are major-length marks on the same
edges as the major ticks, labelled like major ticks (or by `extra x tick
labels` in list order), numbered from 0 in list order, and painted **after
all major tick labels**: extra x marks, extra x labels, extra y marks,
extra y labels (tick-extra Tier 2 order). On log axes the initial `every
extra x tick` style (`log identify minor tick positions=true`) labels
m·10^k as `$m\cdot 10^{k}$` (log-extra-ticks: 3·10^1, 3·10^2). A uniform
`xtickten` list (one decade apart) keeps the minor log ticks. Harness:
extra tick labels also carry the major tick label style, so the probe now
silences the major probe once `every extra x tick` is installed.
CONFIRMED (manual + fixtures).

**T3 — Tick label positions** follow `xtick pos` (labels on the upper
edge when the ticks are only there) and `xticklabel pos`; the xlabel follows
them (R5). OBSERVED (tick-none-lengths).

**T4 — Rotated tick labels.** The document's `xticklabel style` comes after
the default placement (`anchor=near ticklabel`), so its `anchor` wins
(tick-rotated: `rotate=90, anchor=east` puts the east anchor on the tick at
the box edge). A rotated label without an anchor hangs by the edge of the
canvas bounding box of its rotated node (outer sep included) facing the
axis, centred on the tick (`rotate=45` y labels: the box's right edge at the
tick, centre at the tick height; not the 315° border anchor, which is
0.51 pt off). The xlabel distance (E1) uses the bounding box of the rotated
label nodes. CONFIRMED on the fixture (exact).

**T5 — Tiny ranges far from 0** keep the default precision: limits
[1, 1.0003] give seven ticks 1, 1.00005, …, 1.0003 that TeX itself labels
"1" every time (fixture tick-tiny-range; J1 does not scale, e = 0, and
`std` precision 2 rounds). The editor matches; the repeated labels are
pgfplots' behaviour, not a bug. CONFIRMED (fixture, exact).

**T6 — Scaled tick variants** (2026-11-27). Experiment E23
(`e23-cases.ts`, discovery 16 cases, fresh set `b` 6 cases;
`e23-scaled.mts` prints `\tick`, labels and glyphs). Manual
tickoptions.tex `scaled ticks`.
- `scaled ticks=true` (initial) is J1; `false` none; `scaled x ticks`/`scaled
  y ticks` act on one direction (`scaled ticks` sets both).
- `scale ticks above exponent` / `below exponent`: scaled when e > above or
  e < below; the documented initial values are not stored as key values
  (`\pgfkeysvalueof` reads `\pgfkeys@relax`); measured they are **3 and −1**
  (J1's e ≥ 4 / e ≤ −2; `above=1` scales limits of magnitude 10^2, `above=2`
  does not; `below=0` scales 10^−1; `below=−3` leaves 10^−3 unscaled).
- `base 10:e`: labels print **t·10^e** and the scale label is
  `$\cdot 10^{-e}$` — the opposite sign of the manual's "divide every tick
  by 10^e" (base 10:3 on x ∈ [2·10^4, 6·10^4] prints 2·10^7 … with
  `·10^{−3}`; on y ∈ [5·10^−4, 2·10^−3] prints 0.5 … 2). Applied regardless
  of magnitude; `base 10:0` draws no scale label.
- `real:num`: labels t/num, scale label `$\cdot \pgfmathprintnumber{num}$`
  (3.1415 → `·3.14`).
- `manual:{label}{code}`: labels print the code's `\pgfmathresult` for
  `#1` = t; the label as given; an empty label draws no scale label. The
  editor reads the documented form `\pgfmathparse{<expression>}` only and
  reports other code as an unreadable value.
- `\tick` (and the harness' tick value) is the printed value in every mode
  (J4). `xtick scale label code/.code` is reported as unsupported.
- `xticklabels` and log axes disable scaling (manual).
VERIFIED: discovery 16 cases pass both tiers except (a) the A7a
`right of origin` noise (4 cases, 0.051 pt) and (b) `manual` around 65535
with a range of 2.4: TeX's own tick values come out as 65534.98, 65535.48
… (limits stored with N2 precision at range/|value| ≈ 4·10^−5), so its
labels read −2·10^−2, 0.48, …; not emulated. Fresh set: 4/6 clean; `b-real`
and `b-manual` differ only by TeX's tick-value noise (5.9999, 999.9998 →
the manual label −2·10^−4). Fixtures scaled-ticks-base10, -real, -manual,
-one-axis, -exponent pass both tiers (the two with |x| ≈ 10^4 carry the K5
`map` probe entry, like scaled-ticks).

Not done: `xticklabel={…}` custom code, `xticklabel shift`, `minor xtick`
with `xtick distance`, `xticklabels` with fewer entries than ticks beyond
I4, `yminorticks=false` (T1 OPEN), `axis line shift`, `separate axis lines`
(B4 of the 2026-11-27 task).

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

**Y4 — Lengths inside Beamer environments.** LuaLaTeX, beamer 3.72, 11pt,
`\typeout` of `\the\textwidth`/`\linewidth`/`\columnwidth` at the picture's
place (default theme 307.28987pt, Madrid 342.29536pt): a `column` of width w
sets all three to w (0.5\textwidth → 153.64493pt; `onlytextwidth` and
`totalwidth` do not change a column's own width); a `minipage` likewise;
`block`, `exampleblock`, `figure` and `center` change none; each `itemize` or
`enumerate` level narrows only `\linewidth` by 2em (21.9pt at 10.95pt: 285.38988,
then 263.48989 …); `description` by 2cm + .5em (279.91487pt in Madrid). A
picture set in a paragraph (inside a block, a column, a list) uses these
(`beamer/picture-lengths.ts`); before 2026-11-28 the editor passed an infinite
width there and the axis fell back to its default size. VERIFIED on
`test/fixtures/beamer/pgfplots/` (glyphs within 0.002pt).

**Y5 — Overlays in an axis body.** pgfplots postpones drawing to `\end{axis}`
(manual, miscellaneous: "pgfplots postpones drawing commands until
\end{axis}"). Observed in LuaLaTeX (`d13-overlay-matrix.tex`, `d12`, `d7`):
`\only<2>{\addplot …;}` and `\alt` remove the plot on other steps (no limits,
cycle list entry or legend entry: the next plot takes the first cycle style);
`\only<2>{\addlegendentry{…}}` likewise; `\uncover<2>{\addplot …;}`,
`\visible<2>{…}` and `\uncover<2>{\node …;}` in the body change **nothing**
(the plot is drawn on step 1 too); a `\pause` or `\onslide<2->` in the body
covers the **whole** axis, box and first plots included, until its step.
`\addplot<2-> …` is a TeX error ("the supplied plot command is unknown").

## U. Bars

Experiment E19 (`e19-bars.mts`, 28 cases, digest in data units) and the
fixtures bars-{ybar,xbar,stacked,options,interval,nodes-near} (all pass
Tier 1 and Tier 2 at the design tolerances; max Tier 2 path error
0.0048 pt, layout 0.02 pt except the documented origin anchors).

**U1 — Base line.** A bar runs from 0 to its value, the 0 clamped into the
axis limits: data 1…3 with automatic limits [0.8, 3.2] give bars from 0.8;
`ymin=0.5` from 0.5; negative values from 0 down; with `clip=false` and
`ymin=1.5` a value of 1 draws a bar from 1.5 down to 1 (only the base is
clamped). The limits are those of the data (0 is not added, no extra
enlargement). OBSERVED (E19 `ybar-axis`, `ybar-ymin-positive`,
`ybar-negative`, `ybar-clip-false`), CONFIRMED by the fixtures.

**U2 — Geometry and paint.** One path per plot, one closed subpath per
point: (c − w/2, b) → (c + w/2, b) → (c + w/2, v) → (c − w/2, v) → close
(xbar: (b, c − w/2) → (v, c − w/2) → (v, c + w/2) → (b, c + w/2)), filled
and stroked with the plot style in one painting operation, under the axis
clip. Marks (if any) at the data points, after the clip. OBSERVED (E19).

**U3 — Width and shift.** `bar width` initially 10pt; a number without
unit is in axis units (`bar width=0.3`: 0.3 data units). `bar shift=3pt`
moves the bar centre. CONFIRMED (manual 2dplots.tex `bar width`, `bar
shift`; E19, fixture bars-options).

**U4 — Automatic shifts.** With the axis style `ybar=<sep>` (initially
2pt), plot k (from 0) of the n bar plots of that type gets shift
−(n·w + (n−1)·sep)/2 + (k + 0.5)·w + k·sep — the manual's `bar shift auto`
formula. VERIFIED: proposed from the manual, checked on E19 (n = 2, 3; sep
2pt, 5pt) and on the fresh fixtures bars-ybar (n = 2) and bars-xbar (n = 3,
`xbar=4pt`, `bar width=6pt`): max error 0.003 pt.

**U5 — Axis styles.** `ybar`/`xbar` given to the axis: `bar cycle list`
(blue / red / brown!60!black / black lines with fill blue!30!white,
red!30!white, brown!30!white, gray, no marks: colours measured exactly),
`ybar legend`, and ticks **outside across the bars only** (ybar: x ticks
outside, y ticks inside). `ybar stacked` leaves all ticks inside.
`\addplot+[ybar]` without the axis style keeps the normal cycle list (marks,
no fill); `\addplot[ybar]` is a black outline. OBSERVED (E19, fixtures).

**U6 — Stacking.** `ybar stacked` (or `stack plots=y`): each plot adds to
the sum of the stacked plots before it, coordinate by coordinate; positive
and negative values have separate sums (x=3: +1 then −3 gives a bar from 0
to −3, not 1 to −2; compat 1.13+). Bars start at the previous level (the
first at 0, clamped). Stacked plots are painted **last plot first**. Limits
use the stacked values. OBSERVED (E19 `stacked`, `stacked-negative`,
`xbar-stacked`), fixture bars-stacked.

**U7 — Intervals.** PGF's handler (pgflibraryplothandlers.code.tex): bar i
spans from x_i + shift·Δ − w·Δ/2 with width w·Δ (Δ = x_{i+1} − x_i, `bar
interval width` 1, `bar interval shift` 0.5); the last point only closes
the last interval; the plot key `ybar interval` takes no value. The axis
style `ybar interval=r` gives plot k of n the slot centred at
(k + 0.5)/n of the interval, width r·Δ/n, and sets `xtick=data` and major x
grid lines. OBSERVED (E19 `ybar-interval*`), fixture bars-interval. The
axis style's interval tick labels (`xticklabel interval boundaries`-like
behaviour: 3 labels for 4 ticks) are **not** reproduced.

## W. Area, closed paths and trailing paths

Experiment E20 (`e20-area-errors.mts`), fixtures area-closedcycle and
area-trailing (pass both tiers; max path error 0.0095 pt).

**W1 — `\closedcycle`** continues the plot path to (x_last, b), (x_first,
b), close, with b = 0 clamped into the y limits (as U1): to ymin when the
data are above 0, to 0 inside, to ymax when all data are negative. Fill and
stroke in one operation, under the clip. OBSERVED (E20 `closed-*`).

**W2 — Stacked areas.** With `stack plots=y`, `\closedcycle` of a later
plot runs back along the stacked points of the plot below it (reversed),
then closes; stacked plots are painted last first (as U6). OBSERVED (E20
`closed-stacked`), fixture area-closedcycle.

**W3 — `area style`** = the area cycle list (first entry measured equal to
`bar cycle list`'s), `area legend`, `axis on top` (clip and content painted
before the axis). OBSERVED (E20 `closed-area-style`, one case).

**W4 — Trailing path operations.** `-- (axis cs:x,y) -- … -- cycle` after
the input continue the plot's path in axis coordinates. OBSERVED (E20
`trailing-cycle`). **W5 — `fill opacity`** applies to the fill only
(alpha 0.3 on the fill, stroke opaque). OBSERVED.

**W6 — `node[pos=p]` / `coordinate[pos=p] (name)`** after the input sit on
the plot polyline at the fraction p of its **arc length measured in data
units** (not canvas length, not index, not x): on (1,1)–(2,3)–(4,1), p =
0.25, 0.5, 0.75 land at segment parameters 0.566, 0.105 (second segment),
0.552, matching data-unit arc length to 1e-3 and not canvas arc length
(0.563, 0.100, 0.550). OBSERVED (E20 `node-pos`, one polyline with equal
x and y data scaling — pgfplots' internal data scaling may differ for data
of very different magnitudes; not tested). The node text takes the plot
colour; `name path` is recorded only by the other agents' work (not here).

## X. Symbolic coordinates, error bars, nodes near coords

**X1 — Symbolic coordinates.** `symbolic x coords={a,b,c}` maps the names
to 0, 1, 2 (`symbolic-partial`: {a,b,c,d} with b, d gives the x range
[1, 3], enlarged as usual); a name not in the list stops TeX. Tick labels
are the names, in text; an automatic tick between positions shows the name
at the nearest position rounding .5 up (ticks 1, 1.5, 2, 2.5, 3 read b, c,
c, d, d). The harness' numeric map probe is switched off on symbolic axes.
OBSERVED (E20 `symbolic*`), fixtures symbolic-coords, symbolic-partial.

**X2 — Error bars.** Per point, x before y, plus before minus: a stroked
bar from the point to the end (plot colour and width, then `error bar
style`), then the error mark at the end. The mark (initially `-`, which PGF
draws from (s,0) to (−s,0)) is rotated by the bar's direction plus its
`rotate` (initially 90), so it lies across the bar; `error mark options`
other than rotate style it (colour, `mark size`). Explicit values come from
`+- (ex,ey)`, `+= `, `-= ` or the table's `y error`/`y error plus`/…
columns; `explicit relative` and `fixed relative` multiply by |value|.
Error bars are under the clip, after the plot's line and before its
marks; their ends extend the automatic limits (`y fixed=2` on y 2…3 gives
[−0.5, 5.5]). pgfplots puts each mark in an empty, rotated zero-width TeX
box (Tier 2 text boxes the editor does not have; listed in the comparison
spec). OBSERVED (E20 `err-*`), fixtures errorbars-explicit,
errorbars-style (paths and marks match).

**X3 — `nodes near coords`.** A node per point anchored `south` at the
point (bars: at the bar's end, with the bar's shift; `west` for xbar;
`north`/`east` for negative values), inner sep 0.3333em, text
`$\pgfmathprintnumber{y}$` (x for xbar; the meta text with `point meta=
explicit symbolic`), in the plot colour, `every node near coord` applied;
painted after the plot. OBSERVED (E19 `nodes-near*`), fixture
bars-nodes-near (glyphs 0.005 pt).

---

## AA. Axis equal and unit vector ratios (2026-11-27)

Experiment E22: `e22-cases.ts` (random two-point data rectangles under nine
ratio settings × fourteen extras: `enlargelimits=false|0.3`, `enlarge x
limits=false`, explicit limits on one or both sides, `scale only axis`,
`width`/`height`, `scale=0.8`, every 17th case loglog; seed 0 = discovery,
160 cases; `E22_SEED=1` = fresh validation, 140 cases), checked with
`check-cases.mts ./e22-cases.ts`; `e22-axis-equal.mts` prints limits and
boxes; `e22-ticks.mts`, `e22-short.mts` probe AA2. Sources: manual
scaling.tex (`axis equal`, `axis equal image`, `unit vector ratio`, `unit
rescale keep size`, `scale mode`).

**AA1 — Rule.** `axis equal` = `unit vector ratio=1 1 1, unit rescale keep
size=true`; `axis equal image` = the same with `false`; `unit vector
ratio*` implies `false`; the initial `unit rescale keep size` is `unless
limits declared` (manual). With limits L after H1/H2 and the A2 box W×H
(before `scale`), r = rx/ry:
```
s  = min(W / (r Δx), H / Δy)        e_x = r s,  e_y = s
```
The direction that already fits keeps its limits and box length. The
other needs range length/e: if it may change its limits (`true`: always;
`unless limits declared`: unless both its limits are given; `false`:
never), its range grows to length/e — about the centre, or away from the
one given limit (`xmin=` given: only xmax moves) — and the box keeps W×H;
otherwise its box shrinks to Δ·e. `scale` multiplies the result (A4);
`scale only axis` changes only W, H (A2). Log directions use the internal
coordinate (ln). Found on the way: a degenerate (single-value) range on a
log direction widens to [v − 1, v + 1] internally (a factor e each way),
not ±20 % (H2 is for linear directions). VERIFIED: discovery 154
non-empty cases (124 clean), fresh 135 (113 clean): every limit and box
within the comparison's tolerances except the cases explained below; worst passing layout error
0.047 pt on fixtures (tier-1 tolerance), paths ≤ 0.008 pt.

Residuals (not this rule): the `right of origin` projection noise of A7a
(0.050–0.056 pt, 8 + 6 cases); marks on a limit with `enlargelimits=false`
extend the editor's bounding box by the mark (1.8 pt) where TeX's does not
— the same without any ratio (E22 edge case `e62`), a separate OPEN item;
`xmin=-1`/`ymin=0` on log axes (ignored with a diagnostic by the editor,
TeX does something else; 4 + 1 cases); two loglog cases with tick
marks 0.021–0.022 pt off (log noise, Q); axes whose every point lies outside
given limits (TeX treats them as empty axes, H3/Surprise 10; excluded, 6 +
5 cases).

**AA2 — Ticks of a ratio-shortened direction.** When AA1 shortens a
direction's box below a fifth of its A2 length (threshold between 0.193
and 0.215 on the discovery sweep), TeX keeps automatic ticks that a
normal axis with the same limits and length drops (E22c `e22-short`: the
same limits and box without a ratio give the ordinary list): ticks up to
half a step beyond the upper limit (included at ≤ 0.495 step, dropped at
≥ 0.585 step), and, when the lower limit was enlarged (`enlargelimits`
on that side, limit not given), every tick from the list start
trunc(listBase/step) − 1, below the lower limit; with
`enlargelimits=false` the lower side is filtered as usual. Their marks and
labels are drawn outside the box and extend the bounding box. OBSERVED:
discovery 56/57 shortened cases match (42 clean, 14 with harness or A7a
noise only; before the rule 24 failed), fresh sweep 45/46. Misses:
discovery `s0-155` (`ratio*` with all four limits given, a 1.8 pt taller
TeX bounding box, not analysed) and fresh `s1-35`: x [2.965, 5.305] on 20 pt of 135) drops the
tick 1.965 steps below the lower limit that the rule keeps — the lower
reach is not exactly "from the list start" (included up to 1.91 steps
below elsewhere). **OPEN** for that bound and for why the threshold is a
fifth. Overlapping labels of these ticks confuse the harness' glyph-to-label
assignment (`tick-label-text`, `textbox-text`; positions and glyphs match).

Fixtures: axis-equal, axis-equal-image, axis-equal-declared (keep size
true overrides all four declared limits), axis-equal-log,
unit-vector-ratio-limits (one declared limit), unit-vector-ratio-star
(`enlargelimits=0.3`, `scale=0.8`), axis-equal-image-short (AA2): both
tiers pass at design tolerances (tier 1 ≤ 0.047 pt, paths ≤ 0.008 pt,
glyphs ≤ 0.003 pt); axis-equal-image-short has KNOWN harness
label-text entries only.

Editing: the ratio's unit vectors are not reported as authored `x=`/`y=`,
so resize writes `width`/`height` as for any axis. With keep size (`axis
equal`, the default `unless limits declared`) the box follows the drag
exactly; under `axis equal image`/`ratio*` the shortened direction's box
stays Δ·e, so a drag of that edge changes the target but not the edge
(the other direction follows).

## Z. Real-document findings (2026-11-27)

Source: the real-document differential `scripts/pgfplots-oracle/corpus-compare.mts`
(design 5.7): every snippet of the untracked arXiv corpus
(`artifacts/pgfplots-corpus/axes`, 425 snippets, 46 papers) whose axes the
editor evaluates without unsupported-feature diagnostics is compiled with
LuaLaTeX as written (own preamble and compat; nothing injected; TEXINPUTS
extended after the TeX tree with the paper's directories) and compared with
the editor primitive by primitive (Tier 2, `mutool trace`), aligned by the axis
clip rectangle. Every rule below was then reproduced on a hand-written fixture
with our own data and an oracle (`test/fixtures/pgfplots/<name>`), and the
experiments named are throwaway standalone documents measured with
`mutool trace`. Corpus counts are in the final report of that run, not here.

**Z1 — A picture transformation acts on the axis as a canvas transformation.**
`\begin{tikzpicture}[scale=0.7]` (or `xscale`, `yscale`, `rotate`, with or
without `transform shape`) around an axis: pgfplots computes the whole axis
(box from `width`/`height`, labels, legend, ticks) in an untransformed frame at
the picture origin and paints it under a PDF `cm` with the linear part of the
TikZ transformation, so text, line widths, marks and dash lengths scale too
(experiment: `scale=0.9` gives every path and glyph under `cm .9 0 0 .9`; the
page is exactly 0.9 of the unscaled one). Manual scaling.tex: "supply
`/tikz/scale` to an axis. This will scale the complete resulting image,
including all text labels." The editor scaled only positions (box 0.9, text
and line widths 1.0). Found in 8 papers (≈35 snippets). Fixtures
picture-scale, picture-xscale-rotate (Tier 2 exact; Tier 1 node probes are
read in the untransformed frame and are not comparable, a harness limit).
CONFIRMED.
- **`every picture` transformations are applied twice.** With
  `\tikzset{every picture/.style={scale=0.9}}` the axis box is 0.81 of the
  unscaled one: once as the canvas `cm` (above) and once more inside the
  axis as a coordinate transformation (box and tick lengths 0.9, text not;
  the trace differs from `/pgfplots/scale=0.9` in the tick lengths). Not
  emulated; diagnosed (`unsupported-pgfplots-every-picture-transform`).
  1 paper, 40 snippets. OBSERVED (experiment `everypic`).

**Z2 — `font=\color{c}`** in a description style (matlab2tikz writes
`xlabel style={font=\color{white!15!black}}`) colours the text: the font code
runs inside the node's text box. The editor ignored it (glyphs black instead
of gray 0.15). Fixture label-font-color. 2 papers.

**Z3 — With `clip=false` marks outside the box are drawn** (and count for the
bounding box); C8's "only points inside the box" holds for `clip=true` only.
Fixture clip-false-marks. Found while checking Z1 on our own data.

**Z4 — `dotted` uses the option list's final line width.** `dotted` is `dash
pattern=on \pgflinewidth off 2pt`; TikZ adds the dash with `\tikz@addoption`,
executed after the line width keys of the same list, so `[dotted, very thick]`
gives on 1.2pt (a scope's `dotted` keeps the scope's width). `dash dot` and
its relatives use `\the\pgflinewidth`, expanded when read: `[dash dot, thick]`
keeps 0.4pt (tikz.code.tex lines 1584–1598; fixture plot-dotted-thick).

**Z5 — Pre-1.11 tick and grid clips.** Below compat 1.11 pgfplots wraps the
grid and tick paths in clip paths 5cm beyond the box along the line
direction; they cut nothing visible (the half width of an edge line, under the
axis box stroke). The differential drops clips that cut no geometry, on both
sides. OBSERVED (compat 1.3/1.10 vs 1.11/1.18 experiment).

**Z6 — `.cd` in styles.** `x tick label style={/pgf/number format/.cd,
precision=3, /tikz/.cd}` (tikzplotlib) sets the tick label precision: relative
keys after a `.cd` live in that directory. The editor dropped them (labels
1 instead of 1.002). Fixture tick-number-format-cd. 1 paper, 9 snippets.

**Z7 — Exact ties of the tick step.** At a range that hits a threshold exactly
(0.6 over 4 intervals: m = 1.5 up to float noise) pgfplots takes the larger
step (I1: transitions sit ~6e-6 relatively early). The editor's float noise
took the smaller; the comparison now carries a 5e-6 relative margin. Fixture
tick-number-format-cd (y axis).

**Z8 — `\addlegendentry{}` keeps its image.** An empty (or blank)
`\addlegendentry` makes a cell with an empty text box (height 0, depth = the
text depth), unlike an empty `\legend` item, which drops its pair (L4).
Papers use it to put two images in one row (`legend columns=2`). Empty node
text has height 0 also when `text depth` is set. Fixture legend-empty-entry.
1 paper.

**Z9 — compat below 1.11** (policy of design 4.5, measured): each old-compat
snippet compiled again at compat=1.18 and compared TeX to TeX. No compat
(pre-1.3 semantics): axis labels at a fixed offset from the axis, 1.4–3.1pt
from their 1.18 places (15 of 20 snippets; all of 3 of the 5 papers without compat); compat 1.3–1.10: no
visible difference in 22 of 23 snippets (the remaining one a paint-order
ambiguity). Manual preliminaries.tex: `compat/labels` (1.3),
`compat/pgfpoint substitution` (bare coordinates are `axis cs` from 1.11).
The diagnostic says so.

**Z10 — Silent drops made loud.** `postaction`/`preaction` without a
decoration (`postaction={pattern=north east lines}` on bars) were ignored
without a word; they now report `unsupported-option-key:postaction`.

**Z11 — Expression plots on a logarithmic x direction are sampled
logarithmically** (manual axis-addplot.tex: "If the x-axis is logarithmic,
samples will be drawn logarithmically"): `samples` points equally spaced in
ln x over `domain`, ends exact (experiment: `semilogxaxis`, domain 0.1:10,
5 samples → 0.1, 0.316, 1, 3.16, 10, equally spaced on the canvas). Q6's
"linear in x, then mapped" was wrong (implemented, never measured). Found by
the generator fuzz (19 of 20 `semilogxaxis` cases failed). Fixture
log-x-expression-samples. CONFIRMED.

**Z12 — Axis lines on reversed directions.** `axis x line=bottom` (and `left`,
`top`, `right`) name box edges: with `y dir=reverse` the bottom line lies at
y's *upper* limit (the lower box edge). Each line is drawn in the direction of
increasing data, so its arrow tip (`-stealth` of the non-boxed style) is at
the upper limit: on a reversed y the y line points down. Found by the
generator fuzz (`axis lines*=left, y dir=reverse`); fixture
axis-lines-reverse (two axes, x and y reversed). OBSERVED.

**Z13 — Minor ticks above the last major tick** appear only when the upper
limit is at least half a major step beyond it (the same rule as Q4 for log
decades): y limits [2.79, 8.91] with majors 4, 6, 8 and `minor tick num=4` give
no minor ticks above 8, while I2's [0.3, 4.6] with step 1 has minors up to
4.5. Below the first major tick the minor ticks always continue to the limit.
Found by the generator fuzz (7 of 300 cases); fixture minor-ticks-upper.
OBSERVED (fuzz cases f1-34, f1-103, f1-162 and the fixture).

**Z14 — Bar legend images, measured.** `xbar legend` draws a 0.8em bar at
y = −0.2em and a 0.6em bar at y = 2·3pt − 0.2em (both 3pt thick, from x = 0):
the `ybar legend` coordinates with x and y exchanged. The manual's printed
initial value of `xbar legend` repeats the ybar coordinates, which drew two
zero-length bars. `ybar stacked` and `xbar stacked` use the `single ybar
legend`/`single xbar legend` images (one 6pt bar). Found by the generator
fuzz (6 of 300 cases with a 1.5–3pt legend offset); fixture
legend-bar-images. OBSERVED.

**Z15 — `only marks` without a mark draws `*`.** When `only marks` is on and
the final mark is none (no `mark` key in `\addplot[…]`, an explicit
`mark=none`, or the axis' `no markers` in `every axis plot post`, which even
beats `+[…, mark=square*]`), pgfplots draws filled circles (`*`, mark size
2pt) in the plot colour; the legend image shows the same mark. G2's "no marks
unless `mark=` is given" does not hold under `only marks`. Found by the
generator fuzz (5 of 300 cases); fixture only-marks-default. OBSERVED.

**Z16 — A sample on an explicit limit counts.** H1's "points inside the
other direction's given limits" includes points that land on a limit up to
float noise: `xmin=-1.2` with `domain=-3.8:1.4` (sample 12 is −1.2 in TeX,
−1.2000000000000002 in doubles) puts y = 1.44 into the y range (TeX ymax
1.583; the editor had 1.539, 4pt off at the top). The editor now compares with
a tolerance of 1e-9 of the limits' scale. Shrunk from a generator-fuzz case;
fixture limits-boundary-sample. OBSERVED.

**Generator fuzz, summary (2026-11-27).** `scripts/pgfplots-oracle/fuzz.mts`,
300 random axes per seed from the supported feature set, Tier 1 + Tier 2 at
the oracle spec's tolerances. Seed 1 (discovery) found Z11–Z15; after them,
the visible failures left on seed 1 and on a fresh seed 2 are: overlapping
tick labels of `xtick distance=0.5` (the harness gives each label box its
neighbours' glyphs; painting matches), log fractional-step drift (Q3b, OPEN),
`exotic`'s CMYK colours (P2), and `\ticknum` numbering differences (D4) that
paint nothing. Near-tolerance failures (no missing or extra item, all
positions within 0.5pt; median 0.06pt) are the A7a origin-projection noise and
N2 limit noise of TeX's fixed-point arithmetic (log axes, large magnitudes).

---

## AB. Settings inside the axis body (2026-11-28)

Experiment E24: `e24-cases.ts` holds the discovery set `a` (41 cases), the
exploration sets `c` (TikZ keys, scopes; 22 cases), `d` (`mark` and survey
keys inside a group; 6) and `e` (text colour and font; 8), and a fresh
validation set `b` (19 cases, new values and combinations).
`e24-body-settings.mts` prints a digest per case (paths in data units,
paints, glyphs; `E24_SET=a|b|c|d|e`), `e24-glyph-colours.mts` the colour of
every glyph run; `check-cases.mts ./e24-cases.js` renders each case with the
editor and compares it with the cached LuaLaTeX result at the design
tolerances. Raw output `artifacts/pgfplots-experiments/e24-body-settings*/`.

**Result.** After the rules below: set a 37/41, c 17/21, d 6/6, e 8/8 pass
both tiers; fresh set b **18/19** first time, max error layout **0.0054 pt**,
paths **0.0039 pt**, glyphs **0.0052 pt**. Failing everywhere: the cases
with an `\addplot` inside `\begin{scope}…\end{scope}` (the parser reads such
an `\addplot` as an unknown statement and diagnoses it; not drawn), and two
TikZ-style cases (below). Fixtures body-settings-plot-keys,
body-settings-axis-keys, body-settings-groups; unit tests
`test/pgfplots-body-settings.spec.ts`.

pgfplots reads the body in order, but draws the plots, the axis and embedded
TikZ when the axis ends. So the question for each key is *when* it is read:

**AB1 — Keys read at the `\addplot`.** A value set between plots (by
`\pgfplotsset`, `\pgfkeys{/pgfplots/…}` or `\tikzset{/pgfplots/…}`) reaches
the later plots only: `domain` (p-domain: first plot over 0:1, second over
2:3), `samples`, `samples at`, `variable`, `each nth point`, `unbounded
coords`, `forget plot` (p-forget: the two plots after it share the second
cycle entry), `cycle list` and `cycle list name` (p-cycle-list: the cycle
index keeps counting, the new list is indexed with it), `every axis plot no
N` (set after plot N it does not reach it). Macros in an expression, in the
data, or in one of these keys given to the plot (`domain=0:\a`) are read
there too (V0; p-def-domain, p-def-expr). `\tikzset{domain=…}` is TikZ's
domain and changes nothing (p-tikzset-domain). Implemented for the keys
listed in `SURVEY_PLOT_KEYS` (model.ts), which adds the documented data and
coordinate filter keys and `trig format plots` by analogy (not measured).
VERIFIED (b-domain-samples, b-pgfkeys-samples, b-cycle-mid, b-nth-forget,
b-every-no, b-def-mixed).

**AB2 — Keys read when the axis ends.** Drawing keys use the state at
`\end{axis}`, so a value set after a plot still reaches it: `every axis plot`
and `every axis plot post` (p-every-plot, p-after-all), `no marks`, `mark
options`, `mark size`, `only marks`, `smooth` (c-smooth: both plots curved),
`legend …`; style definitions (`mystyle/.style`, by `\pgfplotsset` or
`\tikzset`: the last definition wins for every plot, p-tikz-style,
p-pgfplots-style); macros in the plot's other option values (p-def-color:
`color=\mycol` is the final value for both plots). **`mark` is mixed**: a
body-level `mark=` (`\pgfplotsset` or `\tikzset`) gives marks only to the
plots read after it (c-tikzset-mark, b-tikzset-mark), and their shape is the
one in effect at the end; a `mark` set inside a group gives no marks at all
(d-group-tikzset-mark, d-group-pgfplotsset-mark). Implemented as: the plot
has marks iff it has them with the settings before it, and draws the final
state's mark. VERIFIED (b-every-plot-thin, b-smooth-marksize,
b-tikzset-mark, b-group-tikzset, b-group-mark, fixture
body-settings-groups).

**AB3 — TikZ keys in the body.** A plain TikZ key set by `\pgfplotsset` or
`\tikzset` at body level (`green`, `line width=2pt`, `dashed`, `draw=…`,
`fill=…`) reaches neither the plots nor the axis lines, ticks or box (c-red,
c-thick, c-dashed, c-tikzset-thick, e-draw-green); the editor ignores it and
warns (`pgfplots-body-tikz-key`). Exception: a colour (`green`, `color=…`,
`text=…`) or a `font=…` set there becomes the colour/font of **all text the
axis typesets** — tick labels, title, axis labels, legend text, embedded
`\node`s — wherever in the body it is set (e-green-all, e-before-plot,
e-font, e-color-key; inside a group: nothing, e-group-green). VERIFIED
(b-text-violet, b-font-teal, b-tikz-noeffect). Not handled: `\tikzset{every
path/.append style=…}` in the body thickens the plots and the axis box in TeX
(p-thick) and `\tikzset{every mark/.append style=…}` scales the marks
(p-every-mark); the editor's pgfplots paths do not read the TikZ `every
path`/`every mark` styles of the frame at all (wherever they are set).

**AB4 — Groups.** A brace group `{…}` in the body (the parser reads the body
flat; the group is the stray braces between items) keeps everything set in
it: plot keys of AB1 reach only the plots inside the group (g-domain,
g-cycle, d-group-forget, d-group-each-nth); drawing and axis keys set in it
are gone when the axis ends, so they reach nothing, not even the plots of the
group (g-every-plot, g-title, b-label-group); macros defined in it are local
(g-def). `\begin{scope}…\end{scope}` behaves the same for settings
(s-domain, b-scope-def), and its options reach the plots inside it as if
appended to their options (c-scope-lw, c-scope-green, c-scope-mark,
c-scope-domain); the editor does not draw an `\addplot` inside a scope
(diagnosed, unchanged).

**AB5 — Axis keys in the body.** Axis keys set anywhere in the body (top
level) hold for the axis: `title`, `xlabel`, `grid`, `legend pos`, `legend
style`, `legend entries`, `width`, `axis lines`, `xtick`, `enlargelimits`,
`clip`, `hide axis`, `every tick/.append style`, `axis line style`, and even
`every axis/.append style={…}` (a-*, c-legend-style, c-xtick,
b-legend-entries-late). The limits are the exception: `xmin`, `xmax`,
`ymin`, `ymax` in the body (before or after the plots, in a group or a scope)
stop TeX with "Sorry, you can't change `xmin' in this context" (a-xmin,
a-ymax, a-before, g-xmin, s-xmin, b-ymin, b-xmax). The editor reports an
error diagnostic (`pgfplots-limit-in-axis-body`) and ignores the value.
`zmin`/`zmax` are treated the same by analogy. VERIFIED (b-title-late,
b-grid-minor, b-legend-entries-late; fixture body-settings-axis-keys).
