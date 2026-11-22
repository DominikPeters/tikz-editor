# TikZ/PGF semantic engine survey (packages/core/src/semantic, options, foreach, coords, transform)

Read-only survey. Paths are relative to `packages/core/src/`. PGF references are under `/usr/share/texlive/texmf-dist/tex/generic/pgf/`. Claims marked (unverified) were read from source but not run.

## 1. Map

| Area | Files (lines) | Role |
|---|---|---|
| Statement driver | `semantic/evaluate.ts` (3.8k) | Statement loop, scopes, pics, `\tikzset`, `\pgfmathsetmacro`; also `resolveFrameMeta` (3166-3622), tree-level style keys, and the bounds code (`computeBounds` and the cubic/arc extrema helpers, 2539-2960) |
| Options to style | `semantic/style/resolve.ts`, `apply-kv.ts` (1.4k, 76 handler registrations), `apply-flag.ts`, `custom-styles.ts`, `constants.ts` | `.style`/`.append style`/`.prefix style` registry; `ResolvedStyle` and `transform` built entry by entry |
| Paths | `semantic/path/evaluate.ts` (3.0k; one 2,485-line function `evaluatePathInFrame`, 256-2741), `graph.ts` (3.8k, `GraphPlanner` class), `label-quotes.ts`, `shape-options.ts`, `segments.ts`, `arc.ts`, `plot*.ts`, `to-operation.ts` | Per-item handler map (`PlotOperation`, `Node`, `PathOption`, ...) over a mutable `PathBuilderState` with 35 fields, mostly `pending*` |
| Nodes | `nodes/evaluate.ts` (1.7k), `layout.ts`, `shape-geometry.ts` (3.0k), `anchors.ts` (2.0k), `shape-emission.ts` (0.8k), `matrix.ts` (1.9k), `multipart*.ts`, `named-coordinates.ts` | Shape options to geometry; anchors; SVG elements |
| Coordinates | `coords/evaluate.ts` (1.1k), `semantic/transform.ts` (67 lines) | Coordinate systems, calc, intersections; plain affine matrix helpers |
| Decorations | `decorations/engine.ts` (1.6k) | Path decoration |
| Other | `foreach/expand.ts` (1.6k), `options/parse.ts` (324) | Textual `\foreach` expansion; option-list parser |

Data flow: the parser produces an AST, with option lists held as `OptionEntry` records (`kv`, `flag` or `unknown`, each carrying a `raw` string). `evaluate.ts` calls `resolveContextDelta` to fold options into a `ResolvedStyle` and a CTM per frame. Path, node and graph code then re-scan the raw option entries for the keys the style layer does not own, and emit scene elements that go to SVG.

Churn: the repo has 98 commits in total and most of the engine files have 1-4, so git history was squashed or imported and carries almost no churn signal. The evidence below is from code structure and from comparison with PGF.

## 2. Ranked hotspots

### H1. No pgfkeys model: the style resolver ignores about 300 keys that other modules re-read from raw entries

- **Where:** `semantic/style/constants.ts:50-~380` (`NON_STYLE_OPTION_KEYS`, plus `NON_STYLE_OPTION_FLAGS` from 287); `apply-kv.ts:73-131`; `apply-flag.ts`; `evaluate.ts:3166-3622`; `nodes/options.ts`; `path/shape-options.ts`; `path/node-positioning.ts`; `path/path-attached.ts`.
- **What:** `applyKvEntry` does a map lookup (`EXACT_KV_HANDLERS`, 76 registrations), then regex and prefix fallbacks, then the whitelist, then `unsupported-option-key:<key>`. A key that a later phase consumes has to be added to the whitelist so it does not warn, and that later phase then walks `options.entries` itself. About 190 `key === "..."` comparisons sit outside the handler map: 91 in `graph.ts`, 61 in `shape-geometry.ts`, 48 in `nodes/options.ts`, 46 in `apply-flag.ts`, 42 in `evaluate.ts`. About 80 sites iterate `.entries`.
- **Quoted:**
  - `apply-kv.ts:114` `if (/^level\s+\d+\s*\/\.(style|append style)$/.test(key)) { return { style, transform, diagnostics: [] }; }`
  - `evaluate.ts:3166+` `resolveFrameMeta` is a 457-line function with 26 hand-copied `let x = base.x` locals, one per key it owns.
  - `nodes/options.ts:19-45` repeats the preset list `midway, near start, very near start, at start, at end, ...` inline.
