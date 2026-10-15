import { requireArrayValue } from "../utils/collections.js";
import type { WorldBounds } from "../coords/points.js";
import type { EditHandle, SceneFigure } from "../semantic/types.js";
import { collectSourceWorldBounds } from "./snapping/index.js";
import { planAlignDeltas, planDistributeDeltas, type AlignMode, type DistributeAxis } from "./arrange.js";
import { parseEditableTargetId } from "./editable-targets.js";
import { isAdornmentTargetId } from "./editable-targets.js";
import type { EditParseOptions } from "./parse-options.js";
import {
  parseStatementSnapshot,
  resolveStatementRefs,
  type StatementSnapshot
} from "./statement-ops.js";
import { isUngroupableScopeStatement } from "./actions/group-ungroup-actions.js";
import {
  resolveEligibleExplicitPath,
  resolveActivePathPointHandle,
  type ExplicitPathAnalysis,
  type PathEditEligibility,
  type PathHandleResolution
} from "./path-editing.js";
import { getRepeatSelectionEligibility } from "./actions/repeat.js";

export const EDIT_ACTION_IDS = [
  "cut",
  "copy",
  "paste",
  "duplicate",
  "repeat",
  "delete",
  "group",
  "ungroup",
  "transform-rotateLeft90",
  "transform-rotateRight90",
  "transform-flipHorizontal",
  "transform-flipVertical",
  "reorder-sendToBack",
  "reorder-sendBackward",
  "reorder-bringForward",
  "reorder-bringToFront",
  "align-left",
  "align-center",
  "align-right",
  "align-top",
  "align-middle",
  "align-bottom",
  "distribute-horizontal",
  "distribute-vertical",
  "path-split",
  "path-join",
  "path-reverse",
  "path-close",
  "path-open",
  "path-delete-point",
  "path-point-corner",
  "path-point-smooth"
] as const;

export type EditActionId = (typeof EDIT_ACTION_IDS)[number];

export type ActionAvailability = {
  enabled: boolean;
  reason: string | null;
};

export type EditActionAvailability = Record<EditActionId, ActionAvailability>;

export type GetEditActionAvailabilityInput = {
  source: string;
  activeFigureId?: string | null;
  parseOptions?: EditParseOptions;
  snapshotSource: string | null;
  selectedSourceIds: readonly string[];
  scene: SceneFigure | null;
  editHandles: readonly EditHandle[];
  activeHandleId?: string | null;
  hasClipboardContent?: boolean;
};

type AvailabilityFacts = {
  source: string;
  activeFigureId: string | null;
  snapshotMatchesSource: boolean;
  selectedSourceIds: string[];
  selectedSet: Set<string>;
  hasClipboardContent: boolean;
  scene: SceneFigure | null;
  editHandles: readonly EditHandle[];
  boundsBySource: Map<string, WorldBounds>;
  selectedHandlesBySource: Map<string, EditHandle[]>;
  selectedMissingBounds: string[];
  selectedMissingHandles: string[];
  selectedUnsupportedSources: string[];
  hasAdornmentSelection: boolean;
  activeHandleId: string | null;
  parseOptions: EditParseOptions;
  statementSnapshot: StatementSnapshot | null;
  explicitPathEligibilityBySourceId: Map<string, PathEditEligibility>;
  activePathHandleResolutionBySourceId: Map<string, PathHandleResolution>;
};

type AvailabilityRule = (facts: AvailabilityFacts) => string | null;

type AnchorSegmentKinds = {
  hasPreviousLine: boolean;
  hasNextLine: boolean;
  hasPreviousCubic: boolean;
  hasNextCubic: boolean;
};

