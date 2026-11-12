# Overlays in pictures: rules in the TikZ AST, and showing hidden content

Status: design, 2026-11-12, revised the same day after two reviews (an
independent reading of the code with TeX experiments, and a reading of the
DeckCraft and LibreOffice Impress sources). Nothing implemented yet.

Linked changes, in the order they should be built:

1. **Opening a slide** shows its last step, and the step control becomes
   easy to see. A build-up slide then never opens looking empty.
2. **Overlay rules inside TikZ pictures** become part of the TikZ AST and are
   applied by the evaluator, replacing the text pre-pass that blanks them
   before parsing. This fixes real bugs and makes shapes first-class in the
   Overlays panel.
3. **Step tags** on objects with a rule, on hover and while the Overlays
   panel is open.

Ghosts (drawing hidden content faded) were considered and are not planned;
the section is kept as a record.

## Built so far

Phase 1 (2026-11-12): slides open on their last step; the step strip.

Phase 2, first part (2026-11-12):

- **Grammar and AST.** `<spec>` on path commands; `\only`, `\uncover`,
  `\visible`, `\invisible`, `\alt`, `\temporal` and `\onslide<spec>{…}`
  around statements; `\onslide` and `\pause` declarations. Command names
  match as whole words.
- **A flat representation, not a container.** An overlay command's braces
  delimit an argument, not a TeX group, so its statements stay siblings in
  the enclosing body. The command is a head statement (`OverlayGroup`);
  each statement of its bodies names it in `overlayGroups`. No code that
  walks scopes had to learn a new container.
- **Evaluator.** `overlayVisibility(span)` says, per statement, visible,
  hidden or removed. A removed statement is skipped whole; a hidden one is
  evaluated and its elements carry `overlayCovered`. Element ids are the
  same on every step.
- **One function for a picture on a step** (`beamerTikzStep`), used by the
  slide renderer and both edit snapshots (slide picture, drawing layer).
  The frame decoder still decides visibility; the evaluator asks it by
  source span.
- **Text inside a statement is still projected.** Overlay commands in node
  text or option values (`\node {\only<2>{x}}`) are resolved as text, as
  in the slide's own text, since the TeX text engine does not read them.
  Only statement-level commands moved to the AST.
- `<spec>` after a path command is now seen in a `tikzlayer`, and after
  `\pattern` and `\useasboundingbox`.
- **Checked** on every fixture frame with overlay syntax in a picture, on
  every step: the scene equals what blanking the source drew
  (`test/beamer-tikz-overlay-step.spec.ts`), and the test fails when
  visibility is broken on purpose.

Phase 2, completed (2026-11-12):

- **A trace per picture** (`beamer/tikz-overlay-trace.ts`): the picture is
  parsed, its loops and its own macros expanded, and every statement-level
  overlay operation is listed in execution order: path specifications,
  brace commands, `\onslide` and `\pause`. A loop performs an operation
  once per iteration, each its own instance. The frame decoder resolves the
  trace with the frame's counter and no longer scans a picture's
  statement-level commands itself; what it still scans in a picture is text
  inside a statement.
- **One rule for `\pause` and `\onslide` in a picture**
  (`beamerOverlayDeclarationInForce`): of those performed before a
  statement and still within their scope or picture, the latest holds. It
  also holds over a declaration in the text before the picture, which
  resumes after it. A loop's declaration holds on after the loop unless its
  scope lies inside the loop's body.
- **The evaluator asks for every statement that draws**, also inside a scope
  a loop makes, which is evaluated whole.
- **Edit actions** evaluate a slide picture as its snapshot's step shows it.
  The drawing layer's cached evaluation is keyed by what the step hides,
  each loop iteration answering for itself.
- A specification after a shorthand's options (`\draw[red]<2>`) is refused
  with a diagnostic, as PGF gives up on it; `\path[opts]<spec>` is read.
- Every case above is asserted against pages LuaLaTeX set
  (`test/beamer-tikz-overlay-step.spec.ts`).

Phase 3 (2026-11-12):

- **A shape's rule** (`beamerStatementOverlayTarget`): its own `<spec>`,
  set straight after the command's name, changed in place or removed; or
  the shared rule it stands under, which is offered and not retimed.
- **Inspector.** An Overlay section with a Steps field for a shape selected
  in a slide picture or drawing layer; empty means every step.
- **Canvas menu.** The Overlays submenu for a shape, with the slide menu's
  items.
