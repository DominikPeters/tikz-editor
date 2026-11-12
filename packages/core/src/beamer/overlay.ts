import { requireDefined } from "../utils/invariants.js";
import { requireArrayValue } from "../utils/collections.js";
import type { Span } from "../ast/types.js";
import {
  concatMappedText,
  createGeneratedMappedText,
  createIdentityMappedText,
  sliceMappedText,
  type MappedText,
} from "../text/source-map.js";
import {
  beamerSyntaxContext,
  beamerOptionalArgumentAfter,
  beamerOverlayArgumentAfter,
  beamerRequiredArgumentAfter,
  beamerControlSequencesIn,
  beamerEnvironmentBoundariesIn,
  type BeamerSyntaxContext,
} from "./syntax.js";
import { matchTexSyntaxEnvironments, type TexSyntaxIndex } from "../text/tex/syntax-index.js";
import type {
  BeamerDelimitedSourceValue,
  BeamerFrameModel,
} from "./types.js";
import { scanBeamerNoteCommands } from "./notes.js";
import { TIKZ_PICTURE_ENVIRONMENTS } from "../parser/figure-scan.js";
import { compareTikzOverlayInstances, tikzOverlayTrace, tikzOverlayTraceNeeded } from "./tikz-overlay-trace.js";

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
  /** Covering in vertical mode precedes LaTeX's deferred item label. */
  readonly leadingItemCommandSpan?: Span;
  readonly spec: BeamerOverlaySpec;
  readonly branches: readonly BeamerDelimitedSourceValue[];
  /** Macro syntax removed before the selected branch reaches the TeX frontend. */
  readonly syntaxSpans: readonly Span[];
  /**
   * For a command a picture's loop performs once per iteration: which
   * iteration this is, outermost loop first. `spec` is resolved from the
   * loop's values; its `source` is the authored text.
   */
  readonly instance?: readonly number[];
  /** For `\onslide<spec>` without a body: a declaration, which holds for what follows it. */
  readonly declaration?: {
    /** Its place among the frame's pauses and declarations, in the order TeX performs them. */
    readonly order: number;
    readonly reach?: BeamerOverlayPictureReach;
  };
};

/**
 * How far a `\pause` or `\onslide` at statement level in a picture holds:
 * from where it is performed to the end of its scope or picture, where the
 * one in force before resumes. Of those in force for a statement the latest
 * performed wins. (Checked with LuaLaTeX; a brace group ends neither.)
 */
export type BeamerOverlayPictureReach = {
  /** The end of the scope or picture it stands in. */
  readonly end: number;
  /** For one a loop performs: the outermost loop around it. */
  readonly loop?: Span;
  /** Its scope lies inside the loop's body, so it holds within one iteration only. */
  readonly scoped?: true;
};

export type BeamerOverlayItem = {
  readonly commandSpan: Span;
  readonly listItemIndex: number;
  readonly spec: BeamerOverlaySpec;
  readonly overlaySpan: Span;
  readonly contentSpan: Span;
  /** Present when this item inherits the enclosing list's default spec. */
  readonly defaultListSpan?: Span;
};

export type BeamerOverlayPause = {
  readonly span: Span;
  readonly threshold: number;
  readonly contentSpan: Span;
  /** Its place among the frame's pauses and declarations, in the order TeX performs them. */
  readonly order: number;
  /** For a pause a picture's loop performs: the iteration, outermost loop first. */
  readonly instance?: readonly number[];
  /** For a pause at statement level in a picture. */
  readonly reach?: BeamerOverlayPictureReach;
};

export type BeamerOverlayReference = {
  readonly sourceStart: number;
  readonly spec: BeamerOverlaySpec;
  /** Hyperlinks and hypertargets use \only semantics for their text argument. */
  readonly contentSpan?: Span;
};

/**
 * A font or color change with an overlay specification, whose text always
 * shows: beamer defines `\textbf<2>{x}` as `\only<2>{\textbf}{x}`,
 * `\alert<2>{x}` as an alert on matching steps only, and `\color<2>{c}`
 * as `\alt<2>{\color}{<gobble the color>}` (`\textcolor<2>{c}{x}` is
 * xcolor's `{\color<2>{c}x}`).
 */
export type BeamerOverlaySwitch = {
  readonly commandSpan: Span;
  readonly spec: BeamerOverlaySpec;
  /** Removed on matching steps: the specification, through the spaces TeX skips after it. */
  readonly activeSyntax: Span;
  /** Removed on the other steps: the command up to the text it applies to. */
  readonly inactiveSyntax: Span;
};

export type BeamerOverlayModel = {
  readonly frameSpan: Span;
  readonly commands: readonly BeamerOverlayCommand[];
  readonly items: readonly BeamerOverlayItem[];
  /** Authored defaults, including those currently overridden by every item.
   * Resolving a default here does not consume the relative overlay counter. */
  readonly listDefaults: readonly { readonly span: Span; readonly spec: BeamerOverlaySpec }[];
  readonly pauses: readonly BeamerOverlayPause[];
  readonly referenceSpecs: readonly BeamerOverlayReference[];
  readonly switches?: readonly BeamerOverlaySwitch[];
  readonly stepCount: number;
  readonly overprints?: readonly { readonly span: Span; readonly contentSpan: Span; readonly width?: BeamerDelimitedSourceValue; readonly branches: readonly BeamerOverlayCommand[] }[];
};

export type BeamerOverlayVisibility = "visible" | "hidden" | "removed";

