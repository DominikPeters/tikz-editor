# Beamer Builds panel

The Builds tab is available beside the Inspector on a Beamer slide. View →
Builds Panel reopens it. It projects the current frame's authored overlay
rules directly from source; it does not store a separate animation model.

## Rows and labels

- Explicit overlay commands and environments have a row for the content they
  control. Labels use a block title, image filename, equation, diagram, or text
  excerpt. Wrappers around multiple objects have group labels.
- Lists with default overlays have a parent row for the shared rule and child
  rows for items. Inherited items show their resolved steps but cannot change
  the shared specification accidentally.
- Alternatives and temporal commands have a parent rule and individual branch
  rows. Selecting the parent highlights whichever branch is active.
- Pauses appear as source boundaries. Unsupported overlay commands remain
  discoverable, with unknown visibility and a link to their source.

Rows remain present when their content is absent from the rendered step.
Labels are derived from source and are not identities. Selection follows
source offsets through ordinary edits and clears when its owner is deleted,
the frame/document changes, or the user selects or edits canvas content.

## Preview and selection

Timeline cells distinguish visible, covered (space retained), absent, and
unknown content. Enclosing rules affect the displayed state. The rule details
link to enclosing owners and indicate content that is never visible. A
preview button jumps to its first visible step without changing source.

The timeline shows four steps at a time. Finding the first visible step checks
interval boundaries, so very large step numbers do not create large arrays.

Selecting a row reveals its source range and highlights only geometry painted
on the current step. Hidden content has no synthetic canvas box. Highlighting
waits for a snapshot with matching source revision and step. Focused source
editing is left undisturbed unless the user chooses **Edit rule in source**.

## Editing contract

Numeric specifications such as `2-`, `1,3`, and `2-4` can be edited with the
Steps field and Apply. This replaces only the contents of the existing angle
brackets, through the normal revision-checked source patch and undo history.
Changing source discards an uncommitted field draft.

Relative specifications, mode/action rules, pauses, and unsupported commands
use source editing. They are never flattened to numeric rules. The renderer's
existing coverage still determines preview fidelity; unknown rules are marked
explicitly, including possible effects of unsupported stateful commands.

This version edits existing rules. Adding rules is available through the
existing block/item Inspector fields or source. Timeline dragging, build
reordering, and new-rule insertion are not implemented.

## Implementation and checks

- `packages/core/src/beamer/builds.ts`: source inventory, labels, visibility,
  numeric patches, and selection reconciliation.
- `packages/app/src/ui/builds-panel/`: timeline, rule editor, and source-to-canvas
  selection geometry.
- `test/beamer-builds.spec.ts` and `test/web/builds-panel.spec.ts`: hidden content,
  nesting, inheritance, alternatives, source preservation, undo/redo, selection
  handoff, stale drafts, and large step numbers.