- **PGF:** `utilities/pgfkeys.code.tex` plus `tikz.code.tex` define every option as a key in `/tikz/` (`.style`, `.code`, `.default`, `.store in`, `/.cd`). Calling the key runs its handler wherever it appears. There is no second pass that rescans the list.
- **Missing pgfkeys features:** a grep of `semantic`, `options` and `foreach` finds no `.code`, `.default`, `.initial` or `.get` handlers. The key-path prefix `/tikz/` is stripped in four places: `evaluate.ts:2504`, `custom-styles.ts:293`, `pics/registry.ts:276`, and an explicit `["xslant", "/tikz/xslant"]` pair of keys in `apply-kv.ts:243, 860-899`.
- **Concrete drift: the `pos` presets in three tables.**
  - `style/constants.ts:373-378` (the names).
  - `path/path-attached.ts:19-31` (names with `t` values).
  - `nodes/options.ts:30-36` (names again).
  - A fourth copy is in `edit/actions/path-attached-node-actions.ts:60`.
  - PGF defines them once as styles: `midway/.style={pos=.5}`, `near end`, and so on, in `tikz.code.tex`.
- **Concrete drift: built-in styles written as TS code.** PGF defines `very thin`, `thick`, `dashed` and the rest as `.style` entries. The registry has only 12 built-ins (`custom-styles.ts:110-123`: `help lines`, `background *`, ...). Everything else is an `if (key === "very thin") return {...lineWidth: 0.1}` in `apply-flag.ts:123-202`, with the dash pairs `[3,3]`, `[4,2]`, `[6,4]` written as arrays. A user redefinition of `thick/.style` or `every dashed` cannot be seen consistently by the two mechanisms. I have not tested that.
- **Concrete drift: `every <shape> node` enumerated by hand.** `custom-styles.ts:29-108` lists 36 `every X node/.style|.append style|.prefix style` strings. A regex handles the same names in `evaluate.ts:3162` and a TS union in `nodes/types.ts:4`. PGF builds the style name with `\csname`, so there is nothing to enumerate.
- **Possible bug, not run:** `circle[radius=..]`, `ellipse[x radius=..]` and `arc[...]` take their parameters from the literal entries of the `PathOption` item after macro expansion only (`path/evaluate.ts:827-852`, `path/shape-options.ts:60-100`). A custom style such as `big/.style={radius=1cm}` used as `circle[big]` would not be expanded there. In PGF the radius key runs through normal key processing and styles apply. Needs a one-line test to confirm.
- **Same option parsed N times:**
  - `parseBoolish` has 4 copies: `evaluate.ts:3788`, `nodes/options.ts:573`, `nodes/matrix.ts:1768`, `path/node-positioning.ts:504`.
  - `parseBoolishOption` (shape-geometry) and `parseBooleanishNormalized` (`utils/booleanish.ts`) are further versions of the same helper.
  - The literal `["true","yes","on","1"]` is written out inline in at least three more places: `decorations/engine.ts:1242`, `nodes/evaluate.ts:1300-1330`, `engine.ts:451`.
  - `normalizeOptionValue` is defined in 5 places (`style/option-utils.ts`, `shared/option-value.ts`, `nodes/utils.ts`, `path/path-attached.ts`, `edit/...`).
  - `resolveOptionValueStartOffset` and `resolveValueStartOffset` are defined 3 times each, and `normalizeDegrees` 5 times.
- **Refactor direction:** build one `OptionKeySchema` table (key path, aliases, value parser, scope: style / node / path / decoration) that is the only place a key is named. The style resolver, the whitelist, the capability matrix and the edit layer would read from it. Define the built-in styles (`thick`, `midway`, `every ... node`) as data in the same registry that handles `.style`. Add `.default`/`.code`-equivalents only for the keys that need them. Size: large (2-3 weeks), and incremental, because `NON_STYLE_OPTION_KEYS` can shrink as owners register. Risk: medium. The high-volume callers are style resolution and `evaluate.ts`, and the unit tests are the guard. First step: collapse the 4 `pos` tables, the 4 boolean parsers and the 5 `normalizeOptionValue` copies. That is a few days and low risk.

