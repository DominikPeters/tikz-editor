import type { Span } from "../ast/types.js";
import {
  concatMappedText,
  createGeneratedMappedText,
  sliceMappedText,
  type MappedText,
} from "../text/source-map.js";
import {
  readBeamerOptionalArgument,
  readBeamerOverlayArgument,
  readBeamerRequiredArgument,
  scanBeamerControlSequences,
  scanBeamerEnvironmentTokens,
} from "./scan.js";
import type {
  BeamerDelimitedSourceValue,
  BeamerFrameModel,
} from "./types.js";

export type BeamerOverlayInterval = {
  readonly from: number;
  readonly to: number | null;
};

export type BeamerOverlaySpec = {
  readonly source: BeamerDelimitedSourceValue;
  readonly resolved: string;
  readonly intervals: readonly BeamerOverlayInterval[];
  readonly minimumStep: number | null;
  readonly lastRequiredStep: number;
};

export type BeamerOverlayCommandKind =
  | "only"
  | "uncover"
  | "visible"
  | "invisible"
  | "alt"
  | "temporal";

export type BeamerOverlayCommand = {
  readonly kind: BeamerOverlayCommandKind;
  readonly span: Span;
  readonly commandSpan: Span;
  readonly spec: BeamerOverlaySpec;
  readonly branches: readonly BeamerDelimitedSourceValue[];
  /** Macro syntax removed before the selected branch reaches the TeX frontend. */
  readonly syntaxSpans: readonly Span[];
};

export type BeamerOverlayItem = {
  readonly commandSpan: Span;
  readonly listItemIndex: number;
  readonly spec: BeamerOverlaySpec;
  readonly overlaySpan: Span;
  readonly contentSpan: Span;
};

export type BeamerOverlayPause = {
  readonly span: Span;
  readonly threshold: number;
  readonly contentSpan: Span;
};

export type BeamerOverlayModel = {
  readonly frameSpan: Span;
  readonly commands: readonly BeamerOverlayCommand[];
  readonly items: readonly BeamerOverlayItem[];
  readonly pauses: readonly BeamerOverlayPause[];
  readonly stepCount: number;
};

export type BeamerOverlayVisibility = "visible" | "hidden" | "removed";

export type BeamerOverlayTextProjection = {
  readonly mapped: MappedText;
  readonly hiddenSourceSpans: readonly Span[];
  readonly hiddenListItemIndices: readonly number[];
};

type PendingSpec =
  | {
      readonly kind: "command";
      readonly sourceOrder: number;
      readonly command: Omit<BeamerOverlayCommand, "spec">;
      readonly rawSpec: BeamerDelimitedSourceValue;
    }
  | {
      readonly kind: "item";
      readonly sourceOrder: number;
      readonly commandSpan: Span;
      readonly listItemIndex: number;
      readonly overlaySpan: Span;
      readonly contentSpan: Span;
      readonly rawSpec: BeamerDelimitedSourceValue;
    }
  | {
      readonly kind: "pause";
      readonly sourceOrder: number;
      readonly span: Span;
      readonly requestedStep: number | null;
    };

const OVERLAY_COMMANDS = new Map<string, BeamerOverlayCommandKind>([
  ["only", "only"],
  ["uncover", "uncover"],
  ["visible", "visible"],
  ["invisible", "invisible"],
  ["alt", "alt"],
  ["temporal", "temporal"],
  ["onslide", "uncover"],
]);

/**
 * Scan the source-level overlay program for one frame.
 *
 * This mirrors Beamer's auxiliary overlay decoder boundary without executing
 * TeX. Relative `+` and `.` specifications are resolved in source order
 * against the same counter used by `\pause`.
 */
