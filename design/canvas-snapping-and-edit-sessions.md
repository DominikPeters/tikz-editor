# Canvas snapping and edit sessions

A canvas gesture owns its starting source, parsed figure, semantic geometry,
and snap references. Each pointer update describes an absolute position or a
total displacement from that baseline. Source patches are normalized against
the latest source written by the gesture. An unrelated source edit cancels it.
This avoids accumulated coordinate rounding and keeps edits valid while the
rendered snapshot is catching up.

Endpoint anchors are captured with the same baseline. Connecting to a node can
reorder statements or name an anonymous node; subsequent pointer updates must
still resolve against the original identities. Hover handlers leave active
gesture overlays to the drag controller.

## Geometry and constraints

`EditGeometrySession` reuses rendered geometry for movement, shape/scope resize,
rotation, alignment, distribution, grouping, and node positioning. Node resize
can change text layout, so it measures candidate sources by replaying the
containing statement with its original semantic context. For a nested node,
the containing top-level scope is the replay unit. Preparing that context can
replay preceding statements once; pointer updates do not reevaluate the rest
of the figure. Candidate measurements use a bounded cache and never mutate the
editor's incremental evaluation session.

Pointer snapping follows the gesture's constraints: project onto the permitted
axis or aspect-ratio line, then choose a reachable target. Node size candidates
must also satisfy text/layout limits. When those limits prevent a snap, use the
unsnapped constrained pointer. Source precision for snapped node dimensions must
be high enough to retain the chosen alignment.

Retain the chosen target identities. Validate guides against actual geometry
when the rendered snapshot arrives; another nearby target must not silently
replace the original one. Tool previews also validate after endpoint overrides
or grid quantization. Pointer contexts omit equal-gap search, which is useful
only for whole-selection movement. Tool hover reuses its context per snapshot.

Ctrl/Command bypasses magnetic alignment, grid steps, node/path endpoints,
path-position presets, label centering, and relative-node cardinal attraction.
Explicit Shift constraints and structural path attachment still apply.

## Scheduling and history

Pointer updates are coalesced to the next animation frame. Release flushes the
final pointer before ending the gesture, even when scene computation is pending.
All source writes share one history merge key. A click without movement does
not trigger a final drag update.

Property cleanup is optional source simplification. A reusable worker certifies
it after a gesture that changed the source. Results carry a request ID and the
original document revision; stale results are discarded without recomputing
against newer source. Cleanup uses the gesture's history key, and the reducer
checks the document ID, revision, and source before accepting it. Cleanup merges
into the gesture even when the two actions have different history kinds. Worker failure
leaves the valid source from the gesture intact.
