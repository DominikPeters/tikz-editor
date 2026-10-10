# Canvas Keyboard Semantics: Scenario Catalog

Draft 2026-10-07. Brainstorm, not decided. Companion to
`design/beamer-canvas-editing.md` (canvas focus, structural keys, object
layer). Goal: collect diverse, realistic authoring and editing tasks — prose
and math, from scratch and mid-construct — and check that one small rule set
gives each keystroke an interpretation the user can predict. Scenarios that
expose a genuine fork are marked **⚖** with the options.

Premise change since the canvas-editing doc: the canvas no longer has to type
identically to the bar, and the bar may be dropped for Beamer. So the canvas
must stand on its own: it has to disambiguate positions, reach every
construct, and offer an escape hatch to raw source.

## Decisions so far (2026-10-08)

- **The source alone determines interpretation.** Everything the editor
  infers (macro behaviour, quote style, list style) comes from the
  document source: preamble, definitions and existing conventions. There
  is no editor-internal per-document state and there are no hidden
  overrides. The same file opened anywhere edits the same way. The one
  piece of non-source state, which braces the editor itself just created
  (R6), lives only for the current editing session. Once the session
  commits, those braces count as authored.

- **Boundaries follow TeXmacs: two stops, made visible.** Every construct,
  style wrappers included, has an inside and an outside stop at each edge.
  Outlines and caret shape show which one the caret is at. TeXmacs is the
  reference model for the structural parts. See "TeXmacs reference
  behaviour" below and the revised R8.
- **`$` in prose always starts math.** A literal dollar is typed `\$`
  (M3, R12).
- **No "magnetic" scripts** (revised after review): `^`/`_` typed just
  outside a formula are prose like anywhere else (M4b). "Outside a formula
  means prose" holds without exceptions.
- **`⌫` right after a content construct selects it; a second `⌫` deletes
  it** (M11). This deliberately departs from TeXmacs, which moves into the
  construct instead. **After a style wrapper, `⌫` deletes its last
  character** (R9).
- **Scripts follow TeX's single-token rule**, not TeXmacs's stay-open rule
  (R6).
- **`⌫` at the start of a non-empty slot steps out**, as in TeXmacs. A
  separate Unwrap command removes a construct and keeps its content (R9).
- **Outlines: the focus plus a faint outline on its parent** (R8).

## TeXmacs reference behaviour

Taken from the TeXmacs 2.1.5 manual and from reading its editor sources for
behaviour only. TeXmacs is GPL and this project is MIT, so no code is
copied or ported; only observed behaviour is described here, in our own
words.

**Outlines.**
- By default, every construct enclosing the cursor gets a thin 1px outline
  in a "context" colour. The innermost one, the *focus*, gets a distinct
  focus colour (the cyan box).
- Structured commands act on the focus. With a selection, the focus is the
  innermost construct containing the selection.
- Optionally there is a third, *semantic* outline in math: it surrounds the
  operand or subexpression and is green when the formula parses and red
  when it doesn't.
- Outlines are hidden in presentation (full-screen) mode.

**The cursor encodes context.**
- It is an I-beam with small serifs, slanted in italic text and drawn with
  a double stroke in bold text.
- In sans-serif text it has no serifs.
- It has a different colour in math mode.

Together with the outline, this makes two positions at the same x
distinguishable, for example inside vs outside a bold run.

**Arrow keys.**
- Plain arrows visit every accessible position, which means every
  construct edge costs one press.
- Structured motion is separate. Ctrl+arrows move word by word in plain
  text, and otherwise visit all positions. Other bindings move to the
  previous/next/first/last argument of the focus, or leave the focus to the
  left or right.

**Backspace** (`⌫`; forward Delete is symmetric).
- After a construct with arguments: the cursor moves into its last
  argument, at the end. Nothing is deleted. A construct with no arguments
  is deleted outright.
- At the start of a non-empty argument: the cursor moves to the end of the
  previous argument. In the first argument, it leaves the construct to its
  left. There is no unwrap.
- In an empty argument: that argument is removed, if the construct's arity
  allows it. When all arguments are empty, the whole construct is removed.
- At the start of a style region (bold, colour): the cursor steps out of
  it to the left. Nothing is deleted. An empty style region is removed.
- Bracket pairs: deleting one bracket makes it invisible, and once both are
  gone the pair disappears, keeping its content.

**Creation.**
- `^`/`_` create a script with the cursor inside. The cursor *stays* there;
  the footer says "move to the right when finished". This is unlike TeX's
  rule that the script is a single token.
- With a selection, `^` makes the selection the script, and a fraction
  makes the selection the numerator with the cursor in the denominator.
- Empty arguments show as placeholders.

**Commands.**
- `\` enters a "hybrid" command mode, shown in the footer; Return executes
  it. Known LaTeX commands come first, then the document's own macros,
  which are created with the right number of arguments.
- Tab cycles symbol variants: `p ⇥` → π, `<= ⇥` → further relation
  variants.
- Ctrl+Tab cycles *structured* variants of the focus: theorem → lemma →
  proposition, or inline ↔ display math.

**Arguments that are not rendered** (a hyperlink's URL, for example) are
edited by temporarily showing that one construct in its source-like
"inactive" form. This is TeXmacs's version of our source lens (R13).

**Hints.** The footer shows short hints for the current mode ("type
numerator, move down, type denominator").

## Notation

- Source is shown in code; `‸` marks the caret's source position, `⟦…⟧` a
  selection. (`|` is avoided because it is TeX's absolute-value bar.)
- Keys: `⌫` Backspace, `⌦` forward Delete, `⏎` Enter, `⇥` Tab, `␣` space,
  `←→↑↓`, `⌘ ⌥ ⇧` modifiers. A typed string like `\in` means those
  keystrokes in order.
- **Sees** describes the canvas; **Rule** cites the rules below.
- Carets sit at **canonical offsets**: a position between two items is
  written at the start of the next item, after any invisible whitespace
  (`$A\cup ‸B$`, not `$A\cup‸ B$`). The executable versions of these
  scenarios (`test/editing/scenarios.ts`) use this convention.
- *Content construct*: has its own outline and slot(s) — math island, math
  slot (numerator, script, root body, `\text{}`, `\left…\right` body),
  `\url`/`\href` argument, macro argument slot.
- *Style wrapper*: changes appearance only — `\textbf`, `\textit`, `\emph`,
  `\underline`, `\texttt`, `\textcolor{c}{…}`, `\alert`, `{\bf …}`.

## Candidate rules

These came out of working through the scenarios; each scenario cites the
ones it relies on.

- **R1 Typed TeX is kept.** If a keystroke sequence is valid TeX in the
  caret's context, it produces exactly that source. A TeX author can type
  what they would write in a `.tex` file. The canvas adds feedback
  (placeholders, chips, outlines) but does not reinterpret it. The
  exceptions are R2, R4's space handling, and opt-in conveniences, which R12
  can always undo.
- **R2 Escape destructive specials in prose.** In text context, `%` → `\%`,
  `&` → `\&`, `#` → `\#`, `_` → `\_`, `^` → `\^{}`. These characters either
  destroy content (a comment eats the rest of the line) or are errors, so
  no canvas user means them literally. `$ { } \ ~` keep their TeX meaning.
  Nothing is escaped in verbatim-like slots (`\url{…}`). In alignment
  environments, `&` separates cells.
- **R3 Auto-pair openers and step over closers.** `$` → `$‸$`, `{` → `{‸}`,
  `\[` → display block. (`\left(` is written alone, M14.) Typing the closer
  right at its auto-inserted twin steps over it. `⌫` on an empty pair
  removes both. The source stays balanced at every keystroke. `\{` pairs
  with `\}` (K3). `(`, `[` and `\bigl(` do not auto-pair (K16).
  **Delimiter consumption:** when the editor has created argument slots
  (`\frac{‸}{}`), typed delimiters that match them are consumed rather than
  inserted. `}` at the end of a slot steps out of it, and a `{` typed right
  where the next pre-created slot begins steps into that slot. So typing
  `\frac{n}{2}` key by key yields exactly `\frac{n}{2}`.
