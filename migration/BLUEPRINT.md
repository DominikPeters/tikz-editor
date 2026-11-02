# Architectural Blueprint — tikz-editor → 100% Safe Rust + egui (Stage 1)

- **Date**: 2026-11-01
- **Scope (user-approved)**: *Core spine slice first* — `parse → semantic evaluate → SVG` pipeline,
  deterministic PRNG, CLI render/bench, PGO. The egui app shell renders the resulting `Scene`.
  Legacy TypeScript stays intact and untouched as the A/B parity oracle.
- **Deferred subsystems** (documented gaps, see §6): TeX text engine (~63K LOC glyph
  outlines + OT1 shaper + Knuth-Plass carets), beamer (~26K), edit-action matrix (~33K,
  ~45 `EditAction` kinds), 3D, pgfplots-level libraries, incremental reparse/patch
  machinery (~2.5K, rows 17–18).
- **Parity oracle**: golden SVGs for an 11-doc corpus captured from `@tikz-editor/core`
  `renderTikzToSvgAsync`; compared with `migration/svg_diff.py` (numeric ε = 1e-3,
  structural mismatch = exit 2). Glyph internals (`data-tex-font`, `data-tex-glyph`) are
  excluded from parity because the text engine is deferred; wrapper geometry still compares.
- **Telemetry ledger**: `migration/migration_telemetry.json`.

---

## 1. Codebase Audit, Legacy Census & Latent Bugs Discovered

### 1.1 Legacy census (`scan-codebase --phase before`)

| Metric | Legacy (packages/core + packages/app, .ts/.tsx/.mts/.mjs) |
| :--- | :--- |
| Files scanned | 650 |
| Code LOC | 185,677 |
| Comment LOC | 6,179 (**3.3%**) |
| Max file LOC | **7,680** |
| Avg file LOC | 295 (80.5% under 400) |
| Max nesting depth | 15 |
| Avg function body | 11 LOC |
| Doc-tests | **0** |
| Raw hazards | 1,376 |
| Biggest files (audit) | `svg/emit.ts` 2,346 · `semantic/evaluate.ts` 3,767 · `semantic/path/graph.ts` 3,789 |

### 1.2 Corpus coverage (what the port must render on day one)

11 documents, all render through the legacy pipeline with **0 diagnostics** and have
captured goldens in `migration/goldens/`:
`comments, minimal, multiline, multi-figure-basic, shapes-new, node-graph`
(plus synthetic `grid, paths, coords, styles, nodes`). Collectively they exercise:
statements/comments, multiple figures per file, coordinate systems (`(x,y)`, exact pts),
paths (lines, rectangles, circles, curves, rounded corners), grids, all common node
shapes, `foreach`-style repetition, style parenthesized/precomposed options, arrows and
bends. This defines the Stage-2 feature surface; everything else stays a hard
unimplemented statement with a diagnostic (never silently dropped).

Arena-wide TS harness read-out over all docs (reference, **not** our parity gate):
parse clean statements **1,541** / recovery **646**; elements **12,498**
(paths 7,755, texts 4,270); statements **4,775** (paths 77.6%, unknown 17.1%);
path items **12,713**.

### 1.3 Findings (file:line) — logged to the telemetry ledger