export type BeamerOverlayTextProjection = {
  readonly mapped: MappedText;
  readonly hiddenSourceSpans: readonly Span[];
};

type PendingDeclaration = {
  readonly from: number;
  readonly syntaxTo: number;
  readonly kind: BeamerOverlayCommandKind;
  readonly spec: BeamerDelimitedSourceValue;
};

type PendingSpec =
  | { readonly kind: "reference"; readonly sourceOrder: number; readonly rawSpec: BeamerDelimitedSourceValue; readonly contentSpan?: Span }
  | { readonly kind: "switch"; readonly sourceOrder: number; readonly switch: Omit<BeamerOverlaySwitch, "spec">; readonly rawSpec: BeamerDelimitedSourceValue }
  | {
      readonly kind: "list-default";
      readonly sourceOrder: number;
      readonly span: Span;
      readonly rawSpec: BeamerDelimitedSourceValue;
    }
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
      readonly defaultListSpan?: Span;
    }
  | {
      readonly kind: "pause";
      readonly sourceOrder: number;
      readonly span: Span;
      readonly requestedStep: number | null;
      readonly instance?: readonly number[];
      readonly reach?: BeamerOverlayPictureReach;
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

/** Beamer's overlay-aware font and color commands (beamerbaseoverlay.sty, beamerbaselocalstructure.sty). */
const OVERLAY_SWITCH_COMMANDS: ReadonlySet<string> = new Set([
  "textbf", "textit", "textmd", "textnormal", "textrm", "textsc", "textsf", "textsl", "texttt", "textup", "emph",
  "alert", "color", "textcolor",
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
  frame: BeamerFrameModel,
  syntax?: TexSyntaxIndex
): BeamerOverlayModel {
  const context = beamerSyntaxContext(source, syntax);
  const pending: PendingSpec[] = [];
  // Frame title arguments are stored before the body but executed when the
  // frame-title box is built. Their overlays can create pages even when the
  // body itself has no overlay commands.
  const privateBodies = scanBeamerNoteCommands(source, context.syntax).map(note => note.bodySpan);
  const controls = beamerControlSequencesIn(context, {
    from: frame.headerSpan.from,
    to: frame.bodySpan.to,
  }).filter(command => !privateBodies.some(span => command.from >= span.from && command.from < span.to));
  const listRanges = beamerListRanges(context, frame.bodySpan);
  const itemControls = controls.filter((command) => command.name === "item" || command.name === "bibitem");
  const listLabelSpans = itemControls.flatMap((command) => {
    const overlay = beamerOverlayArgumentAfter(context, command.to, frame.bodySpan.to);
    const label = beamerOptionalArgumentAfter(context, overlay?.span.to ?? command.to, frame.bodySpan.to);
    return label ? [label.contentSpan] : [];
  });
  const explicitItemCommands = new Set<number>();
  const overprints: Array<{ span: Span; contentSpan: Span; width?: BeamerDelimitedSourceValue }> = [];
  const environmentBoundaries = beamerEnvironmentBoundariesIn(context, frame.bodySpan);
  const environmentPairs = [...matchTexSyntaxEnvironments(context.syntax).values()];
  const tikzRanges = environmentPairs
    .filter(pair => TIKZ_PICTURE_ENVIRONMENTS.has(pair.name) && pair.span.from >= frame.bodySpan.from && pair.span.to <= frame.bodySpan.to)
    .map(pair => pair.span);
  const declarations: PendingDeclaration[] = [];
  // A picture's statement-level overlay commands come from its parsed and
  // loop-expanded statements, each loop iteration performing its own. They
  // join the same source-ordered decoder as the frame's relative
  // specifications and pauses. PGF implements `\path<spec> …;` as
  // \alt<spec>{path}{nothing}.
  const pictureScopes = [...tikzRanges, ...environmentPairs.filter(pair => pair.name === "scope" &&
    tikzRanges.some(picture => picture.from <= pair.span.from && pair.span.to <= picture.to))
    .map(pair => ({ from: pair.span.from, to: pair.end.span.from }))];
  /** The end of the innermost scope or picture around a place in a picture. */
  const scopeEnd = (at: number): number => {
    let end = frame.bodySpan.to, width = Infinity;
    for (const scope of pictureScopes) {
      if (scope.from < at && at < scope.to && scope.to - scope.from < width) { end = Math.min(scope.to, frame.bodySpan.to); width = scope.to - scope.from; }
    }
    return end;
  };
  const pictureReach = (at: number, loop: Span | null): BeamerOverlayPictureReach => {
    const end = scopeEnd(at);
    if (!loop) return { end };
    // A scope inside the loop's body ends with its iteration; otherwise the loop's last one holds on, to the end of the loop's scope.
    return end <= loop.to ? { end, loop, scoped: true } : { end: scopeEnd(loop.from), loop };
  };
  const traces = tikzRanges.filter(span => tikzOverlayTraceNeeded(source.slice(span.from, span.to))).map(span => tikzOverlayTrace(source, span));
  const pictureStatementStarts = new Set(traces.flatMap(trace => [...trace.statementStarts]));
  for (const trace of traces) {
    trace.ops.forEach((op, index) => {
      // A loop's operations run where the loop stands, in the order it performs them.
      const sourceOrder = op.loopSpan ? op.loopSpan.from + (index + 1) / (trace.ops.length + 2) : op.span.from;
      const performed = op.loopSpan ? { instance: op.instance } : {};
      if (op.kind === "pause") {
        pending.push({ kind: "pause", sourceOrder, span: op.span, requestedStep: op.countRaw !== null && /^\s*\d+\s*$/u.test(op.countRaw) ? Number(op.countRaw.trim()) : null,
          ...performed, reach: pictureReach(op.span.from, op.loopSpan) });
      } else if (op.kind === "declaration") {
        // As in text: a starred \onslide without a body is left to TeX.
        if (op.modifier === "*") return;
        const reach = pictureReach(op.span.from, op.loopSpan);
        const contentSpan = { from: op.span.to, to: reach.end };
        pending.push({ kind: "command", sourceOrder,
          rawSpec: op.spec ? { span: op.spec.span, contentSpan: op.spec.contentSpan, value: op.spec.raw }
            : { span: { from: op.span.to, to: op.span.to }, contentSpan: { from: op.span.to, to: op.span.to }, value: "1-" },
          command: { kind: op.modifier === "+" ? "visible" : "uncover", commandSpan: op.span, span: { from: op.span.from, to: reach.end },
            branches: [{ span: contentSpan, contentSpan, value: source.slice(contentSpan.from, contentSpan.to) }], syntaxSpans: [op.span],
            ...performed, declaration: { order: 0, reach } } });
      } else if (op.kind === "path") {
        pending.push({ kind: "command", sourceOrder, rawSpec: { span: op.spec.span, contentSpan: op.spec.contentSpan, value: op.spec.raw },
          command: { kind: "only", span: op.span, commandSpan: { from: op.span.from, to: op.spec.span.from },
            branches: [{ span: op.span, contentSpan: op.span, value: source.slice(op.span.from, op.span.to) }], syntaxSpans: [op.spec.span], ...performed } });
      } else {
        const kind: BeamerOverlayCommandKind = op.command === "onslide" ? op.modifier === "*" ? "only" : op.modifier === "+" ? "visible" : "uncover" : op.command;
        const branchCount = overlayBranchCount(kind);
        if (op.branches.length < branchCount) return;
        const branches = op.branches.slice(0, branchCount).map(contentSpan =>
          ({ span: { from: contentSpan.from - 1, to: contentSpan.to + 1 }, contentSpan, value: source.slice(contentSpan.from, contentSpan.to) }));
        const span = { from: op.span.from, to: requireArrayValue(branches, branches.length - 1).span.to };
        pending.push({ kind: "command", sourceOrder, rawSpec: { span: op.spec.span, contentSpan: op.spec.contentSpan, value: op.spec.raw },
          command: { kind, span, commandSpan: { from: span.from, to: op.spec.span.from }, branches, syntaxSpans: overlayCommandSyntaxSpans(span, branches), ...performed } });
      }
    });
  }
  const overprintStarts: typeof environmentBoundaries[number][] = [];
  for (const boundary of environmentBoundaries) {
    if (boundary.name !== "overprint") continue;
    if (boundary.kind === "begin") { overprintStarts.push(boundary); continue; }
    const begin = overprintStarts.pop();
    if (!begin) continue;
    const width = beamerOptionalArgumentAfter(context, begin.span.to, boundary.span.from) ?? undefined;
    overprints.push({ span: { from: begin.span.from, to: boundary.span.to }, contentSpan: { from: width?.span.to ?? begin.span.to, to: boundary.span.from }, ...(width ? { width } : {}) });
  }
  for (const command of controls) {
    // A picture's statement-level commands are in its trace; what is left in a picture is text inside a statement.
    if (pictureStatementStarts.has(command.from)) continue;
    if (command.name === "note") {
      const firstOverlay = beamerOverlayArgumentAfter(context, command.to, frame.bodySpan.to);
      const optional = beamerOptionalArgumentAfter(context, firstOverlay?.span.to ?? command.to, frame.bodySpan.to);
      const rawSpec = firstOverlay ?? beamerOverlayArgumentAfter(context, optional?.span.to ?? command.to, frame.bodySpan.to);
      if (rawSpec) pending.push({ kind: "reference", sourceOrder: command.from, rawSpec });
      continue;
    }
    if (command.name === "frametitle" || command.name === "framesubtitle") {
      const rawSpec = beamerOverlayArgumentAfter(context, command.to, frame.bodySpan.to);
      if (rawSpec) {
        const optional = command.name === "frametitle"
          ? beamerOptionalArgumentAfter(context, rawSpec.span.to, frame.bodySpan.to)
          : null;
        const content = beamerRequiredArgumentAfter(context, optional?.span.to ?? rawSpec.span.to, frame.bodySpan.to);
        pending.push({ kind: "reference", sourceOrder: command.from, rawSpec, ...(content?.contentSpan !== undefined ? { contentSpan: content.contentSpan } : {}) });
      }
      continue;
    }
    if (command.name === "footnote") {
      const optional = beamerOptionalArgumentAfter(context, command.to, frame.bodySpan.to);
      const rawSpec = beamerOverlayArgumentAfter(context, optional?.span.to ?? command.to, frame.bodySpan.to);
      if (rawSpec) pending.push({ kind: "reference", sourceOrder: command.from, rawSpec });
      continue;
    }
    if (["label", "hypertarget", "hyperlink"].includes(command.name)) {
      const rawSpec = beamerOverlayArgumentAfter(context, command.to, frame.bodySpan.to);
      if (rawSpec) {
        const target = beamerRequiredArgumentAfter(context, rawSpec.span.to, frame.bodySpan.to);
        const content = command.name !== "label" && target
          ? beamerRequiredArgumentAfter(context, target.span.to, frame.bodySpan.to) : null;
        pending.push({ kind: "reference", sourceOrder: command.from, rawSpec, ...(content?.contentSpan !== undefined ? { contentSpan: content.contentSpan } : {}) });
      }
      continue;
    }
    // beamerbasemisc.sty: \includegraphics<spec>[opts]{file} is
    // \only<spec>{\includegraphics[opts]{file}}. The spec must follow the
    // name directly; beamer's redefinition reads a star as the filename.
    if (command.name === "includegraphics" && !command.starred) {
      const rawSpec = beamerOverlayArgumentAfter(context, command.to, frame.bodySpan.to);
      let end = rawSpec?.span.to ?? null;
      for (let optional = end === null ? null : beamerOptionalArgumentAfter(context, end, frame.bodySpan.to); optional && end !== null;
        optional = beamerOptionalArgumentAfter(context, end, frame.bodySpan.to)) end = optional.span.to;
      const file = end === null ? null : beamerRequiredArgumentAfter(context, end, frame.bodySpan.to);
      if (rawSpec && file) {
        const span = { from: command.from, to: file.span.to };
        pending.push({ kind: "command", sourceOrder: command.from, rawSpec,
          command: { kind: "only", span, commandSpan: { from: command.from, to: command.to },
            branches: [{ span, contentSpan: span, value: source.slice(span.from, span.to) }], syntaxSpans: [rawSpec.span] } });
      }
      continue;
    }
    if (OVERLAY_SWITCH_COMMANDS.has(command.name)) {
      const rawSpec = beamerOverlayArgumentAfter(context, command.to, frame.bodySpan.to);
      const parsed = rawSpec && parseOverlaySwitch(context, frame.bodySpan.to, command, rawSpec);
      if (rawSpec && parsed) pending.push({ kind: "switch", sourceOrder: command.from, switch: parsed, rawSpec });
      continue;
    }
    const overlayKind = OVERLAY_COMMANDS.get(command.name);
    if (overlayKind) {
      let commandTo = command.to;
      const visibleOnslide = command.name === "onslide" && source[commandTo] === "+";
      if (visibleOnslide) commandTo += 1;
      const kind = command.name === "onslide"
        ? command.starred ? "only" : visibleOnslide ? "visible" : "uncover"
        : overlayKind;
      const parsed = parseOverlayCommand(
        context,
        frame.bodySpan.to,
        command.from,
        commandTo,
        kind
      );
      if (parsed) {
        // Keep the authored group around covered label text. Beamer's
        // visibility wrappers interrupt shaping even on the visible step.
        const preserveLabelGroup = ["uncover", "visible", "invisible"].includes(kind) &&
          listLabelSpans.some((label) => containsSpan(label, parsed.command.span));
        const leadingItem = ["uncover", "visible", "invisible"].includes(kind)
          ? [...itemControls].reverse().find(item => {
              if (item.name !== "item" || item.to > command.from) return false;
              const overlay = beamerOverlayArgumentAfter(context, item.to, frame.bodySpan.to);
              const label = beamerOptionalArgumentAfter(context, overlay?.span.to ?? item.to, frame.bodySpan.to);
              const bodyStart = label?.span.to ?? overlay?.span.to ?? item.to;
              return bodyStart <= command.from && !source.slice(bodyStart, command.from).replace(/%[^\n]*(?:\n|$)/gu, "").trim();
            }) : undefined;
        const body = parsed.command.branches[0]?.contentSpan;
        const content = body ? source.slice(body.from, body.to) : "";
        const columns = /\\begin\s*\{columns\}/u.exec(content);
        const prefix = columns ? content.slice(0, columns.index)
          .replace(/%[^\n]*/gu, "")
          .replace(/\\color(?:\s*\[[^\]]*\])?\s*\{[^{}]*\}/gu, "")
          .replace(/\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|rmfamily|sffamily|ttfamily|bfseries|mdseries|itshape|upshape|slshape|normalfont|centering|raggedleft|raggedright)(?![A-Za-z@])/gu, "")
          .replace(/[{}\s]/gu, "") : undefined;
        const columnsPair = body && columns ? environmentPairs.find(pair => pair.begin.span.from === body.from + columns.index) : undefined;
        const tail = columnsPair && body ? source.slice(columnsPair.end.span.to, body.to)
          .replace(/%[^\n]*/gu, "").replace(/\\par(?![A-Za-z@])/gu, "").replace(/[{}\s]/gu, "") : undefined;
        // A leading columns hbox never enters the item's horizontal mode.
        // Its pending label resumes outside the visibility wrapper.
        if (leadingItem && !(prefix === "" && tail === "")) parsed.command = { ...parsed.command, leadingItemCommandSpan: { from: leadingItem.from, to: leadingItem.to } };
        pending.push({
          kind: "command",
          sourceOrder: command.from,
          command: preserveLabelGroup
            ? {
                ...parsed.command,
                syntaxSpans: overlayCommandSyntaxSpans(parsed.command.span, parsed.command.branches, true),
              }
            : parsed.command,
          rawSpec: parsed.rawSpec,
        });
      } else if (command.name === "onslide" && !command.starred) {
        const spec = beamerOverlayArgumentAfter(context, commandTo, frame.bodySpan.to);
        const syntaxTo = spec?.span.to ?? commandTo;
        // Declaration form changes covering until the next declaration. A bare
        // \onslide closes the current cover and makes following material visible.
        declarations.push({ from: command.from, syntaxTo, kind,
          spec: spec ?? { span: { from: commandTo, to: commandTo }, contentSpan: { from: commandTo, to: commandTo }, value: "1-" } });
      }
      continue;
    }
    if (command.name === "pause") {
      const optional = beamerOptionalArgumentAfter(
        context,
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
          // The optional-argument lookahead eats spaces after a bare \pause.
          // A blank line is a \par token and must survive projection.
          to: optional?.span.to ?? command.to + (/^[ \t]*(?:\n(?![ \t]*\n)[ \t]*)?/u.exec(source.slice(command.to, frame.bodySpan.to))?.[0].length ?? 0),
        },
        requestedStep: requested,
      });
      continue;
    }
    if (command.name !== "item" && command.name !== "bibitem") {
      continue;
    }
    // Beamer accepts both \item<spec>[label] and \item[label]<spec>.
    const label = beamerOptionalArgumentAfter(context, command.to, frame.bodySpan.to);
    const overlay = beamerOverlayArgumentAfter(
      context,
      label?.span.to ?? command.to,
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
  for (const [index, declaration] of declarations.entries()) {
    // overprint installs a local declaration handler; its final minipage ends
    // at the environment boundary instead of covering subsequent frame text.
    const owner = overprints.find(overprint => declaration.from >= overprint.contentSpan.from && declaration.from < overprint.contentSpan.to);
    const to = Math.min(declarations[index + 1]?.from ?? frame.bodySpan.to, owner?.contentSpan.to ?? frame.bodySpan.to);
    const contentSpan = { from: declaration.syntaxTo, to };
    pending.push({ kind: "command", sourceOrder: declaration.from, rawSpec: declaration.spec,
      command: { kind: owner ? "only" : declaration.kind, commandSpan: { from: declaration.from, to: declaration.syntaxTo },
        span: { from: declaration.from, to }, branches: [{ span: contentSpan, contentSpan, value: source.slice(contentSpan.from, contentSpan.to) }],
        syntaxSpans: [{ from: declaration.from, to: declaration.syntaxTo }], declaration: { order: 0 } } });
  }
  pending.push(...overlayEnvironmentSpecs(context, frame.bodySpan));
  const listDefaultsByOwner = new Map<typeof listRanges[number], {
    argument: NonNullable<ReturnType<typeof beamerOptionalArgumentAfter>>;
    spec: BeamerDelimitedSourceValue;
  }>();
  for (const list of listRanges) {
    const defaultArgument = beamerOptionalArgumentAfter(
      context,
      list.beginTo,
      list.contentTo
    );
    const defaultSpec = defaultArgument
      ? overlaySpecInsideOptional(defaultArgument)
      : null;
    if (!defaultSpec) {
      continue;
    }
    pending.push({ kind: "list-default", sourceOrder: list.from,
      span: { from: list.from, to: list.to }, rawSpec: defaultSpec });
    listDefaultsByOwner.set(list, { argument: requireDefined(defaultArgument, "Expected an internal overlay value"), spec: defaultSpec });
  }
  for (const list of listRanges) {
    // A nested list without an authored default retains the nearest enclosing
    // default. Keep that declaration's owner for overlay editing.
    const owner = listDefaultsByOwner.has(list) ? list : smallestContainingSpan(
      listRanges.filter(candidate => candidate !== list && listDefaultsByOwner.has(candidate)), list.from
    );
    const inherited = owner ? listDefaultsByOwner.get(owner) : undefined;
    if (!inherited || !owner) continue;
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
        overlaySpan: inherited.argument.span,
        contentSpan: {
          from: command.to,
          to: peers[index + 1]?.from ?? list.contentTo,
        },
        rawSpec: inherited.spec,
        defaultListSpan: { from: owner.from, to: owner.to },
      });
    }
  }

  pending.sort((left, right) => left.sourceOrder - right.sourceOrder);
  const commands: BeamerOverlayCommand[] = [];
  const referenceSpecs: BeamerOverlayReference[] = [];
  const items: BeamerOverlayItem[] = [];
  const listDefaults: Array<{ span: Span; spec: BeamerOverlaySpec }> = [];
  const switches: BeamerOverlaySwitch[] = [];
  const pauseStarts: Array<Omit<BeamerOverlayPause, "contentSpan">> = [];
  let pauseCounter = 1;
  let stepCount = 1;

  for (const [order, entry] of pending.entries()) {
    if (entry.kind === "pause") {
      pauseCounter = entry.requestedStep ?? pauseCounter + 1;
      pauseStarts.push({ span: entry.span, threshold: pauseCounter, order,
        ...(entry.instance ? { instance: entry.instance } : {}), ...(entry.reach ? { reach: entry.reach } : {}) });
      stepCount = Math.max(stepCount, pauseCounter);
      continue;
    }
    const resolved = resolveOverlaySpec(entry.rawSpec, pauseCounter);
    if (entry.kind === "list-default") {
      listDefaults.push({ span: entry.span, spec: resolved.spec });
      continue;
    }
    pauseCounter = resolved.nextPauseCounter;
    stepCount = Math.max(stepCount, resolved.spec.lastRequiredStep);
    if (entry.kind === "command") {
      // A loop's specification is resolved from its values; what the source says stays the authored text.
      commands.push({ ...entry.command, spec: entry.command.instance
        ? { ...resolved.spec, source: { ...resolved.spec.source, value: source.slice(entry.rawSpec.contentSpan.from, entry.rawSpec.contentSpan.to) } }
        : resolved.spec, ...(entry.command.declaration ? { declaration: { ...entry.command.declaration, order } } : {}) });
    } else if (entry.kind === "switch") {
      switches.push({ ...entry.switch, spec: resolved.spec });
    } else if (entry.kind === "reference") {
      referenceSpecs.push({ sourceStart: entry.sourceOrder, spec: resolved.spec, ...(entry.contentSpan !== undefined ? { contentSpan: entry.contentSpan } : {}) });
    } else {
      items.push({
        commandSpan: entry.commandSpan,
        listItemIndex: entry.listItemIndex,
        overlaySpan: entry.overlaySpan,
        contentSpan: entry.contentSpan,
        ...(entry.defaultListSpan ? { defaultListSpan: entry.defaultListSpan } : {}),
        spec: resolved.spec,
      });
    }
  }

  const textPauses = pauseStarts.filter(pause => !pause.reach);
  const pauses = pauseStarts.map((pause): BeamerOverlayPause => ({
    ...pause,
    contentSpan: {
      from: pause.span.to,
      // \pause is an \onslide declaration in Beamer. In text a later
      // declaration closes its cover, including a bare \onslide that restores
      // visibility; in a picture it holds to the end of its scope.
      to: pause.reach?.end ?? Math.min(textPauses[textPauses.indexOf(pause) + 1]?.span.from ?? frame.bodySpan.to,
        declarations.find(declaration => declaration.from > pause.span.from)?.from ?? frame.bodySpan.to),
    },
  }));

  return {
    frameSpan: frame.bodySpan,
    commands,
    items,
    listDefaults,
    pauses,
    referenceSpecs,
    ...(switches.length ? { switches } : {}),
    stepCount,
    ...(overprints.length ? { overprints: overprints.map(overprint => ({ ...overprint,
      branches: commands.filter(command => command.commandSpan.from >= overprint.contentSpan.from && command.commandSpan.to <= overprint.contentSpan.to && declarations.some(declaration => declaration.from === command.commandSpan.from)) })) } : {}),
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

/** Whether a command a loop performed in iteration `performed` is the one a statement of iteration `instance` answers to: its own, or that of a loop around it. */
function performedFor(performed: readonly number[] | undefined, instance: readonly number[]): boolean {
  return !performed || (performed.length <= instance.length && performed.every((value, index) => value === instance[index]));
}

/**
 * The picture-level `\pause` or `\onslide` that holds for a statement: of
 * those performed before it and still within their scope, the latest. Null
 * for a statement no such declaration reaches.
 */
export function beamerOverlayDeclarationInForce(
  model: BeamerOverlayModel,
  span: Span,
  instance: readonly number[] = []
): { readonly order: number; readonly command?: BeamerOverlayCommand; readonly pause?: BeamerOverlayPause } | null {
  /** `at` is where the declaration has taken effect: the end of its own text. */
  const holds = (reach: BeamerOverlayPictureReach | undefined, performed: readonly number[] | undefined, at: number): boolean => {
    if (!reach || span.to > reach.end) return false;
    if (!reach.loop) return at <= span.from;
    if (!containsSpan(reach.loop, span)) return !reach.scoped && span.from >= reach.loop.to;
    // In the loop: what it performed earlier, in an earlier iteration or before the statement in this one.
    const order = compareTikzOverlayInstances(performed ?? [], instance);
    return reach.scoped ? order === 0 && at <= span.from : order < 0 || (order === 0 && at <= span.from);
  };
  let latest: ReturnType<typeof beamerOverlayDeclarationInForce> = null;
  for (const command of model.commands) {
    const declaration = command.declaration;
    if (declaration && holds(declaration.reach, command.instance, command.commandSpan.to) && declaration.order > (latest?.order ?? -1)) latest = { order: declaration.order, command };
  }
  for (const pause of model.pauses) {
    if (holds(pause.reach, pause.instance, pause.span.to) && pause.order > (latest?.order ?? -1)) latest = { order: pause.order, pause };
  }
  return latest;
}

export function resolveBeamerOverlaySpanVisibility(
  model: BeamerOverlayModel,
  span: Span,
  step: number,
  /** For a statement in a picture's loop: its iteration, outermost loop first. */
  instance: readonly number[] = []
): BeamerOverlayVisibility {
  let visibility: BeamerOverlayVisibility = "visible";
  for (const reference of model.referenceSpecs) {
    if (reference.contentSpan && containsSpan(reference.contentSpan, span) &&
      !beamerOverlaySpecContains(reference.spec, step)) return "removed";
  }
  // What one command does to the span when the span is in its branch `branchIndex`.
  const apply = (command: BeamerOverlayCommand, branchIndex: number): boolean => {
    const covering = command.kind === "uncover" || command.kind === "visible" || command.kind === "invisible";
    if (selectedOverlayBranch(command, step) !== branchIndex) {
      if (!covering) return false;
      visibility = "hidden";
    } else if (covering && (command.kind === "invisible") === beamerOverlaySpecContains(command.spec, step)) {
      visibility = "hidden";
    }
    return true;
  };
  // In a picture the latest \pause or \onslide in force holds, over those before it in the text too.
  const inForce = beamerOverlayDeclarationInForce(model, span, instance);
  const superseded = (order: number) => inForce !== null && order < inForce.order;
  for (const command of model.commands) {
    if (command.declaration?.reach || (command.declaration && superseded(command.declaration.order))) continue;
    if (!performedFor(command.instance, instance)) continue;
    let branchIndex = command.branches.findIndex((branch) =>
      containsSpan(branch.contentSpan, span)
    );
    if (
      branchIndex < 0 &&
      command.branches.length === 1 &&
      containsSpan(command.span, span) &&
      command.span.from === span.from
    ) {
      branchIndex = 0;
    }
    if (branchIndex >= 0 && !apply(command, branchIndex)) return "removed";
  }
  if (inForce?.command && !apply(inForce.command, 0)) return "removed";
  if (inForce?.pause && step < inForce.pause.threshold) visibility = "hidden";
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
    if (pause.reach || superseded(pause.order)) continue;
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
  step: number,
  /** Commands (by where they start) left as written: a picture's statement-level ones, which its evaluator applies. */
  leave?: ReadonlySet<number>
): BeamerOverlayTextProjection {
  const removals: Span[] = [];
  const hidden: Span[] = [];

  for (const command of model.commands) {
    if (leave?.has(command.commandSpan.from)) continue;
    removals.push(...command.syntaxSpans);
    const selected = selectedOverlayBranch(command, step);
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
        hidden.push(requireArrayValue(command.branches, selected).contentSpan);
        if (command.leadingItemCommandSpan) hidden.push(command.leadingItemCommandSpan);
      }
    }
  }
  for (const item of model.items) {
    removals.push(item.overlaySpan);
    if (!beamerOverlaySpecContains(item.spec, step)) {
      hidden.push(item.commandSpan, item.contentSpan);
    }
  }
  for (const entry of model.switches ?? []) {
    removals.push(beamerOverlaySpecContains(entry.spec, step) ? entry.activeSyntax : entry.inactiveSyntax);
  }
  for (const pause of model.pauses) {
    if (leave?.has(pause.span.from)) continue;
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
    // TeX reads the lines around removed material as before: an `\only` alone
    // on its line does not join the lines around it into an empty one, which
    // would end the paragraph. Likewise, spaces on either side of an inline
    // macro remain separate glue tokens. An empty group retains the boundary.
    const before = parts.at(-1)?.text ?? "";
    const after = mapped.text.slice(Math.max(0, removal.to - sourceSpan.from));
    if ((/[ \t]$/u.test(before) && /^[ \t]/u.test(after)) || (/\n[ \t]*$/u.test(before) && /^[ \t]*\n/u.test(after) && !/\n[ \t]*\n[ \t]*$/u.test(before) && !/^[ \t]*\n[ \t]*\n/u.test(after))) {
      parts.push(createGeneratedMappedText("{}", "removed overlay material", { from: removal.from, to: removal.to }));
    }
    cursor = Math.max(cursor, removal.to);
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
  };
}

