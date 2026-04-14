import { applyOptionMutationsToTarget, normalizeOptionKey, type OptionMutation } from "../option-mutations.js";
import { resolvePropertyTarget } from "../property-target.js";
import { formatNumber } from "../format.js";
import type { EditParseOptions } from "../parse-options.js";
import type { SourcePatch } from "../types.js";
import {
  PATH_ATTACHED_NODE_POSITION_VALUE_KEY,
  PATH_ATTACHED_NODE_SIDE_KEY
} from "../path-attached-node-keys.js";
import {
  normalizePathPosition,
  resolvePathAttachedNodeRegime,
  resolvePathPositionPreset,
  resolveDraggedPathAttachedNodeDirection as resolveDraggedDirectionFromRegime
} from "../../semantic/path/path-attached.js";
import type { PathAttachedNodePlacementRegime, Point } from "../../semantic/types.js";

type EditActionResultLike =
  | { kind: "success"; newSource: string; patches: SourcePatch[]; selectedSourceIds?: string[]; changedSourceIds?: string[] }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

const PATH_ATTACHED_DISTANCE_EPSILON_PT = 0.05;
export const PATH_ATTACHED_NODE_EDIT_NOOP_REASON = "Path-attached node edit would not change the source.";

export type MovePathAttachedNodeAction = {
  kind: "movePathAttachedNode";
  nodeId: string;
  hostPathSourceId: string;
  segmentLocator?: string;
  pos: number;
  preserveRegime: true;
  sideUpdate?: {
    kind: "explicit-direction";
    direction: string;
  } | {
    kind: "auto-side";
    side: "left" | "right";
  };
  distanceUpdatePt?: number;
};

type PathAttachedNodeInspectorAction = {
  elementId: string;
  key: string;
  value: string;
};

const POSITION_OPTION_KEYS = [
  "pos",
  "at start",
  "very near start",
  "near start",
  "midway",
  "near end",
  "very near end",
  "at end"
] as const;

const CARDINAL_DIAGONAL_DIRECTIONS = [
  "above",
  "below",
  "left",
  "right",
  "above left",
  "above right",
  "below left",
  "below right"
] as const;
const BASE_DIRECTIONS = ["base left", "base right"] as const;
const MID_DIRECTIONS = ["mid left", "mid right"] as const;

export function applyMovePathAttachedNodeAction(
  source: string,
  action: MovePathAttachedNodeAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolvePropertyTarget(source, action.nodeId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "node-item") {
    return { kind: "unsupported", reason: "Selected path-attached node could not be resolved for drag editing." };
  }

  const regime = resolvePathAttachedNodeRegime(resolved.target.options);
  if (!regime) {
    return { kind: "unsupported", reason: "Selected node is not in a supported path-attached placement regime." };
  }

  const mutations = new Map<string, OptionMutation>();
  applyPositionMutations(mutations, normalizePathPosition(action.pos));
  applySideMutations(mutations, regime, action.sideUpdate);
  applyDistanceMutations(mutations, regime, action);

  const rewritten = applyOptionMutationsToTarget(source, resolved.target, mutations);
  if (!rewritten) {
    return { kind: "unsupported", reason: PATH_ATTACHED_NODE_EDIT_NOOP_REASON };
  }
  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    selectedSourceIds: [action.nodeId],
    changedSourceIds: [action.hostPathSourceId]
  };
}

export function applyPathAttachedNodeInspectorAction(
  source: string,
  action: PathAttachedNodeInspectorAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike | null {
  if (
    action.key !== PATH_ATTACHED_NODE_POSITION_VALUE_KEY &&
    action.key !== PATH_ATTACHED_NODE_SIDE_KEY
  ) {
    return null;
  }

  const resolved = resolvePropertyTarget(source, action.elementId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "node-item") {
    return { kind: "unsupported", reason: "Selected node could not be resolved for path-attached editing." };
  }

  const regime = resolvePathAttachedNodeRegime(resolved.target.options);
  if (!regime) {
    return { kind: "unsupported", reason: "Selected node is not in a supported path-attached placement regime." };
  }

  const mutations = new Map<string, OptionMutation>();
  if (action.key === PATH_ATTACHED_NODE_POSITION_VALUE_KEY) {
    const parsed = Number(action.value);
    if (!Number.isFinite(parsed)) {
      return { kind: "error", message: "Path-attached node position must be a finite number." };
    }
    applyPositionMutations(mutations, parsed);
  } else if (action.key === PATH_ATTACHED_NODE_SIDE_KEY) {
    const sideValue = action.value.trim().toLowerCase();
    if (regime.kind === "auto-side") {
      if (sideValue !== "left" && sideValue !== "right") {
        return { kind: "error", message: "Path-attached auto side must be left or right." };
      }
      applySideMutations(mutations, regime, { kind: "auto-side", side: sideValue });
    } else {
      const normalizedDirection = normalizeOptionKey(sideValue);
      const allowedDirections =
        regime.family === "base" ? BASE_DIRECTIONS :
        regime.family === "mid" ? MID_DIRECTIONS :
        CARDINAL_DIAGONAL_DIRECTIONS;
      const match = allowedDirections.find((candidate) => normalizeOptionKey(candidate) === normalizedDirection);
      if (!match) {
        return { kind: "error", message: "Path-attached explicit side is not compatible with the current regime." };
      }
      applySideMutations(mutations, regime, { kind: "explicit-direction", direction: match });
    }
  }

  const rewritten = applyOptionMutationsToTarget(source, resolved.target, mutations);
  if (!rewritten) {
    return { kind: "unsupported", reason: PATH_ATTACHED_NODE_EDIT_NOOP_REASON };
  }
  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    selectedSourceIds: [action.elementId],
    changedSourceIds: [action.elementId]
  };
}