### H2. One shape, several parallel if-chains

- **Where:**
  - `nodes/anchors.ts`: `nodeAnchorOffset` 66-541, `resolveAnchorPolygon` 577-751, `registerNamedNodeAnchors` 1607-1940. About 77 `shape === "..."` tests in this file alone.
  - `nodes/shape-emission.ts:92-806`: 715-line `emitNodeShape`.
  - `nodes/matrix.ts:305-700`: a second copy of the shape emission chain for matrix nodes.
  - `nodes/shape-geometry.ts:272-910`: `resolveNodeShapeGeometryParams`, 638 lines, one flat 60-field `ShapeGeometryParams` struct for all shapes, with about 40 `DEFAULT_*` constants (219-261).
  - Also `nodes/layout.ts:328-350`, `nodes/multipart*.ts`, `nodes/options.ts:404-495` (`resolveNodeShape`), `custom-styles.ts`.
  - Roughly 9 places have to learn about a new shape.
- **Quoted drift (same shape, two numbers):**
  - `shape-emission.ts:254` `wp(center.x - r * 0.437, center.y - r * 0.437)` for `circle solidus`.
  - `matrix.ts:429` `wp(matrixCenter.x - radius * 0.52, ...)` for the same shape inside a matrix.
  - PGF (`libraries/shapes/pgflibraryshapes.multipart.code.tex`, `circle solidus` backgroundpath, around line 115): `0.437` times `\radius - max(outer xsep, outer ysep) - .5\pgflinewidth`. The shape-emission value omits the outer-sep and half-linewidth deduction unless `visualRadius` already includes them (not checked), and the matrix value is a different, apparently fitted number.
  - `multipart-layout.ts:128-133` has `lineWidth * 0.3536`, which is `sqrt(2)/4`, in the text offsets for the same shape.
- **Quoted drift (fallback only for three shapes):** `anchors.ts:1619-1640` builds a fallback anchor polygon when the node transform is not identity, but only for `rectangle`, `circle` and `ellipse`. Other shapes without an `anchorPolygon` get no fallback. PGF applies one transform to the saved anchors of every shape.
- **PGF:** `\pgfdeclareshape` in `modules/pgfmoduleshapes.code.tex`. Each shape declares `\savedanchor`, `\anchor`, `\anchorborder`, `\backgroundpath`, `\inheritsavedanchors[from=circle]`, and the generic code handles transform, `\pgfpointshapeborder`, and `inherit` of the base shape. The editor already uses the same idea in places (`nodeAnchorOffset("circle", ...)` for the magnifying glass, `inheritbackgroundpath` equivalent), but by hand-written recursion.
- **Refactor direction:** a `ShapeDef` record per shape (`{ params, savedGeometry(layout), anchors, border(dir), backgroundPath, inherits }`). A registry keyed by `NodeShape` replaces `anchors.ts`, `shape-emission.ts` and the `matrix.ts` copy (the matrix node calls the same `backgroundPath`). Size: large (shape-by-shape; start with the 3 core shapes, then `split` family, then polygons). Risk: medium, and well covered because the comparison corpus (`npm run test:corpus`) renders against TeX. The matrix duplication (about 400 lines) can be removed first, in about a day or two, by having matrix call `emitNodeShape` with a different box.

### H3. Node border intersection (`\anchorborder`) implemented four times with different precedence

- **Where:**
  - `coords/evaluate.ts:491-570` (`intersectNamedGeometryBorder`: circle, rectangle, ellipse, then polygon).
  - `nodes/named-coordinates.ts:185-270` (`intersectNodeBorder`: polygon first, then circle, rectangle, ellipse).
  - `path/label-quotes.ts:1057-1142` (a third `intersectNodeBorder`).
  - `nodes/shape-geometry.ts:2204` (`intersectRayWithPolygon`, the shared primitive), plus `rectangleBorderPoint` and `ellipseBorderPoint` in the callout code (2635-2660).