const RULES: Record<EditActionId, AvailabilityRule> = {
  cut: (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to cut.",
  copy: (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to copy.",
  paste: (facts) =>
    facts.hasClipboardContent
      ? null
      : "Clipboard is empty.",
  duplicate: (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to duplicate.",
  repeat: makeRepeatRule(),
  delete: (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to delete.",
  group: makeGroupRule(),
  ungroup: makeUngroupRule(),
  "transform-rotateLeft90": makeTransformRule(),
  "transform-rotateRight90": makeTransformRule(),
  "transform-flipHorizontal": makeTransformRule(),
  "transform-flipVertical": makeTransformRule(),
  "reorder-sendToBack": (facts) =>
    facts.hasAdornmentSelection
      ? "Adornment selections cannot be reordered."
      : facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to reorder.",
  "reorder-sendBackward": (facts) =>
    facts.hasAdornmentSelection
      ? "Adornment selections cannot be reordered."
      : facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to reorder.",
  "reorder-bringForward": (facts) =>
    facts.hasAdornmentSelection
      ? "Adornment selections cannot be reordered."
      : facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to reorder.",
  "reorder-bringToFront": (facts) =>
    facts.hasAdornmentSelection
      ? "Adornment selections cannot be reordered."
      : facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to reorder.",
  "path-split": makePathRule("split"),
  "path-join": makePathRule("join"),
  "path-reverse": makePathRule("reverse"),
  "path-close": makePathRule("close"),
  "path-open": makePathRule("open"),
  "path-delete-point": makePathRule("delete-point"),
  "path-point-corner": makePathRule("point-corner"),
  "path-point-smooth": makePathRule("point-smooth"),
  "align-left": makeAlignRule("left"),
  "align-center": makeAlignRule("center"),
  "align-right": makeAlignRule("right"),
  "align-top": makeAlignRule("top"),
  "align-middle": makeAlignRule("middle"),
  "align-bottom": makeAlignRule("bottom"),
  "distribute-horizontal": makeDistributeRule("horizontal"),
  "distribute-vertical": makeDistributeRule("vertical")
};

export function getEditActionAvailability(
  input: GetEditActionAvailabilityInput,
  actionIds?: readonly EditActionId[]
): EditActionAvailability {
  const facts = deriveFacts(input);
  const requested = actionIds ? new Set(actionIds) : null;

  const availability: Partial<EditActionAvailability> = {};
  for (const actionId of EDIT_ACTION_IDS) {
    if (requested && !requested.has(actionId)) {
      // Keep the interface unified by returning all actions even when the caller
      // requests a subset.
      availability[actionId] = evaluateRule(actionId, facts);
      continue;
    }
    availability[actionId] = evaluateRule(actionId, facts);
  }

  if (!hasAllActionAvailability(availability)) throw new Error("Incomplete edit action availability");
  return availability;
}

function hasAllActionAvailability(value: Partial<EditActionAvailability>): value is EditActionAvailability {
  return EDIT_ACTION_IDS.every(actionId => value[actionId] !== undefined);
}

function evaluateRule(actionId: EditActionId, facts: AvailabilityFacts): ActionAvailability {
  const rule = RULES[actionId];
  const reason = rule(facts);
  return {
    enabled: reason == null,
    reason
  };
}

function deriveFacts(input: GetEditActionAvailabilityInput): AvailabilityFacts {
  const selectedSourceIds = normalizeSourceIds(input.selectedSourceIds);
  const selectedSet = new Set(selectedSourceIds);

  const selectedHandlesBySource = new Map<string, EditHandle[]>();
  for (const handle of input.editHandles) {
    if (!selectedSet.has(handle.sourceRef.sourceId)) {
      continue;
    }
    const handles = selectedHandlesBySource.get(handle.sourceRef.sourceId);
    if (handles) {
      handles.push(handle);
    } else {
      selectedHandlesBySource.set(handle.sourceRef.sourceId, [handle]);
    }
  }

  const selectedMissingHandles: string[] = [];
  const selectedUnsupportedSources: string[] = [];
  for (const sourceId of selectedSourceIds) {
    const handles = selectedHandlesBySource.get(sourceId) ?? [];
    if (handles.length === 0) {
      selectedMissingHandles.push(sourceId);
      continue;
    }
    if (handles.some((handle) => handle.rewriteMode === "unsupported")) {
      selectedUnsupportedSources.push(sourceId);
    }
  }

  const boundsBySource = new Map<string, WorldBounds>();
  const selectedMissingBounds: string[] = [];
  if (input.scene) {
    const worldBounds = collectSourceWorldBounds(input.scene.elements);
    for (const [sourceId, bounds] of worldBounds.entries()) {
      boundsBySource.set(sourceId, bounds);
    }
  }

  for (const sourceId of selectedSourceIds) {
    if (!boundsBySource.has(sourceId)) {
      selectedMissingBounds.push(sourceId);
    }
  }

  return {
    source: input.source,
    activeFigureId: input.activeFigureId ?? null,
    parseOptions:
      input.parseOptions ??
      (input.activeFigureId != null
        ? {
            activeFigureId: input.activeFigureId
          }
        : {}),
    snapshotMatchesSource: input.snapshotSource != null && input.snapshotSource === input.source,
    selectedSourceIds,
    selectedSet,
    hasClipboardContent: Boolean(input.hasClipboardContent),
    scene: input.scene,
    editHandles: input.editHandles,
    boundsBySource,
    selectedHandlesBySource,
    selectedMissingBounds,
    selectedMissingHandles,
    selectedUnsupportedSources,
    hasAdornmentSelection: selectedSourceIds.some((sourceId) => isAdornmentTargetId(sourceId)),
    activeHandleId: input.activeHandleId ?? null,
    statementSnapshot: null,
    explicitPathEligibilityBySourceId: new Map(),
    activePathHandleResolutionBySourceId: new Map()
  };
}

function resolveExplicitPathEligibility(
  facts: AvailabilityFacts,
  sourceId: string
): PathEditEligibility {
  const cached = facts.explicitPathEligibilityBySourceId.get(sourceId);
  if (cached) {
    return cached;
  }
  const resolved = resolveEligibleExplicitPath(facts.source, sourceId, facts.parseOptions);
  facts.explicitPathEligibilityBySourceId.set(sourceId, resolved);
  return resolved;
}

function resolveActivePathHandleResolution(
  facts: AvailabilityFacts,
  sourceId: string,
  analysis: ExplicitPathAnalysis
): PathHandleResolution {
  const cached = facts.activePathHandleResolutionBySourceId.get(sourceId);
  if (cached) {
    return cached;
  }
  const resolved = resolveActivePathPointHandle(
    facts.editHandles,
    analysis,
    facts.activeHandleId,
    facts.source
  );
  facts.activePathHandleResolutionBySourceId.set(sourceId, resolved);
  return resolved;
}

function normalizeSourceIds(sourceIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of sourceIds) {
    const sourceId = raw.trim();
    if (sourceId.length === 0 || seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);
    normalized.push(sourceId);
  }

  return normalized;
}

function makeAlignRule(mode: AlignMode): AvailabilityRule {
  return (facts) => {
    if (facts.hasAdornmentSelection) {
      return "Adornment selections cannot be aligned.";
    }
    const preflight = checkArrangePreconditions(facts, 2);
    if (preflight) {
      return preflight;
    }

    const plan = planAlignDeltas(facts.boundsBySource, facts.selectedSourceIds, mode);
    if (plan.kind === "unsupported") {
      return plan.reason;
    }

    return null;
  };
}

function makeTransformRule(): AvailabilityRule {
  return (facts) => {
    if (facts.hasAdornmentSelection) {
      return "Adornment selections cannot be transformed.";
    }
    if (facts.selectedSourceIds.length === 0) {
      return "Select at least one element to transform.";
    }
    if (!facts.snapshotMatchesSource) {
      return "Wait for recompute to finish before transforming.";
    }
    return null;
  };
}

function makePathRule(
  mode: "split" | "join" | "reverse" | "close" | "open" | "delete-point" | "point-corner" | "point-smooth"
): AvailabilityRule {
  return (facts) => {
    if (facts.hasAdornmentSelection) {
      return "Adornment selections do not support path editing.";
    }
    if (!facts.snapshotMatchesSource) {
      return "Wait for recompute to finish before editing the path.";
    }
    if (mode === "join") {
      if (facts.selectedSourceIds.length !== 2) {
        return "Select exactly two open paths to join.";
      }
      const first = resolveExplicitPathEligibility(facts, requireArrayValue(facts.selectedSourceIds, 0));
      const second = resolveExplicitPathEligibility(facts, requireArrayValue(facts.selectedSourceIds, 1));
      if (first.kind !== "eligible") return first.reason;
      if (second.kind !== "eligible") return second.reason;
      if (first.analysis.closed || second.analysis.closed) {
        return "Only open explicit paths can be joined.";
      }
      return null;
    }

    if (facts.selectedSourceIds.length !== 1) {
      return "Select a single editable path.";
    }
    const selectedId = requireArrayValue(facts.selectedSourceIds, 0);
    const eligible = resolveExplicitPathEligibility(facts, selectedId);
    if (eligible.kind !== "eligible") {
      return eligible.reason;
    }

    if (mode === "close") {
      return eligible.analysis.closed ? "Path is already closed." : null;
    }
    if (mode === "open") {
      return eligible.analysis.closed ? null : "Path is already open.";
    }
    if (mode === "reverse") {
      return eligible.analysis.segments.length > 0 ? null : "Path has no segments to reverse.";
    }

    const handleResolution = resolveActivePathHandleResolution(facts, selectedId, eligible.analysis);
    if (handleResolution.kind !== "found") {
      return handleResolution.reason;
    }

    if (mode === "split") {
      const anchorIndex = handleResolution.anchorIndex;
      return anchorIndex <= 0 || (!eligible.analysis.closed && anchorIndex >= eligible.analysis.anchors.length - 1)
        ? "Choose an interior path point to split."
        : null;
    }
    if (mode === "delete-point") {
      const anchorIndex = handleResolution.anchorIndex;
      if (eligible.analysis.closed) {
        return eligible.analysis.anchors.length > 2
          ? null
          : "Deleting this point would leave too few anchors.";
      }
      return anchorIndex <= 0 || anchorIndex >= eligible.analysis.anchors.length - 1
        ? "Choose an interior path point to delete."
        : null;
    }

    const anchorIndex = handleResolution.anchorIndex;
    if (anchorIndex <= 0 || anchorIndex >= eligible.analysis.anchors.length - 1) {
      return "Choose an interior path anchor point.";
    }
    const { hasPreviousLine, hasNextLine, hasPreviousCubic, hasNextCubic } = collectAnchorSegmentKinds(
      eligible.analysis,
      anchorIndex
    );
    if (mode === "point-smooth") {
      return (hasPreviousCubic && hasNextCubic) || (hasPreviousLine && hasNextLine)
        ? null
        : "Point to Smooth currently supports line-line and cubic-cubic anchors.";
    }
    return hasPreviousCubic && hasNextCubic
      ? null
      : "Point to Corner currently supports anchors between two cubic segments.";
  };
}

function collectAnchorSegmentKinds(analysis: ExplicitPathAnalysis, anchorIndex: number): AnchorSegmentKinds {
  const summary: AnchorSegmentKinds = {
    hasPreviousLine: false,
    hasNextLine: false,
    hasPreviousCubic: false,
    hasNextCubic: false
  };

  for (const segment of analysis.segments) {
    if (segment.startAnchorIndex === anchorIndex) {
      if (segment.kind === "line") {
        summary.hasNextLine = true;
      } else {
        summary.hasNextCubic = true;
      }
    }
    if (segment.endAnchorIndex === anchorIndex) {
      if (segment.kind === "line") {
        summary.hasPreviousLine = true;
      } else {
        summary.hasPreviousCubic = true;
      }
    }
    if (
      (summary.hasPreviousLine || summary.hasPreviousCubic) &&
      (summary.hasNextLine || summary.hasNextCubic)
    ) {
      break;
    }
  }

  return summary;
}

function makeDistributeRule(axis: DistributeAxis): AvailabilityRule {
  return (facts) => {
    if (facts.hasAdornmentSelection) {
      return "Adornment selections cannot be distributed.";
    }
    const preflight = checkArrangePreconditions(facts, 3);
    if (preflight) {
      return preflight;
    }

    const plan = planDistributeDeltas(facts.boundsBySource, facts.selectedSourceIds, axis);
    if (plan.kind === "unsupported") {
      return plan.reason;
    }

    return null;
  };
}

function makeGroupRule(): AvailabilityRule {
  return (facts) => {
    if (facts.hasAdornmentSelection) {
      return "Adornment selections cannot be grouped.";
    }
    if (facts.selectedSourceIds.length < 2) {
      return "Select at least 2 statements to group.";
    }
    const snapshot = resolveStatementSnapshot(facts);
    const refs = resolveStatementRefs(snapshot, facts.selectedSourceIds);
    if (refs.length < 2) {
      return "Select at least 2 statements to group.";
    }
    const parentKeys = new Set(refs.map((ref) => ref.parentKey));
    if (parentKeys.size !== 1) {
      return "Grouping currently requires statements from the same parent scope.";
    }
    return null;
  };
}

function makeRepeatRule(): AvailabilityRule {
  return (facts) => {
    if (facts.hasAdornmentSelection) {
      return "Adornment selections cannot be repeated.";
    }
    if (!facts.snapshotMatchesSource) {
      return "Wait for recompute to finish before repeating the selection.";
    }
    if (facts.selectedSourceIds.length === 1) {
      const selectedId = requireArrayValue(facts.selectedSourceIds, 0);
      if (!selectedId.startsWith("foreach:")) {
        return null;
      }
    }
    const eligibility = getRepeatSelectionEligibility(
      facts.source,
      facts.selectedSourceIds,
      facts.parseOptions
    );
    return eligibility.kind === "eligible" ? null : eligibility.reason;
  };
}

function makeUngroupRule(): AvailabilityRule {
  return (facts) => {
    if (facts.hasAdornmentSelection) {
      return "Adornment selections cannot be ungrouped.";
    }
    if (facts.selectedSourceIds.length !== 1) {
      return "Select exactly one scope to ungroup.";
    }

    const selectedId = requireArrayValue(facts.selectedSourceIds, 0);
    const parsedTarget = parseEditableTargetId(selectedId);
    if (parsedTarget.kind !== "statement" || !parsedTarget.id.startsWith("scope:")) {
      return "Ungroup currently supports scope selections only.";
    }

    const snapshot = resolveStatementSnapshot(facts);
    const ref = snapshot.byId.get(parsedTarget.id);
    if (ref?.statement.kind !== "Scope") {
      return "Ungroup currently supports scope selections only.";
    }
    if (!isUngroupableScopeStatement(ref.statement)) {
      return "Ungroup currently supports only scopes without options, or with `name=...` only.";
    }
    return null;
  };
}

function resolveStatementSnapshot(facts: AvailabilityFacts): StatementSnapshot {
  facts.statementSnapshot ??= parseStatementSnapshot(facts.source, facts.parseOptions);
  return facts.statementSnapshot;
}

function checkArrangePreconditions(
  facts: AvailabilityFacts,
  minSelection: number
): string | null {
  if (facts.selectedSourceIds.length < minSelection) {
    return minSelection === 2
      ? "Select at least 2 elements to align."
      : "Select at least 3 elements to distribute.";
  }

  if (!facts.snapshotMatchesSource) {
    return "Wait for recompute to finish before arranging.";
  }

  if (!facts.scene) {
    return "No scene geometry is available for arranging.";
  }

  if (facts.selectedMissingBounds.length > 0) {
    return "One or more selected elements are missing geometry bounds.";
  }

  if (facts.selectedMissingHandles.length > 0) {
    return "One or more selected elements cannot be moved because no edit handles are available.";
  }

  if (facts.selectedUnsupportedSources.length > 0) {
    return "One or more selected elements use unsupported coordinate forms.";
  }

  return null;
}