export function scanBeamerFrameOverlays(
  source: string,
  frame: BeamerFrameModel
): BeamerOverlayModel {
  const pending: PendingSpec[] = [];
  const controls = scanBeamerControlSequences(source, frame.bodySpan);
  const listRanges = beamerListRanges(source, frame.bodySpan);
  const itemControls = controls.filter((command) => command.name === "item");
  const explicitItemCommands = new Set<number>();

  for (const command of controls) {
    const overlayKind = OVERLAY_COMMANDS.get(command.name);
    if (overlayKind) {
      const parsed = parseOverlayCommand(
        source,
        frame.bodySpan.to,
        command.from,
        command.to,
        overlayKind
      );
      if (parsed) {
        pending.push({
          kind: "command",
          sourceOrder: command.from,
          command: parsed.command,
          rawSpec: parsed.rawSpec,
        });
      }
      continue;
    }
    if (command.name === "pause") {
      const optional = readBeamerOptionalArgument(
        source,
        command.to,
        frame.bodySpan.to
      );
      const requested = optional && /^\s*\d+\s*$/u.test(optional.value)
        ? Number(optional.value.trim())
        : null;
      pending.push({
        kind: "pause",
        sourceOrder: command.from,
        span: {
          from: command.from,
          to: optional?.span.to ?? command.to,
        },
        requestedStep: requested,
      });
      continue;
    }
    if (command.name !== "item") {
      continue;
    }
    const overlay = readBeamerOverlayArgument(
      source,
      command.to,
      frame.bodySpan.to
    );
    if (!overlay) {
      continue;
    }
    explicitItemCommands.add(command.from);
    const owningList = smallestContainingSpan(listRanges, command.from);
    const peers = itemControls.filter((candidate) =>
      smallestContainingSpan(listRanges, candidate.from) === owningList
    );
    const peerIndex = peers.findIndex((candidate) =>
      candidate.from === command.from
    );
    const contentTo = peers[peerIndex + 1]?.from ??
      owningList?.contentTo ??
      frame.bodySpan.to;
    pending.push({
      kind: "item",
      sourceOrder: command.from,
      commandSpan: { from: command.from, to: command.to },
      listItemIndex: peerIndex + 1,
      overlaySpan: overlay.span,
      contentSpan: { from: overlay.span.to, to: contentTo },
      rawSpec: overlay,
    });
  }
  pending.push(...overlayEnvironmentSpecs(source, frame.bodySpan));
  for (const list of listRanges) {
    const defaultArgument = readBeamerOptionalArgument(
      source,
      list.beginTo,
      list.contentTo
    );
    const defaultSpec = defaultArgument
      ? overlaySpecInsideOptional(defaultArgument)
      : null;
    if (!defaultSpec) {
      continue;
    }
    const peers = itemControls.filter((candidate) =>
      smallestContainingSpan(listRanges, candidate.from) === list
    );
    for (const [index, command] of peers.entries()) {
      if (explicitItemCommands.has(command.from)) {
        continue;
      }
      pending.push({
        kind: "item",
        sourceOrder: command.from,
        commandSpan: { from: command.from, to: command.to },
        listItemIndex: index + 1,
        overlaySpan: defaultArgument!.span,
        contentSpan: {
          from: command.to,
          to: peers[index + 1]?.from ?? list.contentTo,
        },
        rawSpec: defaultSpec,
      });
    }
  }

  pending.sort((left, right) => left.sourceOrder - right.sourceOrder);
  const commands: BeamerOverlayCommand[] = [];
  const items: BeamerOverlayItem[] = [];
  const pauseStarts: Array<{
    span: Span;
    threshold: number;
  }> = [];
  let pauseCounter = 1;
  let stepCount = 1;

  for (const entry of pending) {
    if (entry.kind === "pause") {
      pauseCounter = entry.requestedStep ?? pauseCounter + 1;
      pauseStarts.push({ span: entry.span, threshold: pauseCounter });
      stepCount = Math.max(stepCount, pauseCounter);
      continue;
    }
    const resolved = resolveOverlaySpec(entry.rawSpec, pauseCounter);
    pauseCounter = resolved.nextPauseCounter;
    stepCount = Math.max(stepCount, resolved.spec.lastRequiredStep);
    if (entry.kind === "command") {
      commands.push({ ...entry.command, spec: resolved.spec });
    } else {
      items.push({
        commandSpan: entry.commandSpan,
        listItemIndex: entry.listItemIndex,
        overlaySpan: entry.overlaySpan,
        contentSpan: entry.contentSpan,
        spec: resolved.spec,
      });
    }
  }

  const pauses = pauseStarts.map((pause, index): BeamerOverlayPause => ({
    ...pause,
    contentSpan: {
      from: pause.span.to,
      to: pauseStarts[index + 1]?.span.from ?? frame.bodySpan.to,
    },
  }));

  return {
    frameSpan: frame.bodySpan,
    commands,
    items,
    pauses,
    stepCount,
  };
}

export function beamerOverlaySpecContains(
  spec: BeamerOverlaySpec,
  step: number
): boolean {
  return spec.intervals.some((interval) =>
    step >= interval.from && (interval.to == null || step <= interval.to)
  );
}