- **Quoted:** the first checks `if (geometry.shape === "circle")` before the polygon and transforms the direction by the inverse CTM. The polygon branch uses the world-space direction and relies on `registerNamedNodeAnchors` having pre-transformed the polygon (`anchors.ts:1636`). Two conventions are in play: for the same node, shape type decides whether you are in local or world space.
- **PGF:** `\pgfpointshapeborder{node}{point}` in `modules/pgfmoduleshapes.code.tex`, which calls the shape's single `\anchorborder`. All of `(a.45)`, `(a)--(b)` shortening, `label` and `pin` go through it.
- **Refactor:** one `shapeBorder(geometry, direction)` that the shape registry (H2) provides. About 300 lines removed. Risk: low-medium, since any differences between the four are bugs. Do this first if H2 is not planned soon.

### H4. Decorations are fitted approximations, not the PGF automaton

- **Where:** `decorations/engine.ts:520-1150`, one function per decoration (`decorateZigzag`, `decorateWave`, `decorateBumps`, `decorateBrace`, ...).
- **Quoted:**
  - `engine.ts:768-806` `decorateWave` is used for `coil`, `snake`, `waves` and `expanding waves`. It samples `Math.sin(phase) * amplitude * envelope` at `Math.ceil(cycles * 12)` points and emits polylines (`L` commands). It uses `cycles = Math.max(1, total / segmentLength)` and `envelope = 0.5 + 0.5 * t` for `expanding waves`.
  - `engine.ts:834-842` `bumps` has constants `0.11125`, `0.555`, `0.38875`, which look transcribed from PGF's `bumps`.
  - `engine.ts:487-500` `estimateTextAlongPathAdvance` assigns each character a width of `fontSize * 0.56 / 0.68 / 0.33 / 0.35` by character class. The measurement engine already exists for nodes (`nodes/layout.ts:190` uses `textEngine.measure`), but `text along path` ignores it. PGF's `text along path` uses the real font widths of each glyph.
  - `engine.ts:690` `stateStart + 1.5 * segmentLength <= total + 1e-9` is a hand-written version of PGF's `switch if less than`.
  - `engine.ts:604, 708, 1165` three different lower bounds on `segment length` (`0.5`, `0.5`, `1`).
- **PGF:** `modules/pgfmoduledecorations.code.tex` (`\pgfdeclaredecoration`, `\state`, `switch if less than`, `\pgfdecoratedinputsegmentremainingdistance`, `\pgfdecoratedremainingdistance`) and `libraries/decorations/pgflibrarydecorations.pathmorphing.code.tex` (`zigzag` line 31, `snake` 162, `coil` 214, `bumps` 271). Each decoration is a state machine that consumes the input path segment by segment and emits curveto and lineto operations. The remainder at the end of a segment (not a fixed sample count) determines the final shape.
- **Also:** `parseDecorationTransform` (`engine.ts:1215-1305`) is a fourth, partial reader of transform keys (`xshift`, `yshift`, `shift`, `scale`, `xscale`, `yscale`, `rotate`; no `cm`, `xslant`, `rotate around`).
- **Refactor direction:** implement a small decoration automaton runtime (`state`, `remainingDistance`, `inputSegment`, `moveTo/lineTo/curveTo`) and port each built-in as a transcription of the PGF `.code.tex` states. Reuse the main transform parser (H5). Size: large, one decoration at a time, with `snake`, `coil` and `zigzag` first. Risk: medium; the benefit is visible (a decoration that currently differs from TeX in shape and endpoint). If it is not worth it, at least record in the capability matrix that `waves`, `coil` and `snake` are approximations.

### H5. Transformations parsed in several places; engine and shape code use different tolerances

- **Where:**
  - Main path: `style/apply-kv.ts:796-930` (`xshift`, `shift`, `scale`, `xslant`, `rotate`, `rotate around`, `cm`), via `transform.ts`.
  - `decorations/engine.ts:1215-1305` (partial copy, above).
  - `style/patterns.ts:260` (pattern `xshift`/`yshift`).
  - `path/node-positioning.ts:225` (`xshift`/`yshift` for nodes; the comment says they are "already composed, in order, into nodeTransforms.transform").
  - `path/shape-options.ts:94` (`rotate` for `circle`/`ellipse`).
  - `evaluate.ts:2971` (a string list of transform keys, `["cm","/tikz/cm","xslant",...]`, used to flag a feature).
  - `nodes/options.ts:117-245` and `352-402` (`computeTransformScale`, `computeTransformRotation`, `computeRelativeTransformMatrix`), which derive scale and rotation back from a matrix.