- **Overlays panel.** Rows are named by what they draw ("Node · Alpha",
  "Shapes · Alpha, Top"). A selected row points at the shape on the slide
  and selects it inside the picture. The panel works while a picture is
  edited on its own.
- **Stepping inside a picture.** The step strip shows there and follows the
  slide's step.
- **Step tags.** On every rule's object while the Overlays panel is shown;
  otherwise on the object the pointer rests on.

Edit guard (2026-11-12):

- An edit to a slide picture's structure (reorder, group, paste, duplicate,
  delete) is refused, with the shape named, when it would change the steps
  of a statement it left as written (`beamer/picture-step-guard.ts`).
  Edits within a statement (move, resize, properties, text) are not
  checked: they cannot do that.

Known gaps:

- **Overlay commands in node text inside a loop** are counted once, at
  their place in the source, after the loop's own operations.
- **A comment between a command and its specification** (`\node % c` then
  `<2>` on the next line) is a syntax error here; TeX accepts it.
- **Inline `\tikz` pictures** get no rules (as before this work).
- **Macros defined before the picture** that write a specification are not
  expanded for the trace; the picture's own are.
- **A Beamer quirk not followed:** after a `\pause` inside a picture, TeX
  shows the text after a later frame-level `\pause` one step early.
- The edit guard matches statements by their text; loops are not compared.
- `projectBeamerTikzSource` stays for text inside statements.

## Decided