- **R4 `\` opens a command chip.** An inline chip shows the name being
  typed, with completion from the engine's symbol table and the preamble's
  `\newcommand`s, each with a rendered preview.
  - Letters extend the name.
  - `␣`, `⇥` or `⏎` commit it as a structure: argument slots with
    placeholders, caret in the first. In text context, `␣` also yields a
    visible word space (see R5).
  - `{` commits the same way (and steps into the first slot).
  - Any other non-letter commits the name as typed, then is processed
    itself (`\alpha^` → `\alpha`, then a superscript).
  - `\` followed by a non-letter commits a control symbol at once (`\%`,
    `\,`, `\$`, `\[`).
  - `Esc` cancels the chip. An unknown name commits as a red error atom.
- **R5 Keep control words terminated.** When a letter (or, in text mode, a
  space) would directly follow a control word, the editor inserts the
  terminator: `{}` in text mode (`\LaTeX{} is`), a space in math
  (`\cup B`). Terminators are not items, so the user can never delete one
  by accident.
- **R6 Scripts follow TeX.** `^`/`_` in math open a script slot. The first
  token fills it and the caret leaves it (`x^2+1` → x²+1). If the first key
  is `{`, it is a group slot that stays open until `}`, `→` or `⇥`. Typing
  into a single-token unbraced slot adds braces (`x^2` → `x^{23}`). Braces
  the editor created are dropped when they turn out unnecessary; braces the
  user wrote are never removed.
  - Decided 2026-10-08, **deliberately departing from TeXmacs** (where
    the cursor stays in the script until `→`). TeX authors type
    `x_1,\ldots,x_n`, `a_ib_j` and `x^2+1` from muscle memory, and a
    stay-open rule would nest these. Under the TeX rule, a mistake costs
    little: `x^ij` → x^i j is one character outside, visible at once from
    the full-size caret, and fixed by typing into the script (which adds
    braces). A middle ground (exit on operators and punctuation) was
    rejected as unpredictable.
- **R7 One keystroke, one visible change.** The caret moves by rendered
  items (characters, ligatures, accented letters, symbols, whole
  structures) within its current slot. Each `←/→` changes the caret's
  position, its size (smaller in scripts) or its outline. Invisible syntax
  (`\textbf{`, `}{`, `_`, terminator spaces, `\label`, comments) never costs
  a keystroke.
- **R8 Every construct has two boundary stops, made visible (TeXmacs
  model; decided 2026-10-08).** This covers content constructs and style
  wrappers alike.
  - At each edge there is an inside stop and an outside stop, and crossing
    the edge costs one `←/→`.
  - Typing goes into whatever context the caret's position is in. There is
    no style-inheritance rule.
  - Outlines (decided 2026-10-08): the innermost construct around the
    caret, the *focus*, gets an emphasised outline, optionally with a small
    tag (`textbf`, `sub`, `url`). Its immediate parent gets a fainter one.
    Further ancestors are not drawn: on a busy slide, TeXmacs's full
    context would be noise. This is what R7's "outline change" refers to.
  - The caret shows its style: slanted in italic, double stroke in bold, in
    the text colour for `\textcolor`/`\alert`, and with a math tint inside
    formulas. The toolbar state agrees.

  *(Superseded draft: a single stop at style-wrapper edges, with typed text
  taking the left neighbour's style, as in Word.)*
- **R9 Deletion is structural.** `⌫` deletes the previous item in the slot.
  - Guiding principle: **`⌫` never deletes more than one visible character
    without first showing what it will delete.**
  - `⌫` acts on the **actual preceding item**, looking through style
    wrappers: in `\textbf{$x$}‸` the preceding item is the formula, so it is
    selected first. In `\textbf{bold}‸` it is the "d", which is deleted.
  - Right after a content construct (formula, fraction, root, macro call,
    link): selects the whole construct, and the second `⌫` deletes it
    (decided; TeXmacs moves inside instead).
  - Right after a style wrapper: deletes the wrapper's last character and
    leaves the caret inside: `\textbf{bold}‸` → `\textbf{bol‸}` (decided
    2026-10-08). A bold run is styled text, not an object; TeXmacs needs two
    presses for this (step in, then delete).
  - At the start of a later slot (denominator): moves to the end of the
    previous slot (as in TeXmacs).
  - In an empty slot: removes the slot if the construct allows it,
    otherwise the whole construct once all its slots are empty (as in
    TeXmacs).
  - At the start of a non-empty first or only slot: steps out to the
    construct's left without deleting anything (TeXmacs; decided
    2026-10-08). `⌫` from inside never removes structure that still has
    content. Removing a construct while keeping its content is a separate
    **Unwrap** command acting on the focus (TeXmacs's "remove structure
    upwards"). It is in the context menu, with a tentative shortcut of
    `⌘⇧⌫`. List items are an exception: `⌫` at item content start keeps
    its existing merge-with-previous-item behaviour, because items are
    flow, not slots.
  - **Key repeat never confirms.** A select-then-delete selection made by
    `⌫` is only deleted by a fresh press, not by auto-repeat. Holding `⌫`
    therefore stops at the first construct, instead of swallowing a whole
    formula two repeats later.

  Range deletion removes items. Style wrappers shrink to what remains and
  disappear when empty.

  **Selection snapping** (clarified after review): a selection that stays
  inside one slot is free. In `$a‸+b$`, `⇧→` selects just the `+`. A
  selection is promoted to the whole construct only when its focus end
  *crosses* a content-construct boundary: leaving the slot it started in,
  or entering a formula from prose. Reversing direction until the focus is
  back in the starting slot undoes the promotion.
- **R10 Typing replaces a selection, with explicit wrapping triggers.** With
  a selection, `$` in prose wraps it into math, and `⌘I`/`⌘U` and the
  frequent-styles list wrap it. A command chip wraps it only if the command
  has a known **content argument**, and the selection goes *there*, not
  into the first argument by arity:
  - `\textcolor` with "risk" selected: the colour picker opens first, and
    `\textcolor{red}{risk}` is written once a colour is chosen (O8).
  - `\href` with "website" selected: an inline URL field opens, and the
    source is written when the URL is confirmed (O8).
  - `\frac{a}{‸}`: the selection becomes the numerator.

  Argument roles come from a small built-in schema for standard commands,
  and from the K1 classification for user macros. Commands without a
  known content argument replace the selection. Everything else replaces
  the selection.
- **R11 Invisible tokens stay put.** Where several source positions collapse
  into one stop because of invisible tokens (`\label`, `% comment`,
  `\pause`, terminators), typed text goes on the content side: before
  trailing invisibles, never after a `%` on the same line. Around overlay
  markers, it goes on the side that is visible in the step being shown.
- **R12 Transformations are separate undo steps, only where the literal
  state is valid source** (revised after review). Smart quotes and list
  autoformat record the literal keystroke (`"`, `- `) as one undo step and
  the transformation as the next one. `⌘Z` therefore reverts just the
  transformation, as Word does. Where the literal state would be invalid
  (`$` alone, an unfilled `^`, a half-typed chip), there is no such
  intermediate step, and `⌘Z` undoes the whole keystroke. A literal dollar
  is simply `\$`, and the one-time regret hint (V1) teaches that.
  - Undo granularity otherwise: a typing run is one step; a chip from `\`
    to commit is one step; each structural key (`⏎`, `⇥`, Unwrap) and each
    automatic cleanup (empty-wrapper removal) folds into the action that
    triggered it.
  - Ending a session merges its steps into one store-level undo entry, as
    today. Undo after the session has ended, or after switching slides,
    restores source and selection and reopens the session at that
    selection.
- **R13 Source lens.** `⌘E`, or `⏎` on a selected atom, opens the raw source
  of the innermost construct (or the selection) in a small inline editor
  anchored on the slide, with live re-rendering. It closes on `Esc`, or on
  `⏎` when the source is balanced. This is the bar's replacement as escape
  hatch: optional arguments, overlay specs, comments, unknown macros,
  broken source. A TeXmacs-like variant: when the caret needs to reach an
  argument that is not rendered (colour, URL, overlay spec, optional
  argument), that one construct temporarily renders in a compact source
  form on the slide, e.g. `textcolor⟨red⟩⟨risk⟩` with editable fields, and
  returns to normal when the caret leaves it.
- **R14 Reveal codes.** A toggle (¶ button) shows invisible syntax as small
  gray chips (`⏸ pause`, `% TODO…`, `label`, `vspace`). In this mode they
  are items: the caret can step over, select and delete them.
- **R15 Paste.** Plain text pasted from outside is literal. *All* TeX
  specials are escaped, including `$ { } \ ~ ^` (unlike typing, R2,
  where those keep their TeX meaning). Pasted newlines become spaces
  inside a slot, and paragraph breaks only in body prose. A copy made on
  the canvas carries source as a custom type, which pastes as source. It
  converts on context change: math copied into prose is wrapped in `$…$`,
  and prose pasted into math is wrapped in `\text{…}`. "Paste as TeX" (Edit
  menu, and the C2 pill) pastes outside text raw. Today's paste handling
  reads only `text/plain` (`useCanvasTextEditSession.ts`), so the custom
  type is new work.
- **R17 Composition comes first.** Keyboard composition sessions (IME, and
  dead keys such as `^` on French and German layouts) are never
  interpreted mid-composition. The rules act only on the committed
  characters: a dead `^` followed by `e` commits `ê`, and is never a
  script or `\^{}`. While composing, `Esc`, `⏎` and arrows belong to the
  composition, not to the canvas. (Today's canvas `Escape` handler has no
  composition guard.)
- **R16 Unicode.** In math, typed Unicode symbols map to commands
  (`α` → `\alpha`, `≤` → `\le`). In prose, Unicode is inserted as UTF-8.

---

## P — Prose authoring

**P1 Percent mid-sentence.** `Accuracy rose by 5‸ overall.` · keys `%`
→ `5\%‸`. Sees "5%". A TeX user typing `\%` gets the same source: the chip
commits the control symbol at once. *R2, R4.*

**P2 Ampersand, hash, underscore.** Typing `R&D`, `C#`, `file_name` gives
`R\&D`, `C\#`, `file\_name`, also inside `\texttt{}`. *R2.*

**P3 Quotes.** `They generalize ‸.` · keys `"gradient equals zero."`
→ ``` ``gradient equals zero.'' ```. A `"` after start, space or an opening
bracket gives ``` `` ```, otherwise `''`. TeX users typing the backticks
directly get them unchanged. “ is one item. `⌘Z` right after a converted
quote leaves a literal `"`. *R1, R12.* The quote style follows the
document's existing convention: if the source already uses Unicode “ ”
and never ``` `` ```, insert Unicode quotes; otherwise use ``` ``…'' ```.
`csquotes` is not special-cased. In Dominik's research folder, only 43 of
6,774 `.tex` files load it, against about 2,170 that use ``` `` ``` and
about 160 that use “ ” (decided 2026-10-08).

**P4 Dashes.** `pages 3‸` · keys `--5` → `3--5`, sees "3–5". Then `⌫` →
`3--‸` (deletes the 5), and `⌫` again → `3‸`: the en dash is one item even
though it was typed as two keys. *R1, R7.* ⚖ Should `⌫` right after typing
the second `-` give back a hyphen? (It would need `-{}-` to block the
ligature; probably not worth it.)

**P5 Tie.** `Theorem‸` · keys `~1` → `Theorem~1`; sees a non-breaking space.
TeX meaning kept. ⚖ Word users wanting a literal tilde must use the chip
(`\textasciitilde`); this should be rare on slides.

**P6 Control word in prose.** `I use ‸ daily` · keys `\LaTeX␣`
→ `I use \LaTeX{}‸ daily`. There is already a space after the caret, so the
commit space only commits. Without one (`I use ‸`), the result is
`\LaTeX{} ‸`. Either way the slide shows a normal word space. *R4, R5.*

**P7 Letter right after a 0-arg command.** `see \ldots‸` · keys `x`
→ `\ldots{}x` (not `\ldots x`, which would bite if the user later types a
space there). *R5.*

**P8 Old-style TeX group.** `‸` · keys `{\bf x}` → `{` auto-pairs to
`{‸}`, `\bf␣` commits inside, `x`, then `}` steps over → `{\bf x}‸`, which
renders bold. The group is a style wrapper, outlined like every construct
(R8), with the tag `bf`. *R1, R3, R8.*

**P9 Literal backslash.** Typing `\` always opens a chip. A literal
backslash comes from completing `\textbackslash`. ⚖ Or `\\` while the chip
is empty? No: that is a line break in TeX.

**P10 Markdown-style list autoformat (to try, conservatively).** An empty
paragraph · keys `- ` → `\begin{itemize}\n  \item ‸\n\end{itemize}`.
**Itemize only:** `1. ` stays literal text, since "1. " legitimately
starts sentences and numbered points. It fires only when `- ` are the
first two characters of an empty paragraph in body or column prose: never
mid-paragraph, inside math, in titles, or at the start of an existing
item. `⌘Z` right after leaves the literal `- `; this is the one place with
a "keep `- `" pill (V1). *R12.*

## F — Formatting

**F1 Bold while typing.** `This is ‸.` · keys `⌘B really ⌘B important`
→ `This is \textbf{really} important‸.`
- The first `⌘B` inserts an empty `\textbf{‸}`. It is outlined, and the
  caret is drawn with a double stroke. If the caret leaves while the
  wrapper is still empty, the wrapper is removed.
- **`⌘B` never moves the caret** (revised after review). The second `⌘B`
  is at the run's end, `\textbf{really‸}`, so it flips to the outside stop
  at the same visual position. The outline disappears and the caret
  returns to a single stroke, so the space goes after `}`.
  - With a collapsed caret mid-run between words, `\textbf{one ‸two}` →
    `\textbf{one }‸\textbf{two}`: the run is split in place, and the caret
    sits plain between the two halves. The existing helper in
    `format-commands.ts` already splits this way.
  - Mid-word, F3 applies: the whole word is toggled.

*R8.*

**F2 Continuing a bold word.** `\textbf{bold}` followed by ` text`.
- Arriving by `→` from inside, the first press past the "d" leaves the
  caret at `\textbf{bold‸}`: still outlined, double stroke. Typing `er`
  → `\textbf{bolder}`.
- One more `→` gives `\textbf{bold}‸`: no outline, single stroke. Typing
  `er` → `\textbf{bold}er`.
- A click resolves like an arrow arrival. A click on the bold glyphs'
  right half lands inside; a click in the gap after them lands outside.
  The caret shape confirms which, before any typing.

*R7, R8.*

**F3 `⌘B` mid-word, no selection.** `imp‸ortant` · `⌘B` →
**Decided: (a)**, as in Word: bolds the whole word → `\textbf{important}`.
(The rejected alternative, as in TeXmacs and Google Docs, inserts an empty
`\textbf{‸}` at the caret.)

**F4 Unbolding part of a run.** `\textbf{⟦bo⟧ld} text` · `⌘B`
→ `bo\textbf{ld} text`. Middle part: `\textbf{b⟦ol⟧d}` → `\textbf{b}ol\textbf{d}`.
Correct, if a bit ugly. (The format-commands deferral of "mixed-run partial
toggling" becomes required.)

**F5 Deleting across a style boundary.** `a⟦b\textbf{c⟧d}e` · `⌫`
→ `a‸\textbf{d}e`. As in F6, a deleted range collapses to its start
position, which is outside the bold run here. Selecting all of `bcd` → `a‸e`: the empty wrapper is
removed. *R9.*

**F6 Typing over a selection that crosses a boundary.** `a⟦b\textbf{c⟧d}` ·
keys `X` → `aX\textbf{d}`. The selection collapses to its *start*
position (here outside the bold run), and the typed text goes there.
*R8, R10.*

**F7 Wrapping with a command chip.** `the ⟦main idea⟧ is` · keys `\emph␣`
→ `the \emph{⟦main idea⟧} is`. The selection survives, so a second wrap
works. *R10.*

**F8 Coloured text.** `\textcolor{red}{risk‸}` (inside: the caret carries a
red swatch serif, per V11's caret legibility) · keys `y` → `{risky}`. At
`\textcolor{red}{risk}‸` (outside, plain caret) it gives `…{risk}y`. To
change the colour, use the swatch menu or the focus tag. Alternatively
the colour argument opens as a compact inline field (R13 variant), and
`⌘E` opens it raw. *R8, R10, R13.*

## M — Inline math

**M1 Formula from scratch, the TeX way.** `Let ‸` · keys `$x\in\R^n$ be`
→ `Let $x\in\R^n$ be‸`. Step by step:
- `$` → `$‸$`, an empty outlined placeholder.
- `x` goes into the formula.
- `\in` is a chip; the next `\` commits it and opens a new chip.
- `R` completes from the preamble, previewing ℝ.
- `^` commits `\R` and opens a superscript slot; `n` fills it and the caret
  leaves it.
- `$` steps over the closing twin, and ` be` is prose again.

The source equals the keystrokes. *R1, R3, R4, R6.*

**M2 Turning prose into math after the fact.** `Let ⟦x⟧ be` · `$`
→ `Let $x‸$ be`, caret inside, outlined. *R10.*

**M3 A literal dollar sign.** `costs ‸` · keys `$5` → `$5‸$`, an outlined
math box with an upright 5. **Decided:** `$` always starts math, and a
literal dollar is typed `\$`. If the user removes a just-created formula
right away (`$`, `⌫`), the hint line says once: "literal $: type \$" (V1).
There is no `⌘Z` trick (R12). The cost: a Word user typing "$5 and" sees
"5and" inside a box, and has to notice the box.

**M4 Subscript right after a formula (caret outside).** `the $\lambda$‸ are`
· keys `_i` → **decided: (b)**, the literal `\_` per R2: the slide shows
"λ_i". The user sees the underscore, presses `⌫`, then `←` to get back
inside the formula, and types `_i` there. That is the same teaching
moment as the circumflex (K5).
- Rejected (a), "magnetic" `^`/`_`: attach the script to the formula's
  last atom and return outside, giving `$\lambda_i$‸ are`. It was
  initially chosen, then dropped after review. It was the only exception
  to "outside a formula means prose", and it silently picked the operand
  (`b` in `$a+b$`).

**M5 Multi-token exponent.** `$‸$` · keys `e^{i\pi}` → `e^{i\pi}`.
- `^` opens a slot; `{` makes it a group slot.
- `i`, then the `\pi` chip.
- `}` commits the chip and steps over the closing brace.

By contrast, `x^2+1` gives `x^2+1` with the caret leaving after the `2`.
*R1, R6.*

**M6 Editing an exponent.** `$x^2$`: clicking the right half of the 2 puts
a *small* caret inside the script. Typing `3` → `x^{23}`. Clicking just
past the 2 (a full-size caret, outside the script) and typing `3` → `x^23`,
which renders x²3. The caret size shows which one you'll get. *R6, R7.*

**M7 Replacing a symbol.** `$A\setminus B‸$` · `←` → `$A\setminus ‸B$`:
one press over B, and the terminator space costs nothing. `⌫` removes
`\setminus` and its now-pointless space → `$A‸B$`. Keys `\cup␣` →
`$A\cup ‸B$`; R5 adds the space because B is a letter. That is three
actions where today it takes ten keystrokes or more. Alternative: `⇧←` to select ∖,
then `⏎` re-opens it as a chip `\setminus‸` to rename. *R4, R5, R7, R9.*

**M8 Fraction three ways.**
- `\frac␣` → `\frac{‸}{}` with two placeholders. `n`, `⇥` (to the
  denominator), `2`, `⇥` (out) → `\frac{n}{2}`.
- Typed TeX `\frac{n}{2}` → the same source, via R3 step-over.
- Typed TeX `\frac12` → `\frac12`, rendering ½. Clicking after the 1 in
  the numerator and typing `0` → `\frac{10}2`.

*R1, R4, R6.*

**M9 Wrapping a selection.** `$⟦n+1⟧$` · keys `\sqrt␣` → `$\sqrt{n+1}$`.
`$⟦a⟧$` · `\frac␣` → `\frac{a}{‸}`, with the caret in the denominator,
since the selection filled the first slot. *R10.*

**M10 Removing a root but keeping its content.** `$\sqrt{‸n+1}$` (reached by
`→` from before the √, which enters the body).
- `⌫` → `$‸\sqrt{n+1}$`: the caret steps out and nothing is deleted.
- To drop the root, use **Unwrap** (`⌘⇧⌫`) with the caret anywhere inside
  it → `$n+1$`.
- Alternatively `⌫` from outside selects the root, and then **Unwrap**.

*R9.*

**M11 Backspacing after a fraction.** `$\frac{a}{b}‸+c$` · `⌫` selects the
fraction (highlighted), and a second `⌫` deletes it. *R9.* **Decided.**
TeXmacs and MathQuill instead move into the denominator.
Select-then-delete matches what the deck object layer already does. To
edit inside, press `←`.

**M12 Inserting a term mid-formula (KKT Lagrangian).**
`f(x)‸+\sum_{i=1}^m\lambda_i g_i(x)` · keys `+\mu^\top␣x` →
`f(x)+\mu^\top x‸+\sum…`. Inside the superscript slot, the commit space
commits `\top`, and since that is a single token the slot closes. When `x`
follows, R5 writes the needed space. *R4, R5, R6.*

**M13 Changing a sum limit.** Click on the `m` of `\sum_{i=1}^m` (small
caret in the superscript), `⌫` → `^{‸}`, an empty outlined placeholder.
The braces exist only while the slot is empty, to keep the source valid,
and are editor-created.
Typing `p` → `^p`; no braces are added, because it is still one token. If
the caret leaves while the slot is still empty, the `^` is removed. *R6,
R9.*

**M14 Delimiters.** `\left(` (the chip commits on `(`) is written alone:
`$a\left(‸$`. Until its `\right` is typed, the formula renders as TeX's
recovery does, the delimiter running to the formula's end, except that
the `(` keeps its natural size rather than growing over whatever follows
(a `\sum` it is not meant to enclose); the canvas draws the missing `)`
at the end as a ghost, with "Insert missing \right)" to write it in. `\right)` (or `\right]`: the one typed is the
one written) typed anywhere after it in the same slot closes the
innermost open `\left` there, as one step. So delimiters go around what
is already written by typing them where they belong: `\left(` before it,
`\right)` after it. `⌫` after an open `\left(` (or `⌦` before it) deletes
it alone, never what follows it. Once closed, the pair is a construct.
**Unwrap:** `⌫` just inside its `\left(` (or `⌦` just inside its
`\right)`) removes both delimiters, and any `\middle`, keeping the
content, as one step: one delimiter of a pair cannot go alone, and
stepping out (R9's rule for slots) would leave no way to remove them.
Followed by a script, the content is braced (`\left(a+b\right)^2` →
`{a+b}^2`) so the script stays on all of it. `⌫` from outside selects
the whole group. `\right)` typed after a closed
pair in the same slot moves its `\right` there, extending it. With a
selection, `\left(` wraps it in the whole pair, which stays selected.
*R9, T2.* (Revised 2026-10-10, from use: auto-pairing `\left(\right)`
made wrapping what is already written impossible, and closing the pair
by moving it was not discoverable.)

**M15 Text inside math.** `$x‸$` · keys `\text␣ if 50% ` →
`$x\text{ if 50\% }‸$`. Inside the `\text` slot, prose rules apply:
spaces are real and `%` is escaped. *R2, R4.*

**M16 Unicode input.** With `$a ‸ b$`, typing `≤` → `\le`, and the Greek
keyboard's `α` → `\alpha`. In prose, `≤` is inserted as UTF-8. *R16.* ⚖
Still open, and Dominik is unsure.
- Raw UTF-8 `≤` in prose compiles under LuaLaTeX/XeLaTeX only if the text
  font has the glyph. Under pdfLaTeX it is an error ("Unicode character
  not set up").
- Converting to `$\le$` compiles everywhere, but switches to the math font.

A source-determined middle ground: insert raw UTF-8 when the document
declares LuaLaTeX/XeLaTeX (`% !TeX program = lualatex`, `fontspec`),
otherwise `$\le$`. This is rare enough to defer.

**M17 `⌘B` in math: not supported** (decided after review). `\mathbf` is
an alphabet change, not bolding: `\mathbf{\lambda}` leaves λ unchanged,
and `\mathbf{x}` also turns the x upright. `\boldsymbol` and `\bm` depend
on packages. That is too ambiguous for a shortcut. In math, `⌘B`/`⌘I` do
nothing, the hint line says "bold in math: \boldsymbol or \mathbf", and the
B button is disabled. Math alphabets are typed as commands (K12).

**M18 `⏎` inside inline math.** `$a+b‸$ more` · `⏎` leaves the formula and
then applies the structural `⏎` there: split item or new paragraph
(**decided**; today it does nothing).

## D — Display math and alignments

**D1 Creating a display.** On an empty body line · keys `\[` → the control
symbol commits at once:
```
\[
  ‸
\]
```
with a placeholder. `⏎` at the end of the content leaves to a new line
below. Typing `$` inside an empty inline formula (a `$$` sequence)
converts it into this display, written as `\[…\]` rather than `$$…$$`
(**decided**). That departs from R1, but it is the LaTeX-recommended form.

**D2 Adding a row in `align*` (KKT "The KKT conditions" frame).** Caret at
the end of `\lambda_i^\star g_i(x^\star)&=0.` · `⏎` → `…&=0.\\` plus a
new line with the indent copied, caret there. Keys
`&\text{slackness:} & s_i&\ge 0` — here `&` separates cells and is not
escaped. `⇥` moves to the next cell, inserting the `&` when it is
missing, just as `⇥` moves to the next slot (**decided**). In
environments with a fixed column count (`array`/`tabular` with a column
specification, `alignat{n}`), `⇥` in the last allowed cell moves to the
next row's first cell instead of inserting a surplus `&`. (Corrected after
the second review: plain `align` has no declared limit; it accepts further
column pairs.) Symbol and
structure variants live in the focus-tag menu (V4), not on Tab.

**D3 Deleting a row.** On an empty last row, `⏎` removes the row and leaves
below (as with list items). `⌫` at the start of a row merges it into the
previous one by removing the `\\`, but only in environments without a
fixed column count, or when the merged row still fits: joining
`a&b\\‸c&d` in a two-column `array` would yield three cells. Otherwise
`⌫` at row start moves to the end of the previous row, and deleting a row
goes through the row's focus-tag menu. *Mirrors the list item keys.*

**D4 `array` cells (KKT "Problem form and notation" frame).** `⇥`/`⇧⇥` move
between cells, `↑/↓` between rows. The `\text{minimize}` cell is a `\text`
slot with prose rules.

**D5 Invisible label.** `x=0\label{eq:kkt}` with the caret at the end of the
visible content · keys `+y` → `x=0+y\label{eq:kkt}`: inserted before the
trailing invisible token. *R11.*

## X — Commands and macros

**X1 Unknown command.** Keys `\foo␣` → the chip turns red ("unknown
\foo"). After commit it stays a red atom. `⌫` deletes it in one press.
*R4.*

**X2 Macro with arguments from the preamble.** KKT defines
`\newcommand{\inner}[2]{\left\langle #1,#2\right\rangle}`. Keys `\inner␣` →
completion knows the arity is 2 → `\inner{‸}{}`. Ideally it renders ⟨□,□⟩
with the placeholders as slots, since each argument shows up exactly once in
the output. Until macro-argument slots exist, the arguments are editable
only through the source lens. *R4, R13.*

**X3 Editing an argument of an existing macro.** `\inner{\grad f}{d}`: a
click on the `d` in ⟨∇f, d⟩ puts the caret into argument 2 if
argument-slot mapping exists; otherwise it selects the whole call (today's
behaviour).

**X4 A whole-formula atom caused by a macro.** `$x\in\R^n$` is currently a
single atom, because the `\R` macro taints the whole formula. Expected: only
`\R` is an atom (ℝ is one item); `x`, `\in` and `^n` stay reachable.
*Today's bug.*

## B — Beamer overlays and invisible syntax

**B1 Typing next to `\pause`.** `First point.\pause Second point.`
- Viewing step 1: the caret at the end of "First point." types before
  `\pause`, so the new text shows on step 1.
- Viewing step 2: clicking at the end of "First point." also inserts before
  `\pause`, on the content side. That also keeps the text with its
  sentence.

*R11.*

**B2 Overlay-wrapped text.** These two behave differently (corrected
after review).
- `\only<2>{extra}`: the content exists only on step 2, so it can be typed
  into only there.
- `\alert<2>{key}`: the text is visible on every step, and only its
  highlighting is step-dependent. It is an ordinary style wrapper whose
  colour varies by step, so it can be typed into on any step.

In both, the `<2>` spec is not a slot: it is edited in the inspector or
with `⌘E`. *R13.*

**B3 Comment mid-paragraph.** `…inequalities. % TODO cite\n  Next…`.
Typing at the end of "inequalities." goes before `%`. Without that, the new
text would be commented out and vanish. `⌫`/`⌦` near the comment never
remove it. *R11.* ⚖ Show a small gray "%" marker in the margin even when
reveal codes is off?

**B4 Reveal codes.** With ¶ on, `\pause`, `% TODO cite`, `\label{…}` and
inline `\vspace` appear as gray chips. The caret steps over them,
`⌫` selects-then-deletes them, and `⌘E` on one edits its source. *R14.*

## N — Navigation and selection

**N1 Arrow count.** `$A\setminus B = \frac{x_i^2}{\sqrt{y}}$`: today 39
`→` presses, many of which move nothing on screen. With R7, the stops are:
- around the formula: outside before, and outside after;
- top level: inside, between and after each of A, ∖, B, =, and the
  fraction;
- the fraction: numerator start/end, the subscript `i`, the superscript `2`,
  and the denominator start/end;
- the root body start/end.

That is about 18, each a visible move or size/outline change.

**N2 `⌥→` (word motion).** From prose, a whole inline formula counts as one
word. Inside math, `⌥→` goes to the end of the current slot, then out.

**N3 `⇧→` from prose into math.** The selection snaps to the whole formula;
`⇧←` releases it. A selection crossing *into* a formula never covers half
of it. Selections that start inside a formula and stay within one slot
are free (`$a⟦+⟧b$`). *R9.*

**N4 `↑/↓` in structures.** In a fraction, `↑` goes from denominator to
numerator, and from the numerator to the line above. In scripts, `↑` goes
from subscript to superscript. Otherwise they move by rendered rows, as
now.

**N5 Clicking at a formula edge.** A click inside the formula's ink box
lands inside the formula; a click in the gap after it lands outside. The
outline confirms which.

## C — Clipboard

**C1 Pasting outside text.** "Costs rose 50% at R&D" → `50\%`, `R\&D`.
*R15.*

**C2 Pasting `$x^2$` from a web page.** Pasted literally by default (it
comes out as `\$x\^{}2\$`). If the text parses as TeX with math or
commands, a one-click "Paste as TeX" pill appears after pasting, like
Word's paste options button (**decided**). This is one of the few places
that keep a pill (V1).

**C3 Copying from the canvas.** `text/plain` gets the rendered text (for
email); a custom MIME type gets the balanced source. Pasting on the canvas
uses the source.

---

## K — Corpus walk-through: typing real slides

Imagined typing two real decks from scratch: the KKT fixture
(`test/fixtures/beamer/kkt_theorem_beamer.tex`) and a fair-division
lecture (Dominik's L4a, ~30 frames). The emoji and `\citebox` parts are
skipped as too specific. The constructs below are either missing from the
scenarios above or contradict them. Frequency matters: the first few appear
on almost every slide of the lecture.

**K1 User-defined style macros are style wrappers, not atoms.** The
lecture's preamble defines `\newcommand{\ee}[1]{\textcolor{emphcolor}{#1}}`
and uses `\ee{…}` about 60 times; it is the author's emphasis. R8/R9 and
X1–X4 treat macro calls as atoms, which would make each `\ee{allocation}`
a single unit you cannot type into. **Decided 2026-10-08:** classify
macros automatically by what their `\newcommand` body expands to. There
are no per-macro overrides, for now and on principle: there is no internal
storage. A wrong guess fails safe, because the macro becomes a single unit
whose source stays editable through the lens.
- **Symbol macro** (`\R`, `\act`, `\Lagr`, `\grad`): no arguments,
  renders one thing. An atom; `⌫` deletes it in one press, like a symbol.
- **Style macro** (`\ee`, `\eemph`): exactly one argument, which appears
  once in the output, wrapped only in style commands (one in, one out).
  Behaves exactly like `\textbf`: two stops, caret in the style colour,
  `⌫` deletes the last character, outline tag with the macro's name.
- The classification is generic and **nothing is specific to `\ee`**: no
  built-in support for any user's own macros (decided 2026-10-08).
- **Frequent styles list:** the format toolbar gets a dropdown, and the
  focus-tag variants menu (V4) a section, listing the most frequently used
  one-in-one-out commands. It ranks both general usage (`\emph`,
  `\textbf`, `\alert`, `\textsc`, …) and usage in *this* document, so
  `\ee` appears for this author because the lecture uses it 60 times, not
  because the app knows it.
- **Slot macro** (`\inner{a}{b}`): arguments that each appear once in
  accessible positions become slots, as in a fraction.
- **Everything else** (TikZ-drawing macros, macros that use an argument
  twice or as a number): an atom, with its arguments editable through the
  source lens.

**K2 `\frac1n` is real.** The lecture writes `\frac1n` and `\frac12` (5
times) and never `\frac{1}{n}`. This confirms R4: committing a chip with a
non-letter character must stay verbatim TeX. Editing works through R6's
"typing into an unbraced slot adds braces".

**K3 Set braces `\{…\}` are everywhere** (`N = \{1,\dots,n\}`,
`A_j \setminus \{o\}`). R3 should auto-pair `\{` with `\}`, and stepping
over works as for `$`. Plain `(` and `[` must **not** auto-pair: intervals
like `[0,1]` and `[0,1)` and tuples like `(A_1,\dots,A_n)` make unpaired
brackets normal.

**K4 Typing `^` onto an atom that already has a superscript.** For
example, a caret after `x^2` that types `^3`. TeX rejects `x^2^3` (double
superscript). Following TeXmacs, `^` then moves into the existing
superscript at its end, so typing `3` gives `x^{23}`. `_` behaves the same.
`\lambda_i` followed by `^\star` is fine: it adds the missing superscript
(`\lambda_i^\star`, used throughout the KKT fixture).

**K5 A superscript in prose.** `Clearly, this rule is PO.$^*$` is a
footnote-like mark with an empty base. R2 currently turns `^` typed in
prose into a literal `\^{}` (a circumflex). **Decided: keep the
circumflex.** A literal `^` in prose would be a TeX error, so producing a
visible ˆ is the honest result. Seeing it is a teaching moment: the user
presses `⌫`, then types `$^`, which yields `$^{‸}$`. `_` in prose likewise
stays a literal `\_`.

**K6 Text and math nested both ways.** In
`\[ \text{either } … \text{ or there is $o \in A_j$ with } … \]` and
`\overset{\text{$i$ source}}{\ge}`:
- `$` inside a `\text{}` slot starts nested math (R2 and R3 apply inside
  `\text`).
- The focus-plus-parent outline is exactly what disambiguates these
  layers.
- Spaces inside `\text{ or … }` are visible and matter.
- `\overset` puts its annotation first in source, so `→` visits the
  annotation before the base. Source order still matches left-to-right
  here, since both occupy the same x range.

**K7 Spaces in math.** Authors space their math for readability
(`v_i(A_i) \ge v_i(A_j)`), so `␣` in math must insert a source space
(R1), even though nothing visible changes. That is an accepted exception
to R7. Visible spacing in math is typed as a chip: `\` followed by space
is a control space, then there is `\quad`, `\,` and `\:`. The lecture uses
`1\ 2\ 3\ 4\dots n`.

**K8 Optional arguments that are rendered.**
- `\sqrt[n]{…}`: the root index is visible, so it is a slot, not a
  source-lens field. When a `\sqrt` is the focus, show a ghost placeholder
  where the index would go; typing into it creates `[…]` (see affordance
  V3).
- `\\[5pt]`: the spacing is not visible. It can be *typed* directly while
  the `\\` is still pending (K9), and otherwise it is edited through the
  lens.
- `\item[label]`: the label is visible, so it is a slot (description lists
  are already a Stage 4 item).

**K9 Brackets that TeX would read as optional arguments.** The probe below
confirms that `\item [0,1] interval` renders "0,1" as the item's label,
and `\\ [and variant]` is read as spacing. The protection must respect
intent (corrected after review):
- **While a command is being typed**, `[` means its optional argument.
  The chip `\\` followed by `[` gives `\\[‸]`, and `\sqrt` followed by
  `[` gives the index slot `\sqrt[‸]{}`.
- **When `[` is typed as content** next to an *existing* invocation (at
  the content start of an item, or right after a `\\` that was committed
  earlier), the canvas writes `{}` first: `\item {}[0,1] interval`.

An item label is created through its ghost slot (K8, V3), not by typing
`[`.

**K10 Vertical commands between paragraphs.** `\medskip`, `\bigskip`,
`\pause` and `\vspace{2\baselineskip}` sit on their own source lines
between paragraphs, about 40 times in the lecture. **Corrected after
review:** in LaTeX, `\medskip` does *not* end a paragraph. `latex.ltx`
defines it as `\vspace\medskipamount`, and `\vspace` in a paragraph adds
the space after the current line (via `\vadjust`) without splitting.
`\pause` mid-paragraph is also legitimate: the rest of the paragraph
appears on the next step.

**Decided:** typed mid-paragraph, these commands are inserted in place,
exactly as typed (R1), and rendered faithfully: space after the current
line, or a step boundary mid-paragraph. Making that render correctly is
engine work (in-paragraph `\vspace` via `\vadjust`). The earlier
"split the paragraph" decision rested on the wrong premise and is
withdrawn.

`\pause` is the important one: see V8 for making step boundaries visible.

**K11 Size declarations.** `\small` and `\scriptsize` change style until
the end of the group or environment. (The lecture also has `\small`
*inside* `align*`, but text-size commands are invalid in math mode, and
LaTeX warns. Treat it as an unsupported or ignored declaration there, not
as a math size region.) Under R8 they are style regions whose start is the
declaration and whose end is the closing brace or `\end`. The two stops at
the start differ in caret height. A font-size toolbar control writes
`{\small …}` around a selection and `\small` at the start of an empty
paragraph.

**K12 More style wrappers.** Add `\textsc{Partition}`, background colour
`\colorbox{orange!40}{100}` (the colour argument is lens-only, as for
`\textcolor`) and math alphabets `\mathbb{R}`, `\mathcal{A}` and
`\mathbf{x}`. Math alphabets are transparent too: `⌫` after ℝ deletes the
R, and the then-empty `\mathbb{}` is removed.

**K13 `tabular` cells.** These are alignment environments in *text* mode:
`&` separates cells and is not escaped (R2's alignment exception extends to
`tabular`), and `⇥`/`⇧⇥` move between cells. The lecture puts formatted
cells (`\colorbox`) and macros in cells; see
`design/beamer-table-fidelity.md` for the rendering side.

**K14 Macros defined between frames.** The lecture's `\newcommand`s appear
in the document body, between frames. Command completion must collect
definitions from the whole source, limited to those visible at the caret.

**K15 Environment creation.** `\begin{quote}`, `\begin{center}`, `block`,
`align*` and `array`. `\begin` committed through the chip asks for the
environment name, with completion, then inserts a matched
`\begin{…}`/`\end{…}` pair on their own lines with the caret inside
(R3). Required arguments such as a block title become slots. Column
specifications like `{ll}` and options like `[T,totalwidth=\textwidth]`
are lens-only. Completion offers only environments that are legal at the
caret. For example, `align*` is not offered inside `\[…\]` or inline math,
since nesting displays is an error. If the caret is inside a display, the
chip offers to *convert* the display instead (`\[…\]` → `align*`).

**K16 Sized delimiters.** `\bigl(`…`\bigr)` need not pair and are not
auto-paired. Only `\left`/`\right` are, because TeX requires them in
pairs.

## T — Temporarily invalid states

### What the engine does today (probe, 2026-10-08)

A frame with prose, `\ee`, `\textbf`, an `itemize` containing inline math,
and a display was rendered in 21 mid-typing states. Prose edits used the
session's structural mask, as the app does. Math edits had none, because
the app only masks prose runs. Results:

| State | Result |
| --- | --- |
| `\tex` (half command), lone `}`, `R&D`, `file_name`, `\begin{it`, `\\[`, `\ee{all` | **Local.** The fragment renders as literal text in place; everything else is unchanged. |
| `\textbf{bo` (unclosed), lone `{`, `$x` (unclosed in prose) | **Global.** The *whole chunk* falls back to literal source: the list loses its bullets and `\begin{itemize} \item …` appears on the slide. |
| Extra `$` inside a formula | **Global**, as above. Math edits are not masked. |
| `\frac{a}{`, `\frac{a` in a formula | The *formula* falls back to literal source `$v_i(A_i) \ge \frac{a v_i(O)$`. Confined to the formula, but the formula flashes into raw TeX. |
| `x^` with no script, unknown math command, `\left(` with no `\right` | Renders fine (tolerant). |
| Deleting the `}` of `\textbf{bold}` | Literal from `\textbf{` to the end of the text run; the list survives. |
| Deleting half of `\]` | The display becomes literal source; local. |
| `5%` | The comment swallows the rest of the source line, here a formula and text. TeX-correct, but silent content loss. |
| `\item [0,1] …` | "0,1" becomes the item label. TeX-correct gotcha. |
| Premature `\end{itemize}` | The list ends early, and the rest appears as literal `\item …`. |

Every state reported **zero diagnostics**, so the UI cannot tell
"recovered from invalid input" from "rendered normally". The unclosed
`\ee{` stays local while the unclosed `\textbf{` takes down the chunk,
which shows the fallback is not principled yet.

### Which states can the canvas itself produce?

Few, by construction:
- R3's auto-pairing means `{`, `$`, `\{` and `\begin` never leave an
  unclosed opener. (`\left(` does, on purpose, until its `\right` is
  typed: M14.)
- Invisible syntax is not an item (R7), so `⌫` cannot delete a lone `}` or
  half of `\]`.
- R2 escapes `%` and `&`, and K9's hygiene protects `[`.

What remains on the canvas (review notes added):
- The command chip mid-name (rendered as a chip, not as literal text).
- Empty slots, shown as placeholders. Empty *math* slots (`^{}`,
  `\frac{a}{}`) are valid TeX. Empty *semantic* arguments are not: a colour,
  a dimension or a URL. So the editor never writes such an argument
  empty. See "Placeholders vs semantic values" below.
- Committed unknown commands (red atoms). These are balanced but *not*
  valid TeX, and the frame thumbnail should flag them (T5).
- Semantic constraints that balance does not capture: surplus cells in
  fixed-column alignments (prevented by D2's `⇥` rule), and environments
  used in the wrong mode.
- Plan B (T7) "freeze with a live caret" needs a defined mapping from the
  changed source to the frozen geometry. Proposal: the caret is drawn at
  the frozen position of the nearest unchanged source offset before the
  edit, and the edited span is shown as a floating overlay at that
  point.

Invalid states mainly come from **outside the canvas input method**:
- the source lens (R13) and the source panel;
- pasting TeX (C2);
- documents that are already broken when the session opens;
- engine-unsupported but valid TeX.

So the policy below governs the lens and source editing more than canvas
typing. Even so, the canvas must stay calm while the user types in the
lens next to it.

### Policy

- **T1 Damage stays inside the focus.** An invalid edit may only change
  the rendering of the innermost construct around the edit: the text run,
  slot or formula. Siblings and ancestors keep their baseline structure.
  This extends the existing mask principle ("the canvas must never visibly
  restructure content the user is not editing") from the structure parser
  to the text engine: the edited run is scanned with its own bracket
  context, closed at the run's end, and cannot leak into the rest of the
  chunk.
- **T2 Close virtually, and show where.** An unclosed opener is closed
  where the run, slot or line ends. This mirrors TeX's own recovery, which
  inserts the missing `$` at the end of the paragraph. The closer is drawn
  as a faint ghost glyph (`}` or `$`) at that point, so `\textbf{bo`
  renders as bold "bo" plus a ghost `}`, not as raw source. A stray closer
  renders as a red literal glyph in place, as today.
- **T3 Partial math renders as math.** `\frac{a}{` renders as a fraction
  with an empty denominator placeholder, not as raw `$…$` source. A
  half-typed command inside math renders as a red chip.
- **T4 No silent swallowing.** When a comment starts mid-line (only
  possible through the lens), the commented-out remainder of the line is
  drawn struck-through and faint at its old position until the session
  ends. That way the user sees what `%` just did.
- **T5 Recovery is reported.** The engine emits a "recovered" diagnostic
  for each virtual closer or literal fallback, with its source position.
  The UI uses it for the ghosts (T2), a small warning badge on the frame
  thumbnail, and T6.
- **T6 A quick fix when the session ends.** If the scope is still invalid
  when the session ends (Esc, clicking away), a pill offers "Insert missing
  `}`", which makes the virtual closer real. It never auto-fixes
  silently.
- **T7 Stable layout around the edit.** Keep the existing stable-layout
  and latency guarantees. If T1 cannot be met for a construct, the agreed
  plan B applies: freeze that construct's last valid render with a live
  caret, rather than restructuring.

Test plan: turn the probe into a regression suite, with typing prefixes
of the KKT and editing-corpus frames. Assert that topology outside the
focus is identical and that the diagnostics report recovery. The
adversarial fuzzer's "typing-prefix" generator
(`design/tex-text-adversarial-fuzzing.md`) is the scaled-up version.

## V — Visual affordances

Ways to make the interpretation of a keystroke visible, and to reach
options that are awkward today.

- **V1 Pills only for guesses, never for rules** (revised 2026-10-08). An
  iOS-style reject pill after every transformation would be noise: `$`
  gets typed hundreds of times, and a pill suggesting currency each time
  would be absurd. So:
  - **Deterministic rules never show a pill.** This covers `$` → math,
    `%` → `\%`, structure from a chip commit, terminators, Unicode →
    command and smart quotes. They are the input method,
    not guesses. `⌘Z` immediately afterwards still reverts silently (R12).
  - **A hint appears only after regret.** If the user immediately deletes
    what a rule just produced (for example `$` then `⌫`), the hint line
    (V7) shows how to get the alternative: "literal $: type \$". This
    happens once, in the status bar, and never floats over the slide.
  - **Floating pills only for real guesses with a plausible
    alternative:** "Paste as TeX" after pasting TeX-looking text (C2), and
    "keep `- `" after list autoformat (P10), if that ships.
- **V2 Ghost completion in the command chip.** `\setm` shows `inus` in
  ghost text, with a preview of ∖ in a small popover listing the other
  candidates. `⇥` accepts. Environment names after `\begin` work the same
  way, as do preamble macros, previewed with their rendering.
- **V3 Ghost slots.** Empty slots are dotted placeholder boxes (Word,
  TeXmacs, MathQuill). When a construct is the focus, *optional* rendered
  slots that are absent also show as faint ghost boxes: the root index of
  `\sqrt`, a missing superscript or subscript, an item label in
  `description`. Clicking or typing into one creates it. This makes
  optional arguments discoverable without menus.
- **V4 Focus tag as a handle.** The small tag on the focus outline
  (`textbf`, `sub`, `ee`, `align*`) opens a menu when clicked:
  - **variants**: textbf ↔ textit ↔ emph ↔ ee; `\le` ↔ `\leq` ↔
    `\leqslant`; inline ↔ display; itemize ↔ enumerate; block ↔ alertblock
    (TeXmacs's Ctrl+Tab structured variants);
  - **Unwrap**;
  - **Select**;
  - **Edit source** (the lens).

  It is the discoverable home for everything that has a key shortcut.
- **V5 Hover reveals source.** Hovering over a symbol, atom or style run
  for about 0.5 s shows a tooltip with its source (`\setminus`, or `\R` →
  `\mathbb{R}`). This teaches command names without the bar.
- **V6 Local reveal codes.** When the caret sits next to an invisible
  token (`% comment`, `\label`, `\pause`, `\medskip`), a small gray marker
  appears at that spot, Word-pilcrow style, without the global R14 toggle.
  Hovering over it shows the token, and clicking selects it.
- **V7 Hint line.** A short context hint in the status bar, like TeXmacs's
  footer: "superscript · → to leave", "command · ⇥ accept · esc cancel",
  "selection extended to whole formula". The hint for a situation stops
  appearing after it has been seen a few times. The breadcrumb (V11) never
  goes away.
- **V8 Overlay step markers.** In edit mode, `\pause` and `\only`/`<2->`
  content get small step badges in the left margin (`2`, `3+`). Content
  hidden on the current step can be shown ghosted on request. Typing at a
  step boundary then has a visible meaning (R11).
- **V9 Snap feedback.** When a selection snaps outward to a whole formula
  or construct (R9, N3), the construct's outline briefly flashes.
- **V10 Recovery ghosts.** Faint ghost closers, struck-through swallowed
  text and the end-of-session quick-fix pill (T2, T4, T6).
- **V11 Context breadcrumb** (added after review). The status bar always
  shows the caret's full context path, e.g. `frame › itemize › item ›
  math › sub`, or `… › textbf › ee` for nested wrappers. It is the
  accessible, always-legible counterpart to outlines and caret shape. Those
  are fragile at slide zoom, in tiny scripts, and with nested identical
  wrappers or runs that span several lines. Each crumb is clickable and
  selects that construct. This is the same path TeXmacs shows.
- **Caret legibility** (refines R8). The caret itself stays high-contrast
  and is never drawn in the text colour, because red text would hide a red
  caret. Style shows as *additions*: slant, a second stroke, and a small
  coloured serif or underline swatch in the text colour. In scripts below
  a minimum on-screen size, the caret keeps a legible minimum height and
  relies on the outline and the breadcrumb.

## Z — Gaps raised in review (2026-10-08)

Scenarios that Codex's review found missing, each with a first proposal.

**Z1 `⏎` mid-construct.**
- `$a‸+b$` · `⏎`: split the formula at the caret into `$a$` and `$+b$`,
  with the structural `⏎` between them, but only if both halves are valid
  on their own. Otherwise leave the formula and act at its end
  (**decided** 2026-10-08).
- `\frac{a‸+b}{c}` · `⏎`: does nothing (and the hint line explains).
- `\frac{a‸+b}{c}` · `⇥`: next slot, as usual.
- `\textbf{one‸ two}` · `⏎` (paragraph split): the wrapper is split
  across the break, `\textbf{one}` blank line `\textbf{ two}`, so both
  halves stay balanced. A style wrapper split by a structural key always
  closes before the split and reopens after it.

**Z2 IME and dead keys.** These follow R17. Test cases:
- French `^` + `e` → `ê`.
- Japanese IME candidate selection inside `\text{}`.
- `⏎` committing a candidate must not trigger the structural `⏎`.
- macOS long-press accent menu.

**Z3 Clipboard across contexts.** These follow R15.
- Copy `\lambda_i` inside math, paste into prose → `$\lambda_i$`.
- Paste multi-line text into a numerator → the newlines become spaces.
- Cut across a comment or a hidden overlay: the cut removes the hidden
  material too, and the hint line says so, because the user could not see
  it.
- Paste into another document whose preamble lacks a used macro: the
  source is pasted, the macro renders red, and the hint line names it.

**Z4 Overlays.**
- Adding an item under `\begin{itemize}[<+->]` shifts every later item's
  step, and the step badges (V8) must update live.
- Typing inside `\alt<2>{a}{b}`: which branch is editable depends on the
  step being shown.
- Moving between steps during a session keeps the session open; the caret
  stays at its source offset if that offset is visible on the new step,
  and is clamped to the nearest visible one otherwise.

**Z5 Repeated edits.** There is no multi-cursor. Find & replace works on
source and is scoped to the frame or the deck. Applying a style to several
disjoint terms is repeated select + `⌘I`. Editing macro output that
duplicates an argument goes through the lens (K1 classifies such macros as
atoms).

**Z6 Undo across boundaries.** See R12's granularity notes: undo after the
session ended, after automatic empty-wrapper removal, and after changing
slides.

## O — Precedence and ownership (after the second review)

Proposals answering the second review, which found that several rules give
different outcomes for the same edit when constructs nest. Unless marked
**decided**, these are proposed defaults.

**O1 Who owns `⏎`.** Walk outward from the caret to the nearest context
that defines `⏎`:
1. An alignment row (`align*`, `array`, `tabular`): new row.
2. A display (`\[…\]`): leave below.
3. The top level of an inline formula: split per Z1, or act at the
   formula's end.
4. Prose (paragraph or item): the structural `⏎`.

Two contexts stop the walk, and `⏎` then does nothing except show a
hint:
- any math *slot* (fraction part, script, root body, `\left…\right`
  body);
- any `\text{…}` inside math.

Examples:
- `$a+\frac{b‸+c}{d}$`: nothing.
- `$\text{one $a‸+b$ two}$`: nothing, because the inner formula's nearest
  owner is the `\text`, which stops the walk.
- `\textbf{one‸ two}` in an item: the style wrapper is transparent, so the
  item splits and the wrapper is split across the break (Z1).

`⇥` and `&` follow the same walk: they act on the nearest slot sequence or
alignment.

**O2 Backspace precedence.** Rules are tried in this order, and the first
that applies wins:
1. A non-empty selection: delete it (range rules, R9).
2. The whole construct around the caret is empty (`\frac{‸}{}`): delete
   the construct.
3. The caret is in an empty slot that can be removed (an optional argument,
   a script): remove the slot.
4. At the start of a later slot (`\frac{a}{‸}`, `\frac{a}{‸b}`): move to
   the end of the previous slot. The mandatory empty denominator stays.
5. At the start of a first or only slot: step out (R9).
6. Otherwise, act on the actual preceding item, looking through style
   wrappers: a character or atom is deleted, and a content construct is
   selected first.

**O3 Scripts belong to their base** (**decided** 2026-10-08). In `$ax^2‸$`, `⌫` deletes
the "2", since it is the visually last single character, by the
one-visible-character principle. The now-empty script is removed, giving
`$ax‸$`. So for deletion, scripts are transparent like style wrappers. A
fraction or root still selects first. Deleting a *base* that has scripts
(`⌦` at `$a‸x^2$`) first selects the whole scripted atom `x^2`. That way
the scripts never silently re-attach to `a`.

**O4 Lifetime of a pending command.** A command committed through the chip
stays *pending* until the next keystroke. Only the very next keystroke may
open its optional argument (`[`) or step into its first argument (`{`):
`\\[5pt]` typed in one go gives spacing. Any navigation, click, focus
change, composition commit or other character ends the pending state.
Typing `\\`, moving away and back, then `[` gives protected content
`\\{}[`. The state is visible: while it is pending, the chip's outline
stays on the command.

**O5 Replacing generated delimiters and keeping single glyphs.**
- Auto-paired *visible* closers are ordinary items. `⌦` before an
  auto-inserted `\}` deletes it, so `$\{x$` is reachable.
- `\left`/`\right` must pair (TeX requires it), so the closer is never
  deleted alone. Typing `\right` plus a delimiter at the generated
  `\right]` *replaces* it, which makes `$\left[0,1\right)$` reachable. The
  focus-tag menu offers the delimiter variants too.

**O6 Paste conversion by destination.** This replaces the context rule in
R15 with a table:

| Destination | Outside plain text | Canvas copy of a formula fragment (`x`) | Canvas copy of a whole formula (`$x$`) |
| --- | --- | --- | --- |
| Prose | All specials escaped | Wrapped in `$…$` | As is |
| Math | Characters as math; `%`, `#`, `$`, `&`, `{`, `}`, `\` escaped; spaces kept as source spaces (TeX ignores them, the same as typing) | As is | `$` delimiters dropped |
| `\text{}` in math | As prose | Wrapped in `$…$` | As is |
| Verbatim slot (`\url`) | Raw, nothing escaped; line breaks dropped | Its source text | Its source text |

"Paste as TeX" overrides all of these.

**O7 Undo restores source and selection, not editing state.** Undo and
redo restore the source and selection only. Every brace then counts as
authored, because R6's provenance resets. A chip is never reopened, and no
pending command (O4) survives. Example: entering `$x^2$`'s script, typing
`3` (→ `x^{23}`), then undo and redo, then deleting `3` leaves `x^{2}`. This
is slightly less tidy, but deterministic and consistent with "the source
alone determines interpretation". Today's history entries (text plus two
offsets) suffice for this contract.

**O8 Placeholders vs semantic values.** Commands whose arguments need a
value from a closed or typed domain (colours, dimensions, URLs) never write
that argument empty. `\textcolor` around a selection first opens the
colour picker, and the source is written when a colour is chosen. `Esc`
cancels without touching the source. This replaces R10's
`\textcolor{‸}{risk}` example. Empty *math* slots stay as written, since
they are valid TeX. If a session ends with an empty required non-math
argument (possible only through the lens), T6's quick-fix pill names it.

## If the bar goes away

What the bar currently does, and what replaces it on the canvas:

| Bar role | Canvas replacement |
| --- | --- |
| Which side of a brace the caret is on | Outlines around the enclosing constructs; caret size in scripts; caret shape for bold, italic, colour and math (R8) |
| Watching half-typed commands | Command chip with completion (R4) |
| Editing things with no rendered handle (optional arguments, overlay specs, colour arguments, comments) | Source lens `⌘E` (R13), inspectors |
| Seeing invisible syntax | Reveal codes (R14) |
| Recovering a scope that no longer parses | Source lens over the whole failing scope, opened automatically |

## Engine and app needs (rough)

- **Math slot tree** with source spans per slot and per atom. The math IR and
  caret map already carry spans and roles (`construct-boundary`,
  `group-boundary`); stops become (slot, index) instead of every source
  offset. Glyph entries must stop spreading their stops across a command's
  source span (`inline-provider.ts:addMathItemCaretMapEntries`).
- **2D stops**: x, y and caret height per stop, not x per row.
- **Content-construct spans** for the outline: math islands and slots,
  `\text`, `\url`, macro argument slots.
- **Macro atoms limited to the invocation** inside math (X4).
- **Session state** for the chip, pending style, and which braces the editor
  created (R6). Today's literal-run rendering of a half-typed command is
  replaced by the chip overlay.
- **Completion sources**: `math/symbol-definitions.ts`, text-mode commands,
  and preamble `\newcommand` with arity.
- **Semantic caret identity (prerequisite).** Every stop carries its slot
  identity, ancestry (for outlines, breadcrumb and R8's two stops) and 2D
  geometry. Clicks, arrows and selections all resolve through it. Today's
  domain (`caret-stops.ts`) is unique source offsets plus row geometry,
  with macro invocations collapsed wholesale. The math caret map already
  has the 2D geometry. This is more than filtering existing stops.
- **Run isolation in the text engine** (T1): scan the edited run with its
  own bracket context and close it virtually at the run's end, instead of
  falling back to literal source for the whole chunk. Plus **recovery
  diagnostics** (T5) and partial-math rendering with placeholders (T3).
- **Macro classification** (K1) from `\newcommand` bodies: symbol, style
  wrapper, slot macro, or atom.
- **Context classifier** at the caret: prose / math / math-text / verbatim /
  alignment. It drives R2, R6 and `⌘B` meaning.

## Open decisions (collected ⚖)

Decided 2026-10-08, beyond the list at the top:
- `⌘B` mid-word bolds the word (F3).
- `⏎` in inline math leaves the formula and acts there (M18).
- `$$` becomes a `\[…\]` display (D1).
- `⇥` goes to the next slot or cell; variants live in the focus-tag menu
  (D2, V4).
- Pasting is literal, with a "Paste as TeX" pill (C2).
- `^` in prose is a literal circumflex (K5).
- Vertical commands typed mid-paragraph are inserted in place and do not
  split it (K10, corrected after review: LaTeX's `\medskip` uses
  `\vadjust` and does not end the paragraph).
- No `⌘B`/`⌘I` in math (M17).
- `⌘Z` after a transformation reverts it only where the literal state is
  valid source (R12).
- Pills only for guesses (V1).
- `⏎` in the middle of an inline formula splits it if both halves are
  valid, otherwise acts at the formula's end (Z1).
- User macros are classified automatically from their definitions, with no
  overrides (K1).
- No built-in support for individual user macros; instead a frequent-styles
  list (K1).

Still open:

1. **Unicode math symbols typed in prose (M16)**: deferred. Lean:
   follow the engine the document declares.

Also settled: P10 list autoformat will be tried, itemize only and
conservatively; P3 quotes follow the document's convention, with no
csquotes support.