- **Observation:** `transform.ts` (67 lines) is the single place for matrix math, which is good. The problem is that `scale` and `rotation` are recovered from `{a,b,c,d}` (`options.ts:352-380`) and used to scale `lineWidth`, `doubleDistance` and `fontSize` (`options.ts:105-114`). A matrix with slant or non-uniform scale makes that single number ambiguous, and the code treats `Math.abs(transformScale - 1) <= 1e-6` as "no scale". Whether this matches PGF's line-width behaviour under `scale` and `transform shape` was not traced; it is worth checking against `pgfcorescopes` and `tikz.code.tex`. Tolerances such as `1e-6`, `1e-9` and `0.05` appear throughout with no shared constant. The coordinate-evaluator side has the same pattern: `evaluateTransformCoordinate` (`coords/evaluate.ts:61-69`) builds a fake frame with identity `a..f` to evaluate a coordinate "without the CTM", and `apply-kv.ts:66-73` undoes the CTM for named anchors ("PGF's named-anchor lookup undoes the current CTM").
- **Refactor direction:** one `parseTransformOptions(optionList) -> matrix` used by style, decorations, patterns and node options; return both the matrix and the "shift-only" form PGF uses for nodes. Size: small-medium (3-5 days). Risk: low. Do this with H4.

### H6. `auto` label placement: two anchor-from-direction tables, only one matches PGF

- **Where:** `nodes/evaluate.ts:1215-1375` and `directionToAnchor` at 1526; `path/label-quotes.ts:1143-1190`.
- **Quoted:**
  - `nodes/evaluate.ts:1536` `if (absX <= 0.35) { return y >= 0 ? "north" : "south"; }` on a normalized vector.
  - `label-quotes.ts:1143` `anchorFacingAway`: `<4 west; <87 south west; <94 south; <177 south east; <184 east; <267; <274; else north west`. This matches `\tikz@compute@direction` in `tikz.code.tex:916-945` exactly.
  - `label-quotes.ts:1169` `autoAnchorFromVector` uses `> 0.05`, which matches `\tikz@auto@anchor` at `tikz.code.tex:4484`.
- **Why it matters:** `auto` nodes in PGF use the `0.05pt` test on the unnormalized offset vector (`\tikz@auto@pre`, `tikz.code.tex:4463`). The `0.35` normalized threshold in `directionToAnchor` accepts a different range, about 20 degrees of direction instead of PGF's roughly 3 degrees, so a node on a shallow slope can land on a side anchor that PGF would not choose. Not run against TeX.
- **Refactor:** make `nodes/evaluate.ts` call `autoAnchorFromVector`, after moving it to a shared module. Size: hours. Risk: low, but may change a corpus image, which is the point.

### H7. Path construction is an imperative builder, not a soft path

- **Where:** `path/evaluate.ts:189-228` (state) and 256-2741; `segments.ts`, `arc.ts`.
- **What:** `PathBuilderState` has 35 fields, of which about 14 are `pending*` flags such as `pendingCircleCenter`, `pendingCircleRadius`, `pendingCircleRadii`, `pendingCircleRotation`, `pendingEllipseCenter`, `pendingArc`, `pendingGrid`, `pendingRectangleFrom`. An operation (for instance `circle`) sets a flag, and a following `PathOption` or `Coordinate` item reads and clears it (`path/evaluate.ts:1777-1800` and 827-880). Each handler is a closure over `builder`, `frame`, `context` and `markFeature`, which is why the function is 2,485 lines. Arcs are emitted as SVG-style `A` commands, with a quarter-circle Bezier approximation (`kappa = 0.5522847`) at `segments.ts:178` for other cases, while PGF turns arcs into Bezier curves with its own control-point formulas (`pgfcorepathconstruct.code.tex`, `\pgfpatharc`).
- **PGF:** `\tikz@@scan@...` reads one operation at a time. A `circle` is complete as soon as `circle` and its parameter are read, and the soft path (`\pgf@path`) is a flat list of moveto/lineto/curveto/close operations.
- **Refactor direction:** split `evaluatePathInFrame` into one file per operation family with an explicit `PathBuilder` class (not a closure bag), and make the "pending" operations a single `pendingOp: {kind, ...}` union. Do not attempt a soft-path rewrite; the `A` command is used by the SVG output and by editing. Size: medium (a week, mostly mechanical). Risk: medium-low if done as pure moves first. This is a maintainability fix, not a correctness fix.