- Navigator thumbnails show the last step. (They already do:
  `packages/app/src/ui/workers/thumbnail-render.worker.ts`, "final overlay
  step (handout view)".)
- No interim fix on the current projection; phase 2 replaces it.
- A slide opens on its last step, or on the step last looked at. That memory
  is for the session only and is not saved across restarts.
- No ghosts; they risk confusing more than they explain.
- Step tags both on hover and while the Overlays panel is open.

## What other editors do

From source (DeckCraft, a PowerPoint re-implementation; LibreOffice Impress):

- The editing view draws every object fully, whatever its animations. There
  is no ghosting and no "slide at step N" view; the build is only seen by
  running a preview.
- Neither draws step badges on objects. Impress draws only motion paths,
  while its animation pane is open. (PowerPoint itself shows numbered tags
  while the Animations tab is active; from memory, not from these sources.)
- Thumbnails show the slide at rest with all objects, plus a small icon for
  slides with animations.
- The link between the build list and the slide is selection: selecting a
  row selects the object, and the reverse.

These tools can show everything at once because an object exists once, at a
fixed place. Beamer cannot in general: `\only` removes content and the rest
reflows, so steps can be different slides. The nearest truthful equivalent
of "the slide at rest" is the last step.

## Today

- **One decoder per frame.** `scanBeamerFrameOverlays`
  (`packages/core/src/beamer/overlay.ts`) reads the frame in source order and
  resolves every specification against the counter `\pause` uses. The
  renderer and the Overlays panel (`beamer/builds.ts`) read its model. It is
  built for every frame when a deck is prepared (`render.ts`,
  `overlaysByFrameId`), because it gives the step count.
- **Two kinds of hiding.** Covered content (`\uncover`, `\visible`,
  `\onslide`, `\pause`) keeps its space. Removed content (`\only`, `\alt`,
  `overprint`) is absent and the rest reflows.
- **Pictures use two mechanisms.**
  - Removed statements, and all overlay syntax, are blanked with spaces
    before the TikZ parser runs (`projectBeamerTikzSource`). The decoder finds
    `\node<spec>` and the like with its own scanner: a command list and a
    search for the semicolon that counts brackets (`tikzStatementEnd`).
  - Covered elements are evaluated and dropped from paint by source span
    (`beamerTikzPaintModel`). Pictures in the text flow keep them as
    `coveredModel`, which nothing in the app reads; overlay pictures and the
    drawing layer drop them (`render.ts`, `overlay.elements`).
- **The TikZ parser knows no overlay syntax.** Without the pre-pass,
  `\node<2-> …;` is a syntax error, `\pause` silently swallows the next
  statement, and `\uncover<2->{…}` loses everything after it.
- **Element ids differ between steps.** Ids are statement indices; blanking
  a removed statement shifts the ones after it.
- **Step control.** A small `2 / 5` stepper on the canvas; a slide opens on
  step 1 or the step last chosen for it.

### TeX and PGF facts

Verified by compiling with LuaLaTeX (reviewer's files) or in
`pgf-src/.../tikz.code.tex` (lines 1959–1976, 2071–2087):

- `\path<spec>` is `\alt<spec>{\path …;}{}`: removed on other steps, not
  covered. The statement is delimited by the next `;` outside braces.
- The spec comes straight after the command name: `\node<2->[red]`,
  `\draw<2->[red]`. `\path[opts]<spec>` is also accepted. `\node[opts]<spec>`
  and `\draw[red]<2->` are not. There is no `<spec>` on a `node` inside a
  path.
- A removed `\node<2->(a)` leaves `(a)` undefined on step 1. Node names are
  global in PGF, so a name defined on step 1 by a shape removed on step 2 is
  still found on step 2, at its old place.
- A covered shape counts towards the picture's bounding box; a removed one
  does not. A centred picture with removed shapes therefore moves on the
  page between steps.
- `\pause` and `\onslide<spec>` inside a picture cover to the end of the
  enclosing PGF scope or picture. A brace group or a `\foreach` iteration
  does not end the cover. Text after the picture is not covered. The counter
  is still the frame's.
- `\foreach \x in {1,2,3} {\node<\x-> …;}` gives one specification per
  iteration (three steps). A `\pause` in a loop body counts once per
  iteration.
- Relative specifications in a picture advance the frame's counter in source
  order with the text around it (`\item<+->`, `\node<+->`, `\item<+->` take
  steps 1, 2, 3).
- With `\setbeamercovered{transparent}`, covered picture content is drawn
  faded; a removed `\node<2->` is absent.

### Real decks

`artifacts/beamer-sources` (11 authors, 658 pictures by 8 of them), overlay
syntax inside a picture:

- `<spec>` after a path command: none. Nor the `overlay-beamer-styles` keys,
  relative specifications, or specifications with a macro or loop variable.
- `\pause`: 6 pictures, one author; all have content after the picture, so
  all are drawn wrongly today (problem 3).
- `\onslide<spec>{…}` around statements: 4 pictures, one author.
- `\only<spec>{…}` around statements: 1 picture, one author.

Eleven pictures by three authors is a small sample. It says the brace and
declaration forms matter at least as much as `\node<spec>`, and gives no
reason to rank loop specifications high.

## Problems

1. **A build-up slide opens looking empty**, and the stepper is easy to miss.
2. **Rules in a slide's pictures are wrong outside the slide renderer.**
   - The edit snapshot of a slide picture, the drawing-layer snapshot and the
     edit actions parse the raw picture (`packages/app/src/compute.ts`), so
     overlay syntax there drops or corrupts statements, and the step is
     ignored.
   - `<spec>` after a path command is not seen in a `tikzlayer`: the decoder
     looks for those in `tikzpicture` only. (`\only` and `\uncover` there
     work.) Nor after `\pattern` or `\useasboundingbox`.
3. **`\pause` and `\onslide` in a picture run too far.** The decoder extends
   them to the next declaration or the end of the frame, so text after the
   picture is hidden on step 1 where TeX shows it.
4. **Rules that exist only after expansion are missed.** `\node<\x->` in a
   `\foreach`, a standard way to build a diagram, gives one step with
   everything drawn; a `\pause` in a loop is counted once.
5. **Three readers of one syntax**: the decoder's scanner (counts brackets),
   TeX (braces only), and the TikZ parser.
6. **Shapes are invisible to the Overlays panel.** A `\node<2->` gets a row
   labelled as text, with no highlight on the canvas, and a shape has no
   Overlays menu. Nothing links a rule to a scene element.

## Opening a slide

- Selecting a slide shows its **last step**: what the thumbnail shows, and
  what PowerPoint users expect of an editing view. A slide looked at before
  in this session reopens on the step it was left on.
- The `2 / 5` counter becomes a strip of numbered step buttons in the same
  place, the current one marked; long builds page as the Overlays timeline
  does.
- The canvas still shows one concrete step at a time.

## Overlay rules in pictures

### AST

- A path statement gains `overlay?: { span, contentSpan }`, read where PGF
  reads it: straight after `\path`, `\draw` and the other shorthands
  (including `\pattern` and `\useasboundingbox`), `\node`, `\pic`,
  `\coordinate`, `\matrix`, and after `\path`'s first option list.
- New statement nodes for Beamer's commands at statement level:
  - a group: `\only`, `\uncover`, `\visible`, `\invisible`, `\alt`,
    `\temporal`, and `\onslide<spec>{…}` (the form real decks use most),
    with `<spec>` and one to three brace bodies of statements;
  - a declaration: `\onslide<spec>` (with `*` and `+`) and `\pause[n]`. It has
    no semicolon and no body; its extent is the rest of the enclosing scope
    or picture.
- The parser stores the specification's text and spans and does not resolve
  it. Outside a deck these parse the same and get a diagnostic.
- Element ids count every statement, removed or not, so an element has the
  same id on every step.
- Writers print the overlay part of a statement they rewrite.

`<` after a command name is context-dependent in the grammar and probably
needs an external tokenizer. The incremental parser gains a container
statement and a statement without a semicolon.

### Resolution: an overlay trace per picture

A picture's rules cannot be read off its source spans: loops and macros
create them. Each picture therefore yields an **overlay trace**: its overlay
operations in execution order, from the same expansion of loops and macros
the evaluator uses, with all branches walked.

- An operation is a specification or a declaration, with its kind, its text
  after substitution (`<2->` for `<\x->` on the second iteration), and a key
  for the instance: source span plus iteration path.
- A declaration's entry also carries where its extent ends (the end of its
  scope or picture).
- The frame decoder stays the one place that resolves. It splices each
  picture's trace into the frame's sequence at the picture's position, so
  `+` specifications and pauses count across text and pictures as in TeX.
  Its result per instance is the resolved intervals, as today.
- The decoder's own scanner for pictures (`tikzStatementEnd`, the command
  list, the `tikzpicture` test) is removed. A `\pause` in a picture ends with
  its scope.

