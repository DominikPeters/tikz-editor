import { requireArrayValue } from "../../utils/collections.js";
import { worldPoint as makeWorldPoint, worldVector as makeWorldVector, type WorldPoint, type WorldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { PlacementSegment } from "./types.js";
import type { ScenePathCommand } from "../types.js";

function worldPoint(x: number, y: number): WorldPoint {
  return makeWorldPoint(pt(x), pt(y));
}

function worldVector(x: number, y: number): WorldVector {
  return makeWorldVector(pt(x), pt(y));
}

export function appendPathPoint(
  commands: ScenePathCommand[],
  operator: "--" | "-|" | "|-" | null,
  current: WorldPoint | null,
  next: WorldPoint,
  previousSegmentRoundedCorners: number | null,
  currentSegmentRoundedCorners: number | null
): { segment: PlacementSegment | null; nextRoundedCorners: number | null } {
  if (!current) {
    commands.push({ kind: "L", to: next });
    return { segment: null, nextRoundedCorners: currentSegmentRoundedCorners };
  }

  if (!operator || operator === "--") {
    appendSingleLine(commands, current, next, previousSegmentRoundedCorners);
    return {
      segment: { kind: "line", from: current, to: next },
      nextRoundedCorners: currentSegmentRoundedCorners
    };
  }

  if (operator === "-|") {
    const bend = worldPoint(pt(next.x), pt(current.y));
    appendSingleLine(commands, current, bend, previousSegmentRoundedCorners);
    appendSingleLine(commands, bend, next, currentSegmentRoundedCorners);
    return {
      segment: { kind: "hv", operator, from: current, bend, to: next },
      nextRoundedCorners: currentSegmentRoundedCorners
    };
  }

  if (operator === "|-") {
    const bend = worldPoint(pt(current.x), pt(next.y));
    appendSingleLine(commands, current, bend, previousSegmentRoundedCorners);
    appendSingleLine(commands, bend, next, currentSegmentRoundedCorners);
    return {
      segment: { kind: "hv", operator, from: current, bend, to: next },
      nextRoundedCorners: currentSegmentRoundedCorners
    };
  }

  return { segment: null, nextRoundedCorners: currentSegmentRoundedCorners };
}

function appendSingleLine(commands: ScenePathCommand[], from: WorldPoint, to: WorldPoint, cornerRoundedCorners: number | null): void {
  if (!cornerRoundedCorners || cornerRoundedCorners <= 0) {
    commands.push({ kind: "L", to });
    return;
  }

  const previous = extractPreviousCorner(commands);
  if (!previous) {
    commands.push({ kind: "L", to });
    return;
  }

  const rounded = computeRoundedCorner(previous, from, to, cornerRoundedCorners);
  if (!rounded) {
    commands.push({ kind: "L", to });
    return;
  }

  const last = commands[commands.length - 1];
  if (last?.kind === "L") {
    last.to = rounded.entry;
  } else {
    commands.push({ kind: "L", to: rounded.entry });
  }
  commands.push({ kind: "C", c1: rounded.c1, c2: rounded.c2, to: rounded.exit });
  commands.push({ kind: "L", to });
}

export function roundClosedPathStartCorner(
  commands: ScenePathCommand[],
  closingFrom: WorldPoint,
  start: WorldPoint,
  cornerRoundedCorners: number | null
): void {
  if (!cornerRoundedCorners || cornerRoundedCorners <= 0) {
    return;
  }

  const move = commands[0];
  if (move?.kind !== "M") {
    return;
  }

  const firstSegmentIndex = commands.findIndex(
    (command, index) => index > 0 && (command.kind === "L" || command.kind === "C" || command.kind === "A")
  );
  if (firstSegmentIndex === -1) {
    return;
  }

  const firstSegment = requireArrayValue(commands, firstSegmentIndex);
  if (firstSegment.kind !== "L" && firstSegment.kind !== "C" && firstSegment.kind !== "A") {
    return;
  }
  const rounded = computeRoundedCorner(closingFrom, start, firstSegment.to, cornerRoundedCorners);
  if (!rounded) {
    return;
  }

  move.to = rounded.exit;

  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = requireArrayValue(commands, index);
    if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
      command.to = rounded.entry;
      break;
    }
  }

  commands.push({ kind: "C", c1: rounded.c1, c2: rounded.c2, to: rounded.exit });
}

function extractPreviousCorner(commands: ScenePathCommand[]): WorldPoint | null {
  if (commands.length < 2) {
    return null;
  }

  const previous = commands[commands.length - 2];
  if (!previous) {
    return null;
  }

  if (previous.kind === "M" || previous.kind === "L" || previous.kind === "C" || previous.kind === "A") {
    return previous.to;
  }

  return null;
}

function computeRoundedCorner(prev: WorldPoint, corner: WorldPoint, next: WorldPoint, requestedDistance: number): {
  entry: WorldPoint;
  exit: WorldPoint;
  c1: WorldPoint;
  c2: WorldPoint;
} | null {
  const incoming = normalize(worldVector(corner.x - prev.x, corner.y - prev.y));
  const outgoing = normalize(worldVector(next.x - corner.x, next.y - corner.y));
  if (!incoming || !outgoing) {
    return null;
  }

  if (!Number.isFinite(requestedDistance) || requestedDistance <= 0) {
    return null;
  }

  const incomingLength = distance(prev, corner);
  const outgoingLength = distance(corner, next);
  if (!Number.isFinite(incomingLength) || !Number.isFinite(outgoingLength) || incomingLength <= 1e-9 || outgoingLength <= 1e-9) {
    return null;
  }

  const inDistance = Math.min(requestedDistance, incomingLength);
  const outDistance = Math.min(requestedDistance, outgoingLength);
  if (inDistance <= 1e-9 || outDistance <= 1e-9) {
    return null;
  }

  // PGF rounds corners by stepping fixed in/out distances along segments, then
  // inserting a quarter-circle cubic approximation with kappa = 0.5522847.
  const kappa = 0.5522847;

  const entry = worldPoint(corner.x - incoming.x * inDistance, corner.y - incoming.y * inDistance);
  const exit = worldPoint(corner.x + outgoing.x * outDistance, corner.y + outgoing.y * outDistance);
  const c1 = worldPoint(
    entry.x + incoming.x * inDistance * kappa,
    entry.y + incoming.y * inDistance * kappa
  );
  const c2 = worldPoint(
    exit.x - outgoing.x * outDistance * kappa,
    exit.y - outgoing.y * outDistance * kappa
  );

  return { entry, exit, c1, c2 };
}

function normalize(vector: WorldVector): WorldVector | null {
  const len = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return null;
  }
  return worldVector(vector.x / len, vector.y / len);
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