### Smaller items

- **Graph (`path/graph.ts`, 3.8k):** it parses `graph` syntax and applies its own placement (grow, branch, clockwise) with about 98 key comparisons, and does not call the main option resolver for `/tikz/graphs/` keys (`graph.ts:2784`). PGF's `graphs` library keys live in `libraries/graphs/*` and run through pgfkeys. Layout beyond the simple placements (`spring layout`, etc.) is Lua in PGF and cannot be mirrored, so treat anything beyond simple placement as approximate.
- **`foreach/expand.ts`:** `\foreach` is expanded by substituting text into the raw source, reparsing, and keeping a source map (`expandSubstitutedFragment`, 478; `composeExpansionSourceMaps`, 373). That matches TeX's token-level expansion in spirit, but the source-map code is about a third of the file.
- **`evaluate.ts:2539-2960`:** the bounds code (cubic extrema, arc extrema) sits inside the statement driver. It should move to a geometry module.
- **Layout fallbacks:** `nodes/layout.ts:56,185-186` (`charWidth = fontSize * 0.7`, `baseLineY = -fontSize * 0.28`, `midLineY = -fontSize * 0.065`, `lineHeight = fontSize * 1.05`) are used when no text engine is attached. They are placeholders and should not be reachable in a render that is compared to TeX; worth asserting.
- **Faithful examples worth keeping as the pattern:** `label-quotes.ts:1143` (PGF's direction table, copied verbatim) and `circle solidus` `0.437` carrying PGF's own constant. Where the code cites the `.code.tex` macro, it is correct. The problems are where the same rule exists twice.

## 3. Cross-cutting observations

1. **The same PGF rule is coded once per consumer.** Border intersection (H3), `pos` presets (H1), auto anchors (H6), boolean parsing (H1), transform keys (H5) and shape drawing (H2) all show this. In each case a different copy carries a different threshold or order. A single shared primitive per PGF macro (`pgfpointshapeborder`, `tikz@compute@direction`, `pgfkeys` boolean, `pgftransform*`) would remove the class of bug.
2. **No central key schema.** The capability matrix (`capabilities/*`), the whitelist in `style/constants.ts`, the style resolver, the edit layer, and each feature's raw-entry scan are five separate lists of option names. The `test/capabilities.spec.ts` guard catches drift between some of them, not between the scanners.
3. **Raw-text option handling.** Options are strings (`valueRaw`) parsed at the point of use, with `parseLength(raw, "cm"|"pt")` passing the default unit by hand at each call site (`extract-circle-radius.ts` uses `cm`, `decorations/engine.ts` uses `pt` for `xshift` and `cm` for `shift`). About 78 regex tests over strings in `semantic/` and 12 in `foreach/`. Some code generates TikZ option text and reparses it (`label-quotes.ts:717-870`: `composeQuoteOptions`, `parseGeneratedOptions`), which is the opposite of PGF's approach of setting keys directly.
4. **Few "measured/fitted" comments.** A grep for `measured|empirical|fitted|tuned|workaround|heuristic|hack` in these directories returns about 40 hits, nearly all about text measurement (`measuredWidth` etc.), not about fitted constants. The fitted behaviour here is in unlabeled numeric literals (`0.35`, `0.52`, `12` samples per cycle, `0.56`/`0.68` glyph factors), which is harder to find than comments would be.
5. **Large closures and flat structs.** `evaluatePathInFrame` (2,485 lines), `evaluateMatrixNodeItem` (865), `evaluateNodeItem` (760), `emitNodeShape` (715), `resolveNodeShapeGeometryParams` (638), `resolveFrameMeta` (457). Each is a long run of per-key or per-shape branches over shared mutable locals.
6. **Suggested order:** (a) dedupe helpers and the `pos` tables (days, low risk); (b) one `shapeBorder` and one `autoAnchor` (H3, H6; days); (c) remove the matrix shape-emission copy (H2, part 1); (d) shared transform-option parser plus decoration transform (H5); (e) option-key schema and built-in styles as data (H1, long); (f) decoration automaton and `ShapeDef` registry (H4, H2; long, incremental).