| # | Location | Category | Finding | Port implication |
| :-| :--- | :-: | :--- | :--- |
| 1 | `packages/core/src/render/index.ts:53-78` | architecture | "Hydra" render path: `renderTikzToSvg` / `renderTikzToSvgAsync` / text-scope variants re-implement the same pipeline steps across three scope branches. | One pure `render_tex(src) -> Result<SvgDocument, Diagnostic>` + explicit `Scene`; determinism replaces the async cooperative machinery. |
| 2 | max file 7,680 LOC (`emit.ts`, `evaluate.ts`, `path/graph.ts` are the audit top-3) | hygiene | File-size Hydra per census. | Rust targets ≤ 400 LOC/module; enforced by review + `test:capabilities`-style guard test. |
| 3 | `semantic/nodes/layout.ts:55-56,185-186,396-447` | latent gap | Canvas-less fallback text metrics: `charWidth=fontSize*0.7`, `lineHeight=fontSize*1.05`, `baselineY=-fontSize*0.28`, `midLineY=-fontSize*0.065`. | Replicate formula exactly for node-text **wrapper geometry** parity; TeX glyph metrics stay deferred (documented gap). |
| 4 | `svg/emit.ts:820-829, 854-860` | latent gap | Two independent text emitters: TeX glyph outlines vs literal `<text x y transform baseline-shift>`. | Plain emitter is the parity surface; `data-tex-*` attrs excluded from diff by the comparator. |
| 5 | `packages/app/src/store/reducer.ts:1008-1080,1280,1318` + `types.ts:83-116` | architecture | Undo/redo lives in the app store with full `sourceBefore/sourceAfter` snapshots + forward `SourcePatch[]` + `mergeKey` drag coalescing — not in core. | egui port moves history into `tikz-app::history` with the same snapshot model; core stays pure. |
| 6 | app hit-testing (browser SVG pointer machinery + 18px HitRegion padding) | latent gap | **No geometric point-in-path anywhere in TS** — selection relies on the browser's `pointer-events` machinery. | egui has no SVG pointers: port implements `hit_test(scene, p, tol)` = distance-to-stroke ≤ strokeW/2 + pad, point-in-fill, clip chain, z-order. |
| 7 | edit actions `packages/core/src/edit/actions.ts` (~45 kinds, dispatcher :246, switch :274, drag-from-immutable-baseline :256-271) | architecture | Source-rewriting via `SourcePatch[]`; undo depends on exact patch regeneration. | Deferred slice; the rewrite only implements *render-only* first (edits validated after core parity). |

**Parser / front-end audit (rows 8–18):**