export function resolveBeamerOverlaySpanVisibility(
  model: BeamerOverlayModel,
  span: Span,
  step: number
): BeamerOverlayVisibility {
  let visibility: BeamerOverlayVisibility = "visible";
  for (const command of model.commands) {
    const branchIndex = command.branches.findIndex((branch) =>
      containsSpan(branch.contentSpan, span)
    );
    if (branchIndex < 0) {
      continue;
    }
    const selected = selectedOverlayBranch(command, step);
    if (selected !== branchIndex) {
      if (
        command.kind === "uncover" ||
        command.kind === "visible" ||
        command.kind === "invisible"
      ) {
        visibility = "hidden";
      } else {
        return "removed";
      }
    } else if (
      command.kind === "uncover" ||
      command.kind === "visible" ||
      command.kind === "invisible"
    ) {
      const shouldPaint = command.kind === "invisible"
        ? !beamerOverlaySpecContains(command.spec, step)
        : beamerOverlaySpecContains(command.spec, step);
      if (!shouldPaint) {
        visibility = "hidden";
      }
    }
  }
  for (const item of model.items) {
    if (
      (containsSpan(item.contentSpan, span) ||
        containsSpan(item.commandSpan, span)) &&
      !beamerOverlaySpecContains(item.spec, step)
    ) {
      visibility = "hidden";
    }
  }
  for (const pause of model.pauses) {
    if (containsSpan(pause.contentSpan, span) && step < pause.threshold) {
      visibility = "hidden";
    }
  }
  return visibility;
}

/**
 * Project one source-backed text leaf onto a concrete overlay step.
 *
 * Removed branches are deleted before line breaking. Covered branches remain
 * in the mapped text and are recorded as hidden paint spans, preserving their
 * exact TeX dimensions and caret/source geometry.
 */
export function projectBeamerOverlayText(
  mapped: MappedText,
  sourceSpan: Span,
  model: BeamerOverlayModel,
  step: number
): BeamerOverlayTextProjection {
  const removals: Span[] = [];
  const hidden: Span[] = [];
  const hiddenListItemIndices: number[] = [];
  const emptyOnlyPlaceholders: Span[] = [];

  for (const command of model.commands) {
    removals.push(...command.syntaxSpans);
    const selected = selectedOverlayBranch(command, step);
    if (command.kind === "only" && selected < 0) {
      emptyOnlyPlaceholders.push(command.span);
    }
    for (const [index, branch] of command.branches.entries()) {
      if (index !== selected) {
        removals.push(branch.contentSpan);
      }
    }
    if (
      selected >= 0 &&
      (command.kind === "uncover" ||
        command.kind === "visible" ||
        command.kind === "invisible")
    ) {
      const shouldPaint = command.kind === "invisible"
        ? !beamerOverlaySpecContains(command.spec, step)
        : beamerOverlaySpecContains(command.spec, step);
      if (!shouldPaint) {
        hidden.push(command.branches[selected].contentSpan);
      }
    }
  }
  for (const item of model.items) {
    removals.push(item.overlaySpan);
    if (!beamerOverlaySpecContains(item.spec, step)) {
      hidden.push(item.commandSpan, item.contentSpan);
      if (intersectSpan(item.contentSpan, sourceSpan)) {
        hiddenListItemIndices.push(item.listItemIndex);
      }
    }
  }
  for (const pause of model.pauses) {
    removals.push(pause.span);
    if (step < pause.threshold) {
      hidden.push(pause.contentSpan);
    }
  }

  const clippedRemovals = mergeSpans(
    removals
      .map((span) => intersectSpan(span, sourceSpan))
      .filter((span): span is Span => span != null)
  );
  const parts: MappedText[] = [];
  let cursor = sourceSpan.from;
  for (const removal of clippedRemovals) {
    if (removal.from > cursor) {
      parts.push(sliceMappedText(
        mapped,
        cursor - sourceSpan.from,
        removal.from - sourceSpan.from
      ));
    }
    cursor = Math.max(cursor, removal.to);
    const placeholder = emptyOnlyPlaceholders.find(
      (candidate) =>
        candidate.from === removal.from &&
        candidate.to <= removal.to &&
        containsSpan(sourceSpan, candidate)
    );
    if (placeholder) {
      parts.push(createGeneratedMappedText(
        String.raw`\mbox{}`,
        "Inactive Beamer only branch",
        placeholder
      ));
    }
  }
  if (cursor < sourceSpan.to) {
    parts.push(sliceMappedText(
      mapped,
      cursor - sourceSpan.from,
      sourceSpan.to - sourceSpan.from
    ));
  }
  return {
    mapped: concatMappedText(parts),
    hiddenSourceSpans: mergeSpans(
      hidden
        .map((span) => intersectSpan(span, sourceSpan))
        .filter((span): span is Span => span != null)
    ),
    hiddenListItemIndices,
  };
}

