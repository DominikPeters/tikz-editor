# Engine survey (2026-11-22)

Read-only survey (2026-11-22) of `packages/core` for special-case chains, duplicated rules, and behavior fitted to output instead of derived from TeX/LaTeX/beamer/PGF. Reports:

- `vertical-spacing.md`: lists, environments, blocks, columns, displays (written in the main session)
- `beamer-composition.md`: Beamer composition beyond spacing
- `tex-ir-inline.md`: TeX IR, inline layout, line breaking
- `tex-math.md`: math typesetting
- `tikz-semantic.md`: TikZ/PGF semantic engine

Caveat: git history is squashed (about 98 commits), so churn counts mean little outside `spacing.ts` (47), `render.ts` (39) and `ir.ts` (15). Bugs marked "reported" were found by a subagent and have not been re-checked against TeX.

## Ranked across areas

1. **One vertical-list builder** (vertical-spacing, beamer-composition #1/#2/#3, tex-math H5/H6).
   - `spacing.ts`, three Beamer stacking loops (frame, column, block body) and the display code each re-implement `\addvspace`, `\parskip`, `\prevdepth`/`\lineskip`, `@noparlist`/`@donoparitem`/`\endtrivlist` and minipage `\unskip`.
   - Nearly all Beamer fuzz failures fall here.
   - Fix: the IR emits vertical-mode events in order (list/item/trivlist begin and end, `\par`, boxes, displays, `\color` whatsits, size changes). One builder follows the LaTeX macros, with nested builders for minipage-like containers.
2. **Registers and a group stack in the IR** (tex-ir-inline #1/#2/#3).
   - `\leftskip`/`\rightskip`/`\parfillskip`/size/baselineskip are derived from an alignment enum, with four separate group trackers and regexes over source (`\color`, `\par`).
   - This is the prerequisite for (1): the events need correct register values and real grouping.
3. **Source regexes standing in for structure** (beamer-composition #3, tex-ir-inline #2/#8). Trivlist starts, trailing list skips, `\color`, tabular column alignment, the space-glue profile and the bibliography size are all inferred from text. Most of these disappear with (1) and (2).
4. **Declarative block templates and real frame glue** (beamer-composition #4/#5). Templates are a closed `style` enum with about 19 branches and fitted constants. User `\vfill` in a frame is not modelled.
5. **Inline correctness bugs and duplication** (tex-ir-inline #5/#6/#7/#9), all reported:
   - `A{}V` is kerned.
   - `\texttt{a--b}` is ligatured before the font is known.
   - The space factor after `''` is wrong.
   - The two item builders have drifted (math colour).
   - The tolerance and emergency stretch are hard-wired.
6. **Math structure** (tex-math H1–H4/H7). The core follows tex.web. Array layout is written five times; the §679 baseline rule four times; `{x}` collapse is not done once at parse; `\middle` gets no spacing.
7. **TikZ keys and shapes** (tikz-semantic #1–#7).
   - There is no pgfkeys model (76-handler map plus about 190 scattered key tests).
   - Shape anchor and border logic is written several times, and the copies disagree (circle solidus 0.437 vs 0.52; border intersection order).
   - Decorations are sine approximations.
   - There is a 2,485-line `evaluatePathInFrame` closure.
   - Reported possible bug: `circle[big]` with `big/.style={radius=…}`.

## Suggested sequencing

- **Now, cheap and independent:**
  - Confirm and fix the reported inline bugs (5) and the TikZ duplicates whose copies disagree (7).
  - Merge the duplicated helper tables.
  - Each piece is small, testable and parallelizable.
- **Main refactor:** (2) → (1) as one project. First an event stream from the IR with registers and grouping, then the vertical-list builder run side by side with the old planner, then a cut-over context by context. (3) mostly falls out; displays (math H5/H6) move into the builder.
- **Later:** (4) block templates and frame glue on top of the builder; (6) math array consolidation; (7) a pgfkeys-style key registry and a shape-declaration model, each a multi-day project of its own.