| # | Location | Category | Finding | Port implication |
| :-| :--- | :-: | :--- | :--- |
| 8 | `parser/figure-scan.ts:12,15` (`TIKZ_PICTURE_ENVIRONMENTS`) | quirk to keep | Only `tikzpicture`, `tikzpicture*`, `tikzlayer` environments are figure-scanned; any other env's body is not landed as TikZ. | Rust scanner keeps exactly this env set with balanced `\begin…\end` matching; other envs produce no figure (never crash). |
| 9 | `parser/index.ts` (161 LOC) | architecture | Front-end is a thin facade: figure-scan → tex-lexical → cst-to-ast; no regex, no error-throwing parse. | Rust `parser::parse_tex` is the same 3-stage shape (`scan_figures → lex → cst_to_ast`); token stream = fat pointer to `&str` source. |
| 10 | `parser/tex-lexical.ts:24-43` (comment masking) | latent quirk | Comments are masked **length-preservingly** (byte offsets/line numbers stay valid), with a 1-char-lookbehind quirk at `\end`-boundary masking; whitespace/comments skipped by fixed cursor bumps. | Replicate masking + the quirk verbatim; comments inside path bodies must survive as `PathComment` items with exact source spans. |
| 11 | `parser/shared.ts` (72 LOC) | architecture | Shared balanced-delimited readers (`{…}`, `[…]`) with comments/escapes inert; used by options + node-text recovery. | Rust `parser::shared` mirrors the same paper-doll semantics; node-text brace recovery is the highest-risk region (nested braces, `\(`/`\`, `\nodepart`). |
| 12 | `transform/cst-to-ast.ts` (993) + `transform/unknown.ts:20-27` | architecture | Statement dispatch into the AST; every unrecognized node becomes `UnknownStatement` (and path items become `UnknownPathItem`) carrying a diagnostic — the recovery backbone. | Rust: same `UnknownStatement`/`UnknownPathItem` fallback enums; unknowns never silently dropped; diagnostics typed. |
| 13 | `ast/types.ts` (799 LOC, 39 kinds) | architecture | AST surface: `Path, Scope, Foreach, Node, TikzStyle, TikzSet, TikzLibrary, Pgfkeys, PgfMath, MacroDefinition/MacroCommandDefinition/MacroAlias, Colorlet, DefineColor` + sub-kinds (`ToOperation, PathKeyword, ChildForeachClause, …`). | Rust enums mirror the corpus-used subset; all others map to the Unknown/diagnostic lane. ~2.5K enum/struct LOC gives the Stage-2 checklist. |
| 14 | option-list splitting (`transform/cst-to-ast.ts` balanced readers) | latent quirk | Three independently balanced depth counters — `(`, `{`, `[` — and `[` depth counts **only at brace-depth 0**; options inside greek-letter braces must not swallow bracket options. | Rust 3-depth splitter replicates counters exactly; braced sub-lists push/pop independently. |
| 15 | `semantic/style/apply-kv.ts:1249` | latent bug | Option keys normalize as `trim().toLowerCase()`; differently-cased keys collide (`Line Width` ≡ `line width`) — harmless for TikZ keywords but a collision-by-design we must not "fix". | Keep `trim().toLowerCase()` as the canonical map key; document collision behavior. |
| 16 | `semantic/style/arrows.ts:25` + shorthand sniffer | latent quirk | Arrow specs are dual-sniffed (shorthand `-{…}` form vs graph-edge syntax) with a fixed precedence between the two readings. | Port the same sniff order; wrong precedence flips corpus arrow rendering on ≥1 doc. |
| 17 | env charset in `figure-scan.ts` | quirk to keep | Environment names accepted only over `[A-Za-z0-9*@-]`; scanner hand-bumps over the charset (no regex). | Explicit charset loop in Rust; no regex crate in the parser. |
| 18 | `parser/incremental.ts` (1,076) + `semantic/incremental.ts` (1,262) + `svg/patch.ts` (177) + `svg/namespace.ts` (28) | deferred bundle | ≈2,543 LOC of incremental reparse/patch/namespace machinery: bounded re-lex, statement-anchored re-eval, SVG patch splicing. | Deferred (Tier 2). Rust slice 1 re-parses whole docs per render — deterministic and simpler; ledger item `incremental_machinery`. |

**Semantic / SVG / render audit (rows 19–30):**

| # | Location | Category | Finding | Port implication |
| :-| :--- | :-: | :--- | :--- |
| 19 | `svg/viewbox.ts` + `emit.ts` viewBox math | emit contract | viewBox in pt with padding = 12 exactly; goldens show 12.2 because stroke expansion adds `lineWidth/2` per side; empty canvas fallback is `-12 -12 124 124`. | `svg::viewbox`: `min = p − 12 − hw`, `len += 24 + hw·2` (hw = max stroke halfwidth in the box); fallback constant byte-identical. |
| 20 | y-flip in every path/pos emitter | emit contract | Universal `svgY = 2·vb.y + vb.height − y`; group transform maps `(a,−b,−c,d,e,f) → (a,−b,−c,d,e′,k)` with `k = 2·vb.y + vb.height`. | Single `svg::coords` helper; all emitters route through it (nothing flips twice). |
| 21 | number formatting in `svg/emit.ts` | latent trap | Numbers = `toFixed(4)` then `Number().toString()`; `<1e-9 → "0"`; non-finite → `"0"`. **JS `toFixed` ties round toward the larger integer** — Rust `{:.4}` (round-half-even) differs on ties. | Implement the ECMAScript `Number::toFixed` algorithm on f64/Decimal-style splitting; unit tests for ties 0.00005, −0.00005, 2.675. |
| 22 | `svg/emit.ts:2233-2236` hash pipeline | emit contract | Defs ids `tikz-shading-…` / `tikz-pattern-…` = FNV-1a over **UTF-16 code units**: `Math.imul(hash, 0x01000193)`, `>>> 0`, then base36 digits + `-${len.toString(36)}`. | `fnv1a_utf16(&str)`: fold input through UTF-16 encoding (not UTF-8 bytes), `wrapping_mul(0x01000193)`, format base36 + `-${len.base36}`. |
| 23 | `escapeText` / attr escaping | emit contract | Text nodes escape only `& < >`; attribute values additionally escape `"`. | Same helper, no over-escaping (no `'`, no `>` inside attrs mismatch). |
| 24 | stroke-attribute emission order | emit contract | Attr order: `stroke, fill, fill-rule (only when evenodd), stroke-width, linecap=butt, linejoin=miter, opacities, dasharray, dashoffset (only if |·| > 1e-6)`. | Emit attrs in exactly this order from one function; parallel arrays of stray emitters are forbidden. |
| 25 | `semantic/pgfmath` value format | latent quirk | pgfmath output: ≤1e-12 → `"0"`; `|v − round(v)| ≤ 1e-9` → integer string; else `toFixed(12)` with zero-stripping. | `pgfmath::fmt` replicates thresholds verbatim; feeds `\pgfmathsetmacro`, foreach steps, dims. |
| 26 | `semantic/path/to-operation.ts:636-638` | latent trap | to/bend distances use PGF fixed-point math: `divisor = trunc(round(largest/len·65536)/255)`; `pgfDistance = 16·trunc(16·round(largest·65536)/divisor)/65536`; `baseDistance = pgfDistance·0.3915`; bend angle default 30°. | Copy the formulas line-for-line on f64 (matches JS doubles) — no "equivalent" trig re-derivation; parity on pans/bends depends on it. |
| 27 | `svg/emit.ts:756, 2214` vs `semantic/nodes/layout.ts:56` | latent bug | Multi-line plain `<text>` tspans step `dy = 1.15em` **while node layout line pitch is 1.05·fontSize** — box and glyphs disagree by design in legacy. | Replicate both numbers as-is (box 1.05, tspan 1.15); tspan multiline = first `dy="−((n−1)·1.15)/2em"`, rest `dy="1.15em"`. |
| 28 | `semantic/style/defaults.ts` + `semantic/nodes/*` | emit contract | Defaults: stroke black, fill null, lineWidth 0.4, tipsMode `"on draw"`, `DEFAULT_TEXT_FONT_SIZE = 9.96264`, `\tiny…\Huge` scale = `[0.5,0.7,0.8,0.9,1,1.2,1.44,1.728,2.074,2.488]`; nodes: inner sep `.3333em`, min width/height `1pt`, outer sep `lineWidth/2`, ellipse nodes inflate the draw box ×√2, anchorRadius = max(hw,hh). | `semantic::defaults` as `const`; node layout functions port with the same constants; fonts (deferred engine): serif `"Latin Modern Roman, CMU Serif, Times New Roman, serif"`, sans `"Latin Modern Sans, CMU Sans Serif, Helvetica, Arial, sans-serif"`, mono `"Latin Modern Mono, CMU Typewriter Text, Courier New, monospace"`. |
| 29 | `svg/emit.ts:145-146` + patterns/ + color mix | emit contract | Shading: `PGF_SHADE_SCALE_FACTOR = 0.01992528`, canonical size 100.375 (half 50.1875), ball focus ±10.0375; linear axis y: 50.1875 → −50.1875, stops 0/25 bottom, 50 middle, 75/100 top; radial r = 50.1875 stops 0% inner / 50% / 100% outer; ball = 5 stops from mix ratios. Color mix = round(linear sRGB mix), ratio applies to the **first** color; only `#rgb`/`#rrggbb` + fixed COLOR_HEX table. Patterns: `mm = 2.84527559055`; global phase = `vb.y·2 + vb.height` via `patternTransform="translate(0 ${phase}) …"`; tiles — `lines` 3×3 grid, `dots` r=0.5 at (0,0) (+(−1,−1) neighbor), `crosshatch dots` circles at (0,0)+(1.5,−1.5), `stars/hexagons` pentagon angles `[18,162,306,90,234]` / hexagon `[30,150,270]+[−30,−270,−150]` r=1mm tile 3mm, `bricks`/`checkerboard` 4mm (bricks stroke 0.8). | Port constants verbatim to `svg::{shading, patterns}`; pattern phase applied in document coords *after* y-flip so tiling is viewport-stable. |
| 30 | `svg/arrows/*` (metrics 368, shapes 223, render 249, shorten 185, preview 126) | emit contract | Tip metrics: families — `latex`; `stealth|triangle` = `0.25·(len−inset)`; `kite = min(0.4len, 0.4wid)`; `cm-rightarrow` (`c1x=0.18269·L, c2x=0.58981·L, c1y=halfW·0.4, c2y=halfW·0.116666`); `bar|tee-barb`; `straight-barb`; hooks; `arc-barb`; `square|circle` (0.5·len); `*-cap`; rays; `implies`; default lineEnd 0.15·L. `DEFAULT_ARROW_LENGTH = 8`, `DEFAULT_ARROW_WIDTH = 6`, `STEALTH_INSET = 0.325`. Shortening: endpoint-only, **end processed first**; when tail tips exist only the **last subpath** gets shortened. Tip markup order: `data-source-id, data-arrow-tip-kind, data-arrow-side, data-arrow-index, data-arrow-bend, d,` then style attrs. | Port formulas + order byte-for-byte (`svg::arrows` split per family); shortening pipeline = `shorten_last_subpath` referencing tips-first processing. |

All 30 rows are logged in `migration/migration_telemetry.json` as concrete port
decisions (replicate quirks verbatim; deferred bundles carry explicit ledger items).

### 1.4 SVG emission contract (byte-level, verified against goldens + source)

| Convention | Value |
| :--- | :--- |
| Scale | `1cm = 28.4527559055pt` printed as 4-decimals (`28.45276`); `1pt = 1 SVG user unit` |
| y-flip | `svgY = 2·vb.y + vb.height − y`; transform map `(a,−b,−c,d,e,f)→(a,−b,−c,d,e′,k)`, `k = 2·vb.y + vb.height` |
| viewBox | pt units; pad = **12** (+0.2 → `lineWidth/2` stroke expansion per side shown in goldens); empty canvas fallback `-12 -12 124 124` |
| Numbers | `toFixed(4)` → `Number().toString()`; `<1e-9 → "0"`; non-finite → `"0"`; ECMAScript tie rule (rows 21) |
| Stroke default | `0.4` pt, black, `fill:none`; `stroke-linecap=butt`, `stroke-linejoin=miter` |
| Attr order | `stroke, fill, fill-rule(if evenodd), stroke-width, linecap=butt, linejoin=miter, opacities, dasharray, dashoffset(if |·|>1e-6)` |
| Rounded corners | emitted as `C` cubic Béziers; `cycle` closes with `Z` after corner repair |
| Text | plain multiline: first tspan `dy="−((n−1)·1.15)/2em"`, rest `dy="1.15em"`; fonts = serif/sans/mono stacks (§1.3 row 28) |
| Identity hooks | `data-source-id="path:N"` shared by paths + node text wrappers; defs ids `tikz-shading-<b36>-<len.b36>` (FNV-1a/UTF-16) |
| Shading | constants of §1.3 row 29 (axis direction, stop ratios, ball 5 stops, mix = round(linear), ratio on first color) |
| Patterns | `mm = 2.84527559055`; phase `vb.y·2 + vb.height`; per-tile geometry of row 29; `patternTransform="translate(0 ${phase}) …"` |
| Escape | text: `& < >`; attributes add `"` |

---

## 2. Target Safe Rust Architecture & Module Graph

Workspace `rust/` (3 crates): `tikz-core` (lib; parser + semantic + svg + render + geom),
`tikz-cli` (bin; `render` / `bench` subcommands, exact legacy bench shape),
`tikz-app` (bin; eframe/egui 0.33 shell). `#![forbid(unsafe_code)]` at every root.
All modules ≤ 400 LOC, ≥ 15% rustdoc, doc-tests on public APIs.

```mermaid
tikz_core:
  text (src string)
   └─ parser → figure::Figure[] (AST)
        └─ semantic::eval → Scene { glyphs?, shapes, paths, transforms }  (+ soa::* mirrors)
             └─ svg::emit(document) → String SVG 1.1
        └─ render::render_tex (facade: sanitize figures, parse, eval, emit)
             └─ hit_test(scene, pt, tol)          (egui support)
tikz_cli: render <tex> <out.svg> | bench (BENCH line identical to legacy capture)
tikz_app: egui shell over tikz_core::Scene (selection + pan/zoom via hit_test)
```

### 2.1 Front-end LOC inventory (verified: `wc -l`)

In-scope port ≈ **2,462 LOC**: `parser/index.ts` 161, `figure-scan.ts` 250,
`tex-lexical.ts` 160, `shared.ts` 72, `transform/cst-to-ast.ts` 993, `unknown.ts` 27,
`ast/*.ts` 799.
Replaced-not-ported to line order: the Lezer grammar (`packages/lezer-tikz/src/grammar/tikz.grammar`;
generated tables ≈1,007) and option extraction (~358) — the Rust front-end replaces the
table-generated Lezer machinery with hand-written recursive descent (§1.3 rows 9–14).
Deferred (Tier 2): `parser/incremental.ts` 1,076 + `semantic/incremental.ts` 1,262 +
`svg/patch.ts` 177 + `svg/namespace.ts` 28 ≈ 2,543 (row 18).

### Mapping table

| Legacy file & symbol (TS) | Target Rust module & type/fn | Transformation & LOC target |
| :--- | :--- | :--- |
| `parser/**` (§2.1) | `tikz-core/src/parser/{mod, lexer, statement, coordinate, options, path_spec, foreach}.rs` | char-scanner recursive descent; zero-regex; statements/paths/coords/options subset per §1.2/§2 checklist; `mod.rs` re-exports `parse_tex`. 7 files ≤ 400 LOC. |
| `transform/cst-to-ast.ts` + `unknown.ts` | `tikz-core/src/parser/{statement, unknown}.rs` | dispatch `match` incl. `UnknownStatement` / `UnknownPathItem` constructions + diagnostics. |
| `ast/{types,ids,walk}` | `tikz-core/src/ast/{types, ids}.rs` | enums/structs; ids keep `statement:N` shapes so identity hooks match. |
| `semantic/evaluate.ts` (3,767) | `tikz-core/src/semantic/{mod, figure, scope, style, transform, foreach}.rs` | switches → `match` on explicit enums; state threaded; Scene built up; diagnostics typed (`CompileDiagnostic`). 6 files ≤ 400. |
| `semantic/path/graph.ts` (3,789) + path/** (~6K) | `tikz-core/src/semantic/{paths, bends, grid}.rs` | Path sampling → Bézier/segment lists; grid expansion; to/bend fixed-point (row 26); SoA mirrors under `soa`. |
| `semantic/pgfmath/**` | `tikz-core/src/semantic/pgfmath/{mod, eval, fmt}.rs` | expression evaluator + `fmt` (row 25); no `eval()`-style dynamic dispatch. |
| `semantic/nodes/layout.ts` (text fallback) | `tikz-core/src/semantic/node_text.rs` | plain-fallback metrics formula replicated verbatim (row 3 Chronicle: 1.05 box / 1.15 tspan). |
| `semantic/nodes/*` shapes | `tikz-core/src/semantic/node_shapes.rs` | shape catalog for corpus surface (rectangle, circle, ellipse, diamond…); anchors; border intersections; ellipse ×√2 inflate. |
| `semantic/style/defaults.ts` | `tikz-core/src/semantic/defaults.rs` | constants of row 28 as `const`/`static`. |
| `svg/emit.ts` (2,346) | `tikz-core/src/svg/{mod, numbers, document, paths, text, defs}.rs` | 4-decimal `fmt` util (ECMAScript tie rule); y-flip + margins math; writer = plain `String` push, no DOM. 6 files ≤ 400. |
| `svg/arrows/*` (~1.2K) | `tikz-core/src/svg/arrows/{mod, metrics, shapes, shortening}.rs` | per-family metric functions of row 30; tip markup order preserved. |
| `svg/patterns|shading|geometry|viewbox` | `tikz-core/src/svg/{patterns, shading, geometry, viewbox}.rs` | constants of row 29; id hashing (row 22). |
| `render/index.ts` hydra | `tikz-core/src/render/{mod, scene_cache}.rs` | one pure entry `render_tex()`; `SceneCache` keyed by figure range (deferred wiring). |
| `packages/core/src/prng` equivalent (new) | `tikz-core/src/prng.rs` ✔ done | splitmix64; tested determinism for future randomized fuzz/doc seeds. |
| unit conversions | `tikz-core/src/units.rs` ✔ done | `Pt`, `CM_TO_PT = 28.4527559055`, `MM_TO_PT = 2.84527559055`, `Vec2` — exact legacy constants, `f64` everywhere. |
| `packages/app/src/store/*` reducer/history | `tikz-app/src/{state, history}.rs` | same snapshot+patch model, egui-integrated edit loop. (Slice 2.) |
| hit-testing (browser machinery) | `tikz-core/src/render/hit_test.rs` | geometric: distance-to-stroke ≤ w/2+pad; point-in-fill via even-odd on Bézier meshes; z-order last-wins. |
| CLI bench harness (`migration/golden-capture.mjs`) | `tikz-cli/src/{render.rs, bench.rs, main.rs}` | identical `BENCH <stage> docs=11 iterations=10 renders=110 wall_ms=… per_render_ms=…` line. |

## 3. API Ergonomics & Call-Site Modernization

**Before (TS, async hydra; `render/index.ts:53-78`):**

```ts
const svg = await renderTikzToSvgAsync(source, { textMode: 'tex' | 'plain' });
// internally: 3 scope branches re-implement parse → evaluate → emit plumbing
```

**After (Rust; sync, total, typed):**

```rust
let svg = tikz_core::render_tex(source, RenderOptions::default())?; // Result<String, Diagnostic>
let scene = tikz_core::compile(source)?;     // intermediate Scene for cache/hit-test
let pick = tikz_core::hit_test(&scene, egui::pos2(x, y), 9.0); // replaces browser SVG pointers
```

- Callsites stop awaiting: no cooperative scheduler, no text-scope branch; the Rust CLI
  is the parity harness and the egui app consumes the same synchronous `Scene`.
- Errors: one `Diagnostic { severity, span, message }` enum, no stringly state.
- Edit pipeline (slice 2): `apply_edit_action(&source, &handles, EditAction, &opts)`
  returns `(String, Vec<SourcePatch>)` — patch + snapshot stay rewrite-free.

## 4. Test Harness, Property Fuzzing & Parity Strategy

1. **Unit + doc-tests**: every public fn carries a runnable doc example (target ≥ 95%
   branch coverage; tool: `cargo-llvm-cov` if installable in-sandbox, else documented
   exception). PRNG/units groundwork appears now in `rust/crates/tikz-core`.
2. **proptest** (dev-deps already in workspace):
   - parser: arbitrary token soup never panics (returns diagnostics);
   - coordinates: parse/format roundtrip; out-of-range values → diagnostic;
   - numbers: 4-decimal formatting moves any value by ≤ 5e-5 (rounding contract);
   - y-flip: monotonically flying image of y; bbox margins hold for corpus ranges.
3. **A/B parity**: 11 goldens × `svg_diff.py` (ε=1e-3 numeric / structural ≤ strict).
   Comparator verified: self-compare OK, cross-file refuses. N seeds = 11 docs, run 3×
   (fresh parse each) to confirm determinism; internal f64 matches JS doubles so ε≈0.
   Rationale for f64: TS numbers are doubles; f32 could break 4-decimal rounding equality.
4. **Determinism**: no random visible behavior in core; `prng` exists only for fuzz
   reproducibility.

## 5. 4-Stage Benchmarking & PGO Pipeline Plan

| Stage | Method | Status |
| :--- | :--- | :--- |
| 1 `legacy_baseline` | 11 docs × 10 fresh full-pipeline renders via Node (`golden-capture.mjs`); warm loop 110 renders = **624.4 ms** (5.68 ms/render), peak RSS 287 MB (Python resource wrapper; wall incl. startup 1,596 ms). | ✅ logged |
| 2 `safe_rust` | `tikz-cli bench`: parse+eval+emit all 11 docs once (warm), then 10× corpus loop; same `BENCH` line; operand RSS via wrapper. | planned |
| 3 `soa_simd` | Two measured, real levers on the Rust code: (a) parallel batches over the corpus via `std::thread::scope` (no new deps, still 100% safe); (b) **SoA layout** for path samples (`x[], y[]` arrays) enabling LLVM auto-vectorizing affine-atransform + bbox reduce; express the full SoA-op SIMD mapping in `tikz-core/src/soa.rs` APIs. Above are *implemented and measured*, not aspirational. | planned |
| 4 `pgo_lto` | `RUSTFLAGS="-Cprofile-generate=./rust/pgo-data"` build → corpus workload → `/usr/bin/llvm-profdata merge` (system LLVM 23.1 matches rustc's LLVM 23.1; toolchain ships no bundled llvm-tools) → rebuild `-Cprofile-use=…/merged.profdata` + fat LTO → re-run tests + parity on PGO build → log. | planned |

## 6. Phased Execution Roadmap & Open Questions

- **A. Parser** (rewrite): lexer/statement/coordinate/options/path_spec/foreach + unit +
  proptest; every unsupported statement = explicit diagnostic. Stage-2 keyword checklist
  (reserved words): `bend, cycle, circle, controls, and, rectangle, ellipse, arc, grid,
  plot, coordinates, parabola, sin, cos, to, child, from, parent, svg, let, in,
  coordinate, decorate, node, pic, of, foreach, edge`. Statement surface per row 13 +
  `UnknownStatement` fallback; only `tikzpicture|tikzpicture*|tikzlayer` scanned (row 8).
- **B. Semantic**: scene, scope/style, paths/bends/grid, node shapes + plain text
  fallback; empty-canvas determinism; SoA mirrors.
- **C. SVG emitter**: numbers, document, paths, text (plain), defs — byte-shaped to the
  contract table in §1.4.
- **D. CLI + Stage-2/3 benchmarks**: `tikz-cli render|bench`; log `safe_rust`, `soa_simd`.
- **E. Crucible**: test/clippy/proptest; every iteration logged to the ledger (≤ 5 loops).
- **F. Parity**: 11 goldens ≤ ε=1e-3; log every parity iteration (≤ 5 loops).
- **G. PGO + finale**: stage 4 bench, `scan-codebase --phase after`, log-story (5 first-person
  chapters), render-infographic → `migration_infographic.html`, executive summary.
- **Deferred** (not dropped — roadmap Tier 2/3): TeX text engine 63K; Knuth-Plass caret
  hitmap; beamer 26K; edit-action matrix 33K + egui editing UX; pgfplots/3D libs;
  incremental machinery 2.5K (rows 17–18).

**Open questions**

1. Coverage tool — `cargo-llvm-cov` availability in sandbox (else documented exception).
2. egui text for node labels — replicate legacy's *plain* fallback (documented gap vs
   TeX glyphs) until the text engine lands in a later slice.
3. Whether `SceneCache` (ultimately instant re-render on edit) reaches Tier 1 in this
   session or ships as a follow-on — measured number needed from PGO.