function parseOverlayCommand(
  source: string,
  limit: number,
  commandFrom: number,
  commandTo: number,
  kind: BeamerOverlayCommandKind
): {
  command: Omit<BeamerOverlayCommand, "spec">;
  rawSpec: BeamerDelimitedSourceValue;
} | null {
  let cursor = commandTo;
  let spec = readBeamerOverlayArgument(source, cursor, limit);
  if (spec) {
    cursor = spec.span.to;
  }
  const branchCount = kind === "alt" ? 2 : kind === "temporal" ? 3 : 1;
  const branches: BeamerDelimitedSourceValue[] = [];
  for (let index = 0; index < branchCount; index += 1) {
    const branch = readBeamerRequiredArgument(source, cursor, limit);
    if (!branch) {
      return null;
    }
    branches.push(branch);
    cursor = branch.span.to;
  }
  if (!spec) {
    spec = readBeamerOverlayArgument(source, cursor, limit);
    if (!spec) {
      return null;
    }
    cursor = spec.span.to;
  }
  const span = { from: commandFrom, to: cursor };
  return {
    rawSpec: spec,
    command: {
      kind,
      span,
      commandSpan: { from: commandFrom, to: commandTo },
      branches,
      syntaxSpans: overlayCommandSyntaxSpans(span, branches),
    },
  };
}

function overlayCommandSyntaxSpans(
  span: Span,
  branches: readonly BeamerDelimitedSourceValue[]
): Span[] {
  const result: Span[] = [];
  let cursor = span.from;
  for (const branch of branches) {
    if (cursor < branch.contentSpan.from) {
      result.push({ from: cursor, to: branch.contentSpan.from });
    }
    cursor = branch.contentSpan.to;
  }
  if (cursor < span.to) {
    result.push({ from: cursor, to: span.to });
  }
  return result;
}

function selectedOverlayBranch(
  command: BeamerOverlayCommand,
  step: number
): number {
  const active = beamerOverlaySpecContains(command.spec, step);
  if (
    command.kind === "only" ||
    command.kind === "uncover" ||
    command.kind === "visible"
  ) {
    return active ? 0 : command.kind === "only" ? -1 : 0;
  }
  if (command.kind === "invisible") {
    return 0;
  }
  if (command.kind === "alt") {
    return active ? 0 : 1;
  }
  if (active) {
    return 1;
  }
  return command.spec.minimumStep != null && step < command.spec.minimumStep
    ? 0
    : 2;
}

function resolveOverlaySpec(
  source: BeamerDelimitedSourceValue,
  pauseCounter: number
): {
  spec: BeamerOverlaySpec;
  nextPauseCounter: number;
} {
  let sawPlus = false;
  const resolved = source.value
    .replace(/(?:presentation|beamer|all)\s*:/gu, "")
    .replace(/([+.])(?:\(([-+]?\d+)\))?/gu, (_whole, symbol, offsetRaw) => {
      const offset = Number(offsetRaw ?? 0);
      if (symbol === "+") {
        sawPlus = true;
        return String(Math.max(1, pauseCounter + offset));
      }
      return String(Math.max(1, pauseCounter - 1 + offset));
    });
  const intervals: BeamerOverlayInterval[] = [];
  for (const rawPart of resolved.split(",")) {
    const part = rawPart.trim();
    if (/^\d+$/u.test(part)) {
      const value = Number(part);
      intervals.push({ from: value, to: value });
      continue;
    }
    const range = /^(\d*)\s*-\s*(\d*)$/u.exec(part);
    if (!range || (!range[1] && !range[2])) {
      continue;
    }
    const from = range[1] ? Number(range[1]) : 1;
    const to = range[2] ? Number(range[2]) : null;
    if (to == null || to >= from) {
      intervals.push({ from, to });
    }
  }
  const minimumStep = intervals.length > 0
    ? Math.min(...intervals.map((interval) => interval.from))
    : null;
  const lastRequiredStep = Math.max(
    1,
    ...intervals.map((interval) => interval.to ?? interval.from)
  );
  return {
    spec: {
      source,
      resolved,
      intervals,
      minimumStep,
      lastRequiredStep,
    },
    nextPauseCounter: sawPlus ? pauseCounter + 1 : pauseCounter,
  };
}