export function resolveDraggedPathAttachedNodeDirection(
  anchorPoint: Point,
  desiredCenter: Point,
  regime: Extract<PathAttachedNodePlacementRegime, { kind: "explicit-direction" }>
): string {
  return resolveDraggedDirectionFromRegime(anchorPoint, desiredCenter, regime);
}

function applyPositionMutations(
  mutations: Map<string, OptionMutation>,
  rawPosition: number,
  forcedPreset: string | null | undefined = undefined
): void {
  const position = normalizePathPosition(rawPosition);
  const snapped = forcedPreset === undefined
    ? resolvePathPositionPreset(position, null)
    : { preset: forcedPreset as any, snappedT: position };
  for (const key of POSITION_OPTION_KEYS) {
    mutations.set(key, { kind: "remove" });
  }
  if ((forcedPreset ?? snapped.preset) === "midway") {
    return;
  }
  if (forcedPreset != null) {
    if (forcedPreset !== "custom") {
      mutations.set(forcedPreset, { kind: "set", value: "" });
      return;
    }
  } else if (snapped.preset) {
    mutations.set(snapped.preset, { kind: "set", value: "" });
    return;
  }
  mutations.set("pos", { kind: "set", value: formatNumber(position) });
}

function applySideMutations(
  mutations: Map<string, OptionMutation>,
  regime: PathAttachedNodePlacementRegime,
  sideUpdate: MovePathAttachedNodeAction["sideUpdate"] | undefined
): void {
  if (!sideUpdate) {
    return;
  }

  if (regime.kind === "explicit-direction" && sideUpdate.kind === "explicit-direction") {
    const clearKeys =
      regime.family === "base" ? BASE_DIRECTIONS :
      regime.family === "mid" ? MID_DIRECTIONS :
      CARDINAL_DIAGONAL_DIRECTIONS;
    for (const key of clearKeys) {
      mutations.set(key, { kind: "remove" });
    }
    mutations.set(sideUpdate.direction, { kind: "set", value: "" });
    return;
  }

  if (regime.kind === "auto-side" && sideUpdate.kind === "auto-side") {
    const baseSide = regime.swap ? (regime.side === "left" ? "right" : "left") : regime.side;
    const desiredSwap = sideUpdate.side !== baseSide;
    mutations.set("auto", { kind: "set", value: baseSide === "left" ? "" : baseSide });
    if (desiredSwap) {
      mutations.set("swap", { kind: "set", value: "" });
    } else {
      mutations.set("swap", { kind: "remove" });
    }
  }
}

function applyDistanceMutations(
  mutations: Map<string, OptionMutation>,
  regime: PathAttachedNodePlacementRegime,
  action: MovePathAttachedNodeAction
): void {
  if (regime.kind !== "explicit-direction") {
    return;
  }
  if (!Number.isFinite(action.distanceUpdatePt)) {
    return;
  }
  const resolvedDistance = Math.max(0, action.distanceUpdatePt!);
  const resolvedDirection =
    action.sideUpdate?.kind === "explicit-direction"
      ? action.sideUpdate.direction
      : regime.direction;
  if (resolvedDistance <= PATH_ATTACHED_DISTANCE_EPSILON_PT) {
    mutations.set(resolvedDirection, { kind: "set", value: "" });
    return;
  }
  mutations.set(resolvedDirection, { kind: "set", value: `${formatNumber(resolvedDistance)}pt` });
}