/** How many brace bodies an overlay command takes. */
function overlayBranchCount(kind: BeamerOverlayCommandKind): number {
  return kind === "alt" ? 2 : kind === "temporal" ? 3 : 1;
}

function parseOverlayCommand(
  context: BeamerSyntaxContext,
  limit: number,
  commandFrom: number,
  commandTo: number,
  kind: BeamerOverlayCommandKind
): {
  command: Omit<BeamerOverlayCommand, "spec">;
  rawSpec: BeamerDelimitedSourceValue;
} | null {
  let cursor = commandTo;
  let spec = beamerOverlayArgumentAfter(context, cursor, limit);
  if (spec) {
    cursor = spec.span.to;
  }
  const branchCount = overlayBranchCount(kind);
  const branches: BeamerDelimitedSourceValue[] = [];
  for (let index = 0; index < branchCount; index += 1) {
    const branch = beamerRequiredArgumentAfter(context, cursor, limit);
    if (!branch) {
      return null;
    }
    branches.push(branch);
    cursor = branch.span.to;
  }
  if (!spec) {
    spec = beamerOverlayArgumentAfter(context, cursor, limit);
    if (spec) cursor = spec.span.to;
    else spec = { span: { from: commandTo, to: commandTo },
      contentSpan: { from: commandTo, to: commandTo }, value: "1-" };
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

function parseOverlaySwitch(
  context: BeamerSyntaxContext,
  limit: number,
  command: Span & { readonly name: string },
  spec: BeamerDelimitedSourceValue
): Omit<BeamerOverlaySwitch, "spec"> | null {
  let first: Span;
  let inactiveTo: number;
  if (command.name === "color" || command.name === "textcolor") {
    const model = beamerOptionalArgumentAfter(context, spec.span.to, limit);
    const color = beamerRequiredArgumentAfter(context, model?.span.to ?? spec.span.to, limit);
    if (!color) return null;
    first = model?.span ?? color.span;
    if (command.name === "color") {
      // The gobbled color ends with \ignorespaces: a line's spaces, never a blank line.
      inactiveTo = color.span.to + (/^[ \t]*(?:\n(?![ \t]*\n)[ \t]*)?/u.exec(context.source.slice(color.span.to, limit))?.[0].length ?? 0);
    } else {
      const text = beamerRequiredArgumentAfter(context, color.span.to, limit);
      if (!text) return null;
      inactiveTo = text.span.from;
    }
  } else {
    const text = beamerRequiredArgumentAfter(context, spec.span.to, limit);
    if (!text) return null;
    first = text.span;
    inactiveTo = text.span.from;
  }
  return {
    commandSpan: { from: command.from, to: command.to },
    activeSyntax: { from: spec.span.from, to: first.from },
    inactiveSyntax: { from: command.from, to: inactiveTo },
  };
}

function overlayCommandSyntaxSpans(
  span: Span,
  branches: readonly BeamerDelimitedSourceValue[],
  preserveGroups = false
): Span[] {
  const result: Span[] = [];
  let cursor = span.from;
  for (const branch of branches) {
    const branchStart = preserveGroups ? branch.span.from : branch.contentSpan.from;
    if (cursor < branchStart) {
      result.push({ from: cursor, to: branchStart });
    }
    cursor = preserveGroups ? branch.span.to : branch.contentSpan.to;
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
  // Beamer's mode alternatives are separated by `|`, not comma. A handout
  // selector must never contaminate the presentation overlay numbers.
  const presentation = source.value.split("|").flatMap(part => {
    const mode = /^\s*([A-Za-z]+)\s*:\s*([\s\S]*)$/u.exec(part);
    return mode ? ["presentation", "beamer", "all"].includes(requireArrayValue(mode, 1)) ? [mode[2]] : [] : [part];
  }).join(",");
  const sawPlus = [...presentation.matchAll(/([+.])(?:\(([-+]?\d+)\))?/gu)].some(match => match[1] === "+");
  const resolved = presentation
    .replace(/([+.])(?:\(([-+]?\d+)\))?/gu, (_whole, symbol, offsetRaw) => {
      const offset = Number(offsetRaw ?? 0);
      if (symbol === "+") {
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
  context: BeamerSyntaxContext,
  span: Span
): Array<Span & {
  readonly beginTo: number;
  readonly contentTo: number;
}> {
  const tokens = beamerEnvironmentBoundariesIn(context, span);
  const stack: Array<{ name: string; from: number; beginTo: number }> = [];
  const result: Array<Span & { beginTo: number; contentTo: number }> = [];
  for (const token of tokens) {
    if (
      token.name !== "itemize" &&
      token.name !== "enumerate" &&
      token.name !== "description" &&
      token.name !== "thebibliography"
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
  context: BeamerSyntaxContext,
  span: Span
): PendingSpec[] {
  const { source } = context;
  const kindByName = new Map<string, BeamerOverlayCommandKind>([
    ["onlyenv", "only"],
    ["uncoverenv", "uncover"],
    ["visibleenv", "visible"],
    ["invisibleenv", "invisible"],
  ]);
  const tokens = beamerEnvironmentBoundariesIn(context, span);
  const result: PendingSpec[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const begin = tokens[index];
    const explicitKind = begin?.kind === "begin"
      ? kindByName.get(begin.name)
      : undefined;
    if (begin?.kind !== "begin") {
      continue;
    }
    let depth = 0;
    let endIndex = -1;
    for (let candidate = index; candidate < tokens.length; candidate += 1) {
      const token = requireArrayValue(tokens, candidate);
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
    const spec = beamerOverlayArgumentAfter(
      context,
      begin.span.to,
      end?.span.from ?? span.to
    );
    const kind = explicitKind ?? (spec ? "uncover" : undefined);
    if (!end || !spec || !kind) {
      continue;
    }
    const commandSpan = { from: begin.span.from, to: begin.span.to };
    if (explicitKind) {
      // Wrapper environments (onlyenv & friends) exist only to carry the
      // spec: their begin/end are overlay syntax and the body is the branch.
      const body: BeamerDelimitedSourceValue = {
        span: { from: spec.span.to, to: end.span.from },
        contentSpan: { from: spec.span.to, to: end.span.from },
        value: source.slice(spec.span.to, end.span.from),
      };
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
    } else {
      // A content environment with an action spec (`\begin{block}<2->`)
      // keeps its structure: only the spec is overlay syntax, and the whole
      // environment uncovers as one unit (space reserved while covered).
      const body: BeamerDelimitedSourceValue = {
        span: { from: begin.span.from, to: end.span.to },
        contentSpan: { from: begin.span.from, to: end.span.to },
        value: source.slice(begin.span.from, end.span.to),
      };
      result.push({
        kind: "command",
        sourceOrder: begin.span.from,
        rawSpec: spec,
        command: {
          kind,
          span: { from: begin.span.from, to: end.span.to },
          commandSpan,
          branches: [body],
          syntaxSpans: [spec.span],
        },
      });
    }
    // Nested environments can have independent overlay rules. Keep scanning
    // their boundaries, including when their parent has its own spec.
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

/**
 * Project without changing offsets: scene/edit spans still address authored
 * source. Commands in `leave` stay as written.
 */
export function projectBeamerTikzSource(source: string, span: Span, model: BeamerOverlayModel, step: number, leave?: ReadonlySet<number>): string {
  const projected = projectBeamerOverlayText(createIdentityMappedText(source.slice(span.from, span.to), span.from), span, model, step, leave).mapped;
  const characters = source.slice(span.from, span.to).replace(/[^\n]/g, " ").split("");
  for (let index = 0; index < projected.text.length; index++) {
    const origin = projected.sourceMap.charOrigins[index];
    if (origin?.kind === "direct" && origin.from >= span.from && origin.from < span.to) characters[origin.from - span.from] = projected.text.charAt(index);
  }
  return source.slice(0, span.from) + characters.join("") + source.slice(span.to);
}