function beamerListRanges(
  source: string,
  span: Span
): Array<Span & {
  readonly beginTo: number;
  readonly contentTo: number;
}> {
  const tokens = scanBeamerEnvironmentTokens(source, span);
  const stack: Array<{ name: string; from: number; beginTo: number }> = [];
  const result: Array<Span & { beginTo: number; contentTo: number }> = [];
  for (const token of tokens) {
    if (
      token.name !== "itemize" &&
      token.name !== "enumerate" &&
      token.name !== "description"
    ) {
      continue;
    }
    if (token.kind === "begin") {
      stack.push({
        name: token.name,
        from: token.span.from,
        beginTo: token.span.to,
      });
      continue;
    }
    let index = stack.length - 1;
    while (index >= 0 && stack[index]?.name !== token.name) {
      index -= 1;
    }
    const begin = index >= 0 ? stack.splice(index, 1)[0] : undefined;
    if (begin) {
      result.push({
        from: begin.from,
        to: token.span.to,
        beginTo: begin.beginTo,
        contentTo: token.span.from,
      });
    }
  }
  return result;
}

function overlayEnvironmentSpecs(
  source: string,
  span: Span
): PendingSpec[] {
  const kindByName = new Map<string, BeamerOverlayCommandKind>([
    ["onlyenv", "only"],
    ["uncoverenv", "uncover"],
    ["visibleenv", "visible"],
    ["invisibleenv", "invisible"],
  ]);
  const tokens = scanBeamerEnvironmentTokens(source, span);
  const result: PendingSpec[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const begin = tokens[index];
    const kind = begin?.kind === "begin"
      ? kindByName.get(begin.name)
      : undefined;
    if (!begin || !kind) {
      continue;
    }
    let depth = 0;
    let endIndex = -1;
    for (let candidate = index; candidate < tokens.length; candidate += 1) {
      const token = tokens[candidate];
      if (token.name !== begin.name) {
        continue;
      }
      depth += token.kind === "begin" ? 1 : -1;
      if (depth === 0) {
        endIndex = candidate;
        break;
      }
    }
    const end = tokens[endIndex];
    const spec = readBeamerOverlayArgument(
      source,
      begin.span.to,
      end?.span.from ?? span.to
    );
    if (!end || !spec) {
      continue;
    }
    const body: BeamerDelimitedSourceValue = {
      span: { from: spec.span.to, to: end.span.from },
      contentSpan: { from: spec.span.to, to: end.span.from },
      value: source.slice(spec.span.to, end.span.from),
    };
    const commandSpan = { from: begin.span.from, to: begin.span.to };
    result.push({
      kind: "command",
      sourceOrder: begin.span.from,
      rawSpec: spec,
      command: {
        kind,
        span: { from: begin.span.from, to: end.span.to },
        commandSpan,
        branches: [body],
        syntaxSpans: [
          { from: begin.span.from, to: spec.span.to },
          { from: end.span.from, to: end.span.to },
        ],
      },
    });
    index = endIndex;
  }
  return result;
}

function overlaySpecInsideOptional(
  optional: BeamerDelimitedSourceValue
): BeamerDelimitedSourceValue | null {
  const match = /^\s*<([\s\S]*)>\s*$/u.exec(optional.value);
  if (match?.[1] == null) {
    return null;
  }
  const openOffset = optional.value.indexOf("<");
  const closeOffset = optional.value.lastIndexOf(">");
  const from = optional.contentSpan.from + openOffset;
  const to = optional.contentSpan.from + closeOffset + 1;
  return {
    span: { from, to },
    contentSpan: { from: from + 1, to: to - 1 },
    value: match[1],
  };
}

function smallestContainingSpan<T extends Span>(
  spans: readonly T[],
  offset: number
): T | null {
  let best: T | null = null;
  for (const span of spans) {
    if (offset <= span.from || offset >= span.to) {
      continue;
    }
    if (!best || span.to - span.from < best.to - best.from) {
      best = span;
    }
  }
  return best;
}

function containsSpan(container: Span, child: Span): boolean {
  return container.from <= child.from && container.to >= child.to;
}

function intersectSpan(left: Span, right: Span): Span | null {
  const from = Math.max(left.from, right.from);
  const to = Math.min(left.to, right.to);
  return to > from ? { from, to } : null;
}

function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((left, right) =>
    left.from - right.from || left.to - right.to
  );
  const result: Span[] = [];
  for (const span of sorted) {
    const last = result.at(-1);
    if (!last || span.from > last.to) {
      result.push({ ...span });
    } else {
      last.to = Math.max(last.to, span.to);
    }
  }
  return result;
}