Cost: the decoder runs for every frame when a deck is prepared. A trace is
needed only for pictures whose text contains `<`, `\pause` or `\onslide`
(a text test), and is cached by the picture's source.

### Evaluation

The evaluator takes the resolved table for the step, keyed by instance:
visible, covered or removed, and for `\alt` and `\temporal` the branch.

- **Removed**: the statements are skipped whole: no geometry, no bounding
  box, no state.
- **Covered**: evaluated in full (names, bounding box, state), marked covered
  on the scene element, not painted.
- **Names of removed shapes** are not defined on that step. TeX would still
  find a name left over from an earlier step; we report the reference as
  unknown instead. This is a deliberate difference: such a picture depends
  on the order slides were built in.
- **Every scene element** carries the chain of rule instances that govern
  it, innermost first.
- A picture whose bounding box differs between steps gets a diagnostic: it
  moves on the page, a common Beamer complaint.

### One pipeline

The slide renderer, both edit snapshots (slide picture and drawing layer)
and the edit actions parse the real source and evaluate with the same table.
`projectBeamerTikzSource` and `beamerTikzPaintModel` are removed.

### Edits

Keeping the rule's text is not enough: moving a statement past a `\pause` or
`\onslide`, or reordering `+` specifications, changes steps without touching
a rule. Requirement: an edit action leaves the effective steps of every
shape it did not target unchanged. Reorder, group, ungroup, paste and
duplicate either meet it or are refused where a declaration or relative
specification makes it impossible.

### What this enables

- **Overlays panel**: rows for shapes are labelled by the shape and select it
  on the canvas; selecting a shape selects its row. A loop's rule is one row
  for the loop.
- **Canvas menu and inspector**: the Overlays submenu and a Steps field for a
  selected shape. A new rule is written as `<spec>` after the command name.
- **Slide images** (`design/slide-image-placement.md`): `\node<2->` in the
  drawing layer works.

## Ghosts (not planned)

Decided against: faded content can be mistaken for output or for something
selectable. Kept as the record of what it would take.

With slides opening on their last step, ghosts are no longer needed to make
a slide readable. They remain useful while working on an earlier step, to
see what is coming. They are the least certain part of this design.

| Hidden content | Ghost |
|---|---|
| Covered text, blocks, images, whole pictures | Yes, at its place: TeX reserves exactly that space |
| Covered shapes in a picture | Yes |
| Removed shapes in a picture | Yes, in the picture's coordinates on this step |
| Inactive `\alt` and `\temporal` branches | No: they would sit on the live branch |
| Removed text and images, `overprint` | No: they have no place on this step |

Rules:

