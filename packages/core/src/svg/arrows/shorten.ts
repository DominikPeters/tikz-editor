import { worldPoint, worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { Frame } from "./types.js";
import type { WorldPoint } from "../../coords/points.js";
import type { ScenePathCommand } from "../../semantic/types.js";
import {
  commandFromSegment,
  commandsToSegments,
  hasDrawablePathCommands,
  samplePointFromStartExtrapolated,
  sliceSegment
} from "../../geometry/path-sampler.js";

const EPSILON = 1e-6;

export type ShortenSubpathResult = {
  commands: ScenePathCommand[];
  appliedStartShortening: number;
  appliedEndShortening: number;
  originalLength: number;
  startFrameForward?: Frame;
  endFrameForward?: Frame;
};

export function shortenOpenSubpath(
  subpath: ScenePathCommand[],
  requestedStartShortening: number,
  requestedEndShortening: number,
  precise = false
): ShortenSubpathResult {
  const commands = subpath.map((command) => cloneCommand(command));
  if (requestedStartShortening < 0 || requestedEndShortening < 0 ||
    (!precise && !commands.some(command => command.kind === "A")) ||
    !commandsToSegments(commands).some(segment => segment.length > EPSILON)) {
    return shortenEndpointCommands(commands, requestedStartShortening, requestedEndShortening);
  }
  if (commands.length < 2 || !hasDrawablePathCommands(commands)) {
    return {
      commands,
      appliedStartShortening: 0,
      appliedEndShortening: 0,
      originalLength: 0
    };
  }

  const segments = commandsToSegments(commands);
  const originalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (segments.length === 0 || originalLength <= EPSILON) {
    return {
      commands,
      appliedStartShortening: 0,
      appliedEndShortening: 0,
      originalLength
    };
  }

  const requestedStart = Math.max(0, requestedStartShortening);
  const requestedEnd = Math.max(0, requestedEndShortening);
  const appliedStart = Math.min(requestedStart, originalLength);
  const appliedEnd = Math.min(requestedEnd, Math.max(0, originalLength - appliedStart));
  const keepFrom = appliedStart;
  const keepTo = Math.max(keepFrom, originalLength - appliedEnd);

  if (keepTo - keepFrom <= EPSILON) {
    const anchor = samplePointFromStartExtrapolated(segments, keepFrom) ?? segments[0].from;
    return {
      commands: [{ kind: "M", to: anchor }],
      appliedStartShortening: appliedStart,
      appliedEndShortening: appliedEnd,
      originalLength
    };
  }

  const keptSegments = [];
  let traveled = 0;
  for (const segment of segments) {
    if (traveled >= keepTo) {
      break;
    }
    const segmentStart = traveled;
    const segmentEnd = traveled + segment.length;
    const localStart = Math.max(0, keepFrom - segmentStart);
    const localEnd = Math.min(segment.length, keepTo - segmentStart);
    if (localEnd - localStart > EPSILON) {
      const sliced = sliceSegment(segment, localStart, localEnd);
      if (sliced) {
        keptSegments.push(sliced);
      }
    }
    traveled = segmentEnd;
  }

  if (keptSegments.length === 0) {
    const anchor = samplePointFromStartExtrapolated(segments, keepFrom) ?? segments[0].from;
    return {
      commands: [{ kind: "M", to: anchor }],
      appliedStartShortening: appliedStart,
      appliedEndShortening: appliedEnd,
      originalLength
    };
  }

  const head = keptSegments[0];
  const resultCommands: ScenePathCommand[] = [];
  resultCommands.push({ kind: "M", to: { ...head.from } });
  for (const segment of keptSegments) {
    resultCommands.push(commandFromSegment(segment));
  }

  return {
    commands: resultCommands,
    appliedStartShortening: appliedStart,
    appliedEndShortening: appliedEnd,
    originalLength
  };
}

// PGF's ordinary (non-bending) arrows move endpoint tokens only. The last
// endpoint is processed first, so shortening a one-segment path past its
// start can reverse the direction used for the start arrow.
function shortenEndpointCommands(commands: ScenePathCommand[], start: number, end: number): ShortenSubpathResult {
  const originalLength = commandsToSegments(commands).reduce((sum, segment) => sum + segment.length, 0);
  if (commands.length === 0) return { commands, appliedStartShortening: 0, appliedEndShortening: 0, originalLength };
  const first = commands[0];
  const last = commands[commands.length - 1];
  if (first.kind !== "M" || last.kind === "Z") {
    return { commands, appliedStartShortening: 0, appliedEndShortening: 0, originalLength };
  }
  const requestedStart = start;
  const requestedEnd = end;
  const frame = (endpoint: WorldPoint, references: WorldPoint[], shortening: number, startSide: boolean): Frame => {
    const reference = references.find(point => Math.hypot(point.x - endpoint.x, point.y - endpoint.y) > EPSILON);
    const dx = reference ? endpoint.x - reference.x : 0;
    const dy = reference ? endpoint.y - reference.y : 1;
    const length = Math.hypot(dx, dy);
    const tx = dx / length;
    const ty = dy / length;
    const tangent = worldVector(pt(startSide ? -tx : tx), pt(startSide ? -ty : ty));
    return {
      point: worldPoint(pt(endpoint.x - shortening * tx), pt(endpoint.y - shortening * ty)),
      tangent,
      normal: worldVector(pt(0 - tangent.y), pt(tangent.x))
    };
  };
  const segments = commandsToSegments(commands);
  const tail = segments.length > 0 ? segments[segments.length - 1] : undefined;
  const endReferences = tail?.kind === "C" ? [tail.command.c2, tail.command.c1, tail.from] : tail ? [tail.from] : [];
  const endFrameForward = frame(last.to, endReferences, requestedEnd, false);
  if (last.kind !== "M" && requestedEnd !== 0) {
    // PGF normalizes a zero vector upward for line-at-distance, while its
    // arrow transform independently points upward at the original point.
    const degenerate = !endReferences.some(point => Math.hypot(point.x - last.to.x, point.y - last.to.y) > EPSILON);
    last.to = degenerate
      ? worldPoint(pt(last.to.x), pt(last.to.y + requestedEnd))
      : endFrameForward.point;
  }
  const afterEndSegments = commandsToSegments(commands);
  const head = afterEndSegments.length > 0 ? afterEndSegments[0] : undefined;
  const startReferences = head?.kind === "C" ? [head.command.c1, head.command.c2, head.to] : head ? [head.to] : [];
  const startFrameForward = frame(first.to, startReferences, requestedStart, true);
  if (commands.length > 1 && requestedStart !== 0) first.to = startFrameForward.point;
  return { commands, appliedStartShortening: requestedStart, appliedEndShortening: requestedEnd, originalLength, startFrameForward, endFrameForward };
}

function cloneCommand(command: ScenePathCommand): ScenePathCommand {
  if (command.kind === "M" || command.kind === "L") {
    return { kind: command.kind, to: { ...command.to } };
  }
  if (command.kind === "C") {
    return { kind: "C", c1: { ...command.c1 }, c2: { ...command.c2 }, to: { ...command.to } };
  }
  if (command.kind === "A") {
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to: { ...command.to }
    };
  }
  return { kind: "Z" };
}
