# Beamer Overlays panel

The Overlays tab is available beside the Inspector on a Beamer slide. View →
Overlays Panel reopens it. It projects the current frame's authored overlay
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
- Pauses appear as source boundaries. Rules without a known preview have an
  **Edit in source** action in place of timeline cells.

Rows remain present when their content is absent from the rendered step.
Labels are derived from source and are not identities. Selection follows
source offsets through ordinary edits and clears when its owner is deleted,
the frame/document changes, or the user selects or edits canvas content.

## Preview and selection

Timeline cells distinguish visible, covered (space retained), and absent
content. Enclosing rules affect the displayed state. The rule details link
to enclosing owners. When content first appears outside the displayed steps,
a navigation action jumps to that step without changing source.

The timeline shows four steps at a time. Finding the first visible step checks
interval boundaries, so very large step numbers do not create large arrays.

Selecting a row reveals its source range and highlights only geometry painted
on the current step. Hidden content has no synthetic canvas box. Highlighting
waits for a snapshot with matching source revision and step. Focused source
editing is left undisturbed unless the user chooses **Edit rule in source**.

## Editing contract

Numeric specifications such as `2-`, `1,3`, and `2-4` can be edited with the
Steps field, committing on Enter or blur and cancelling with Escape, like
the Inspector. This replaces only the contents of the existing angle
brackets, through the normal revision-checked source patch and undo history.
Changing source discards an uncommitted field draft.

Right-clicking a timeline cell offers **Show from step**, **Only on step**, and
**Show through step**. The selected rule's Timing actions menu provides the
same commands for the current preview step. Cell menus also open with the
Context Menu key or Shift+F10 and support arrow-key navigation. Source changes
invalidate an open menu.

Selecting a single numeric visibility interval exposes its start and finite
end handles. Dragging a handle snaps to steps, updates source and the slide
preview live, and commits one undo entry on release. Escape, pointer cancellation,
window blur, unmounting, or switching documents cancels the gesture. Intervening
source edits are never overwritten. Arrow keys on a focused handle move it one
step, including beyond the current page. Endpoints cannot cross. Open-ended
rules expose only their start; disjoint intervals remain editable in the Steps
field. These visibility gestures apply to only/uncover/visible rules and explicit
items; inverted and branching rules keep the existing specification editor.

Relative specifications, mode/action rules, pauses, and unsupported commands
use source editing. They are never flattened to numeric rules. The renderer's
existing coverage still determines preview fidelity; rules with unknown
behavior offer source editing, including possible effects of unsupported
stateful commands.

## Panel design

The panel reuses the Inspector's field, section, and action styles and the
Objects panel's row labels and disclosure controls. Colors, typography, and
focus states use the existing theme tokens.

- Rows identify content; indentation and disclosure controls express ownership.
- Step headers and cells select the preview. A compact key explains the three
  visible states. List defaults have no fake timeline cells.
- Timing commands appear in a context menu; boundary handles appear only on
  the selected, editable interval.
- Page controls appear only when the steps extend beyond the current page.
- The selected rule's controls stay visible below the scrolling timeline.
  A Steps field edits the rule, owner links navigate to shared/enclosing rules,
  and Edit in source reveals the authored specification.
- Duplicate step counts, repeated rule summaries, provenance subtitles, and
  general caveat paragraphs are omitted. Validation appears only for an invalid
  field draft and tells the user how to correct it.

## Canvas context menu

The canvas object menu has an Overlays submenu for blocks, list items, images,
and whole TikZ figures. Appear on next step assigns `N+1-` and previews that
step; Show from / Only on / Show through use the current preview step. Existing
numeric rules are patched in place. New block/item rules use native overlay
arguments; figures use an `\uncover` wrapper, retaining their space.

Edit in Overlays opens the panel and selects the source rule. Remove overlay
rule removes the object's own numeric visibility rule without removing its
content or surrounding comments. Shared, inherited, relative and branching
rules expose navigation to their owner instead of silently changing neighbors.
Right-click keeps a selected object when the click is inside its bounds;
otherwise it selects the clicked object, with its outline identifying the target.
The Context Menu key and Shift+F10 open the selected object's menu. Commands
use the same definitions on web and native desktop menus, guard source revision,
document/frame and preview step, and enter normal undo history.

The user-facing name is Overlays. Existing internal panel IDs remain stable so
saved layouts still open the same panel; their displayed tab names are migrated.
Overlay reordering is not implemented.

## Implementation and checks

- `packages/core/src/beamer/builds.ts`: source inventory, labels, visibility,
  numeric patches, and selection reconciliation.
- `packages/app/src/ui/builds-panel/`: timeline, rule editor, and source-to-canvas
  selection geometry.
- `test/beamer-builds.spec.ts` and `test/web/builds-panel.spec.ts`: hidden content,
  nesting, inheritance, alternatives, source preservation, undo/redo, selection
  handoff, stale drafts, and large step numbers.