- **Editor only.** Export, thumbnails and presentation never contain ghosts.
- **Not mistakable for output.** `\setbeamercovered{transparent}` really
  prints covered content faded, and today the editor draws it as invisible.
  The channel that paints covered content implements `transparent` as real
  paint first; ghosts then use a different treatment (a grey tint, not plain
  opacity) and are not drawn over content that is really painted faded.
- **A removed shape's ghost** comes from an evaluation in which it is
  visible, placed in this step's picture frame. It can lie outside this
  step's bounding box. A shape's geometry depends only on the statements
  before it, so for the usual `<k->` build the last step's evaluation serves
  every ghost; otherwise the shape's first visible step does.
- **Hit testing.** Ghosts are hit on their ink only, below all live content,
  and are not snap targets, so marquee selection and click-to-deselect still
  work on a slide that is mostly ghost.
- **Clicking.** A ghost selects its content in place, read-only, and offers
  "Go to Step n". It does not jump: a jump reflows text under the pointer.
  Editing covered content in place is a later question (which side of a
  `\pause` a typed character lands on).
- **No badge on a ghost.** Its step is a tooltip.
- View → Show Hidden Overlay Content turns ghosts off.

Not all the geometry exists today: hidden text glyphs are laid out, but
hidden top-level images and items inside blocks are skipped before paint
(`render.ts`), and overlay pictures drop covered elements.

## Step tags and markers

A step tag is a small label with the object's steps ("2–", "3").

- **While the Overlays panel is open**: on every object with a rule of its
  own that is drawn on the current step.
- **On hover**, with the panel closed too: on the object under the pointer.
  Only on slides with more than one step, only with the select tool, not
  during a drag or while editing text, and after the usual tooltip delay.
- The selected object's steps are in the inspector.
- **Removed text** (recommended, not yet decided): no standing marker, since it would claim a place that
  does not exist. Selecting its row in the Overlays panel shows where it
  would be inserted, as a thin accent line, as part of selection
  highlighting.

## Earlier decisions this changes

- `design/beamer-editor.md` (Overlays, UI): a slide opens on its last step,
  not the first. "One concrete step, no all-steps view" stands. The overlay
  badge on selected elements becomes the inspector field.
- `design/beamer-canvas-editing.md`: covered pictures were deliberately
  unselectable, and ghost pictures not clickable. Ghosts change that.
- `design/beamer-builds.md`: "hidden content has no synthetic canvas box"
  holds for removed text and no longer for covered content.

## Phases

1. **Open on the last step; step strip.** Small, app only. Step tags for
   text-flow objects (blocks, items, images, whole pictures) can follow
   here, since their rules and geometry exist.
2. **AST, trace and evaluator.** Large and the riskiest part: the grammar,
   AST and ids, the incremental parser, loop and macro expansion, the
   evaluator and its incremental cache keys, the decoder, `builds.ts`, both
   snapshot paths in `compute.ts`, statement parsing in the edit actions,
   and the writers. Fixes problems 2 to 5.
3. **Shapes as overlay objects.** Panel rows and selection, canvas menu,
   inspector field, step tags. Fixes problem 6.
4. **`\setbeamercovered{transparent}`** as real output. Independent of the
   rest.

## Verification

- **TeX regressions** for each fact above: scope-bounded `\pause`, loop
  specifications and pauses, names of removed shapes, bounding box and page
  shift, relative specifications across text and pictures.
- **Old against new, with an allowlist.** For every fixture frame with
  overlay syntax in a picture and every step, the new scene equals the
  projection's, except for listed, intended differences (`\pause` extent,
  loops), each checked against TeX. The projection is deleted after this.
- **Ids**: an element has the same id on every step.
- **Edit snapshot equals render** on every step, for `tikzpicture` and
  `tikzlayer`.
- **Effective steps after edits**: the edit-action fuzzer on pictures with
  rules; after any action, every untargeted shape has the steps it had.
- **Incremental against full parse**, fuzzed with overlay syntax.
- **Prepare time** on a large deck, before and after.
- **Ghosts are editor-only**: export, thumbnail and presentation output is
  identical with ghosts on and off.
- **Ghost placement** in picture coordinates, with a changing bounding box.

## Found in review, separate from this design

- `\item<alert@2>`: the decoder has no action specifications; the reviewer
  reports the item hidden on every step and the frame given one step. Not
  re-checked here.

## Open questions

- **Removed text**: the insertion line on row selection, above.
- **Names of removed shapes**: a diagnostic (proposed), or follow TeX's
  left-over names?
