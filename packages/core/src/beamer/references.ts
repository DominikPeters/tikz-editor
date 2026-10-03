import type { ResolvedBeamerTheme } from "./theme/types.js";
import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import {
  concatMappedText, createGeneratedMappedText, projectInputRange, sliceMappedText,
  type MappedText,
} from "../text/source-map.js";
import type { ParagraphLayoutReport } from "../text/knuth-plass/paragraph/report.js";
import type { TexVListLayout } from "../text/tex/vlist/types.js";
import { getTexSyntaxIndex, matchTexSyntaxEnvironments, type TexSyntaxIndex } from "../text/tex/syntax-index.js";
import { beamerDocumentParser } from "@tikz-editor/lezer-tex";
import {
  beamerOverlaySpecContains, resolveBeamerOverlaySpanVisibility,
  type BeamerOverlayModel, type BeamerOverlaySpec,
} from "./overlay.js";
import type { BeamerDocumentModel, BeamerRect } from "./types.js";
import type { BeamerFootnoteIndex } from "./footnotes.js";
import type { TexTabularRegisters } from "../text/tex/tabular/types.js";
import type { BeamerContinuationBreaks } from "./continuations.js";

export type BeamerLinkDestination =
  | { kind: "frame"; frameId: string; step: number }
  | { kind: "external"; url: string };

export type BeamerLinkRegion = {
  /** Bounds relative to the containing paragraph. */
  bounds: BeamerRect;
  destination: BeamerLinkDestination;
  label: string;
};

type CitationEntry = { label: string; destination: BeamerLinkDestination };
export type BeamerReferenceIndex = {
  source: string;
  resolveTarget: (name: string) => BeamerLinkDestination | undefined;
  citations: ReadonlyMap<string, CitationEntry>;
  /** Values written by LaTeX's numbered equation environments. */
  equationLabels?: ReadonlyMap<string, string>;
  /** Document-wide automatic tag values, keyed by equation begin offset. */
  equationNumbers?: ReadonlyMap<number, string>;
  specs: ReadonlyMap<number, BeamerOverlaySpec>;
  diagnostics: readonly Diagnostic[];
};

export type BeamerReferenceContext = BeamerReferenceIndex & {
  arrayPackage?: boolean;
  tableRegisters?: TexTabularRegisters;
  step: number;
  footnotes?: BeamerFootnoteIndex;
  continuationBreaks?: BeamerContinuationBreaks;
  theme?: ResolvedBeamerTheme;
  /** Owned by the current render; the prepared document index stays immutable. */
  renderDiagnostics: Diagnostic[];
};

/** Beamer's frame labels also define label<1>, label<2>, ... destinations. */
export function buildBeamerReferenceIndex(
  document: BeamerDocumentModel,
  syntax: TexSyntaxIndex,
  overlaysByFrameId: ReadonlyMap<string, BeamerOverlayModel>
): BeamerReferenceIndex {
  const targets = new Map<string, { destination: BeamerLinkDestination; sourceStart: number }>();
  const frameTargets = new Map<string, { frameId: string; stepCount: number; sourceStart: number }[]>();
  const resolveTarget = (name: string): BeamerLinkDestination | undefined => {
    const explicit = targets.get(name);
    const alias = /^(.*)<([1-9]\d*)>$/u.exec(name);
    const step = alias ? Number(alias[2]) : 0;
    const frame = alias && Number.isSafeInteger(step)
      ? frameTargets.get(alias[1])?.find((entry) => step <= entry.stepCount) : undefined;
    if (!frame || (explicit && explicit.sourceStart < frame.sourceStart)) return explicit?.destination;
    return { kind: "frame", frameId: frame.frameId, step };
  };
  const citations = new Map<string, CitationEntry>();
  const equationLabels = new Map<string, string>();
  const equationNumbers = new Map<number, string>();
  let equationNumber = 0;
  const specs = new Map<number, BeamerOverlaySpec>();
  const diagnostics: Diagnostic[] = [];
  const source = syntax.source;
  const environments = [...matchTexSyntaxEnvironments(syntax).values()];
  const bibliographies = environments.filter((env) => env.name === "thebibliography");
  const addTarget = (name: string, destination: BeamerLinkDestination, span: Span) => {
    if (!name) return;
    if (resolveTarget(name)) {
      diagnostics.push({ severity: "warning", code: "beamer-duplicate-target", message: `Duplicate link target '${name}'; the first destination is used.`, span });
    } else targets.set(name, { destination, sourceStart: span.from });
  };
  for (const frame of document.frames) {
    for (const env of environments.filter(env => ["equation", "equation*"].includes(env.name) && frame.bodySpan.from <= env.span.from && env.span.to <= frame.bodySpan.to).sort((a, b) => a.span.from - b.span.from)) {
      const commands = syntax.controlsIn(env.contentSpan);
      const tag = commands.find(command => command.name === "tag");
      const tagArgument = tag && syntax.argumentAfter(tag.span.to, "required", env.contentSpan.to);
      const suppressed = commands.some(command => command.name === "notag" || command.name === "nonumber");
      const value = tagArgument?.complete ? source.slice(tagArgument.contentSpan.from, tagArgument.contentSpan.to) :
        env.name === "equation" && !suppressed ? String(++equationNumber) : undefined;
      if (value == null) continue;
      if (!tagArgument) equationNumbers.set(env.span.from, value);
      for (const command of syntax.controlsIn(env.contentSpan)) {
        if (command.name !== "label") continue;
        const argument = syntax.argumentAfter(command.span.to, "required", env.contentSpan.to);
        if (argument?.complete) equationLabels.set(source.slice(argument.contentSpan.from, argument.contentSpan.to).trim(), value);
      }
    }
    const overlays = overlaysByFrameId.get(frame.id)!;
    const visibilitySteps = overlayVisibilitySteps(overlays);
    for (const entry of overlays.referenceSpecs) specs.set(entry.sourceStart, entry.spec);
    const destination = (step: number): BeamerLinkDestination => ({ kind: "frame", frameId: frame.id, step });
    const frameLabel = frame.options?.label;
    if (frameLabel) {
      addTarget(frameLabel, destination(1), frame.span);
      // A frame may have millions of overlay steps while the user edits a spec.
      // Store one range per frame and resolve label<N> only when it is used.
      const ranges = frameTargets.get(frameLabel) ?? [];
      ranges.push({ frameId: frame.id, stepCount: overlays.stepCount, sourceStart: frame.span.from });
      frameTargets.set(frameLabel, ranges);
    }
    const counters = new Map<number, number>();
    for (const command of syntax.controlsIn(frame.bodySpan)) {
      if (!["label", "hypertarget", "bibitem"].includes(command.name)) continue;
      const overlay = syntax.argumentAfter(command.span.to, "overlay", frame.bodySpan.to);
      let cursor = overlay?.span.to ?? command.span.to;
      const optional = command.name === "bibitem" ? syntax.argumentAfter(cursor, "optional", frame.bodySpan.to) : null;
      cursor = optional?.span.to ?? cursor;
      const argument = syntax.argumentAfter(cursor, "required", frame.bodySpan.to);
      if (!argument?.complete) continue;
      const key = source.slice(argument.contentSpan.from, argument.contentSpan.to).trim();
      const spec = specs.get(command.span.from);
      // Respect enclosing \only, \uncover, pauses, and bibliography item overlays.
      const firstVisible = visibilitySteps.find((step) =>
        (spec ? beamerOverlaySpecContains(spec, step) : command.name !== "label" || step === 1) &&
        resolveBeamerOverlaySpanVisibility(overlays, command.span, step) === "visible"
      );
      if (firstVisible == null) continue;
      if (command.name !== "bibitem") {
        addTarget(key, destination(firstVisible), command.span);
        continue;
      }
      const bibliography = bibliographies.find((env) => env.contentSpan.from <= command.span.from && command.span.to <= env.contentSpan.to);
      if (!bibliography) continue;
      // An explicit label does not advance LaTeX's enumiv counter.
      const count = counters.get(bibliography.span.from) ?? 0;
      const label = optional
        ? source.slice(optional.contentSpan.from, optional.contentSpan.to)
        : String(count + 1);
      if (!optional) counters.set(bibliography.span.from, count + 1);
      if (citations.has(key)) {
        diagnostics.push({ severity: "warning", code: "beamer-duplicate-citation", message: `Duplicate bibliography key '${key}'; the first entry is used.`, span: command.span });
      } else citations.set(key, { label, destination: destination(firstVisible) });
      addTarget(`beamerbib${key}`, destination(firstVisible), command.span);
    }
  }
  return { source, resolveTarget, citations, equationLabels, equationNumbers, specs, diagnostics };
}

/** Visibility is constant between interval boundaries, regardless of step count. */
function overlayVisibilitySteps(model: BeamerOverlayModel): number[] {
  const steps = new Set([1]);
  const add = (step: number) => {
    if (Number.isSafeInteger(step) && step >= 1 && step <= model.stepCount) steps.add(step);
  };
  for (const { spec } of [...model.commands, ...model.items, ...model.referenceSpecs]) {
    for (const interval of spec.intervals) {
      add(interval.from);
      if (interval.to != null) add(interval.to + 1);
    }
  }
  for (const pause of model.pauses) add(pause.threshold);
  return [...steps].sort((a, b) => a - b);
}

type LinkSpan = { span: Span; destination: BeamerLinkDestination; label: string };
export type BeamerBibliographyStyle = {
  marginEm: number;
  label: (label: string) => string;
  author: string;
  title: string;
  location: string;
  note: string;
};
export type BeamerReferenceProjection = {
  mapped: MappedText; links: LinkSpan[]; bibliography: boolean;
  bibliographyMargins?: ReadonlyMap<number, number>;
};

/**
 * Lower document references into native text/list primitives. Authored link
 * text keeps its exact source mapping; generated citation labels belong to the
 * original citation command. Link spans use the resulting layout coordinates,
 * so two keys in one citation remain independently clickable.
 */
export function projectBeamerReferences(mapped: MappedText, context: BeamerReferenceContext, bibliographyStyle?: (widestLabel: string, sourceStart: number) => BeamerBibliographyStyle): BeamerReferenceProjection {
  if (!/\\(?:hyperlink|hyperref|hypertarget|href|url|label|ref|eqref|cite|bibitem|newblock|beamer(?:goto|return|skip)?button|begin)(?![A-Za-z@])/u.test(mapped.text)) {
    return { mapped, links: [], bibliography: false };
  }
  const syntax = getTexSyntaxIndex(mapped.text, beamerDocumentParser);
  const environments = [...matchTexSyntaxEnvironments(syntax).values()];
  const bibliographies = new Map(environments.filter((env) => env.name === "thebibliography").map((env) => [env.span.from, env]));
  const equations = new Map(environments.filter(env => env.name === "equation").map(env => [env.span.from, env]));
  const parts: MappedText[] = [];
  const links: LinkSpan[] = [];
  let length = 0;
  let bibliography = false;
  const bibliographyMargins = new Map<number, number>();
  let activeBibliography: BeamerBibliographyStyle | undefined;
  let entryBlock = 0;
  const sourceSpan = (span: Span): Span | undefined => {
    const hit = projectInputRange(mapped.sourceMap, span.from, span.to);
    return hit.kind === "source-range" ? { from: hit.from, to: hit.to } : undefined;
  };
  const append = (part: MappedText) => { parts.push(part); length += part.text.length; };
  const generated = (text: string, owner: Span) => {
    append(createGeneratedMappedText(text, "Beamer reference", sourceSpan(owner)));
  };
  const raw = (span: Span) => mapped.text.slice(span.from, span.to);
  const warn = (code: string, message: string, span: Span) => {
    const projected = sourceSpan(span);
    if (!projected) return;
    if (!context.renderDiagnostics.some((entry) => entry.code === code && entry.span?.from === projected?.from && entry.message === message)) {
      context.renderDiagnostics.push({ severity: "warning", code, message, span: projected });
    }
  };
  const target = (key: string, span: Span): BeamerLinkDestination | undefined => {
    const found = context.resolveTarget(key);
    if (!found) warn("beamer-unresolved-link", `Unknown link target '${key}'.`, span);
    return found;
  };
  const visit = (from: number, to: number, depth = 0): void => {
    if (depth > 64) { append(sliceMappedText(mapped, from, to)); return; }
    let cursor = from;
    for (const command of syntax.controlsIn({ from, to })) {
      if (command.span.from < cursor) continue;
      const env = bibliographies.get(command.span.from);
      const equation = equations.get(command.span.from);
      const equationOwner = equation && sourceSpan(equation.begin.span);
      const equationNumber = equationOwner && context.equationNumbers?.get(equationOwner.from);
      if (equation && equationNumber && equation.span.to <= to) {
        append(sliceMappedText(mapped, cursor, equation.contentSpan.from));
        visit(equation.contentSpan.from, equation.contentSpan.to, depth + 1);
        generated(`\\tag{${equationNumber}}`, equation.end.span);
        append(sliceMappedText(mapped, equation.end.span.from, equation.end.span.to));
        cursor = equation.span.to;
        continue;
      }
      if (env && env.span.to <= to) {
        const width = syntax.argumentAfter(env.begin.span.to, "required", env.end.span.from);
        if (!width?.complete) continue;
        append(sliceMappedText(mapped, cursor, command.span.from));
        bibliography = true;
        const previous = activeBibliography;
        activeBibliography = bibliographyStyle?.(raw(width.contentSpan), sourceSpan(env.begin.span)?.from ?? 0);
        if (activeBibliography) bibliographyMargins.set(length, activeBibliography.marginEm);
        generated("\\begin{bibliography}", { from: env.begin.span.from, to: width.span.to });
        visit(width.span.to, env.end.span.from, depth + 1);
        generated("\\end{bibliography}", env.end.span);
        activeBibliography = previous;
        cursor = env.span.to;
        continue;
      }
      if (command.name === "setbeamertemplate") {
        const role = syntax.argumentAfter(command.span.to, "required", to);
        const option = role && syntax.argumentAfter(role.span.to, "optional", to);
        if (role && option && raw(role.contentSpan).trim() === "bibliography item") {
          append(sliceMappedText(mapped, cursor, command.span.from));
          cursor = option.span.to;
          continue;
        }
      }
      if (command.name === "newblock") {
        append(sliceMappedText(mapped, cursor, command.span.from));
        entryBlock += 1;
        const style = activeBibliography;
        const declaration = entryBlock === 1 ? style?.title : entryBlock === 2 ? style?.location : style?.note;
        generated(`\\par ${declaration ?? ""}`, command.span);
        cursor = command.span.to;
        continue;
      }
      const names = ["hyperlink", "hyperref", "href", "url", "hypertarget", "label", "ref", "eqref", "cite", "bibitem", "beamerbutton", "beamergotobutton", "beamerreturnbutton", "beamerskipbutton"];
      if (!names.includes(command.name)) continue;
      const overlay = syntax.argumentAfter(command.span.to, "overlay", to);
      let argumentStart = overlay?.span.to ?? command.span.to;
      const optional = ["hyperref", "cite", "bibitem"].includes(command.name) ? syntax.argumentAfter(argumentStart, "optional", to) : null;
      argumentStart = optional?.span.to ?? argumentStart;
      const first = syntax.argumentAfter(argumentStart, "required", to);
      if (!first?.complete || (command.name === "hyperref" && !optional?.complete)) continue;
      const second = ["hyperlink", "href", "hypertarget"].includes(command.name) ? syntax.argumentAfter(first.span.to, "required", to) : null;
      if (["hyperlink", "href", "hypertarget"].includes(command.name) && !second?.complete) continue;
      if (command.name === "bibitem" && !environments.some((candidate) => candidate.name === "thebibliography" && candidate.contentSpan.from <= command.span.from && command.span.to <= candidate.contentSpan.to)) continue;
      const invocation = { from: command.span.from, to: second?.span.to ?? first.span.to };
      append(sliceMappedText(mapped, cursor, command.span.from));
      const original = sourceSpan(command.span);
      const spec = original ? context.specs.get(original.from) : undefined;
      const active = !spec || beamerOverlaySpecContains(spec, context.step);
      const key = raw(first.contentSpan).trim();
      if (command.name === "label") {
        // Labels have no typeset content.
      } else if (command.name === "ref" || command.name === "eqref") {
        const value = context.equationLabels?.get(key);
        const start = length;
        generated(command.name === "eqref" ? `\\textnormal{(${value ?? "??"})}` : value ?? "??", invocation);
        const destination = value ? context.resolveTarget(key) : undefined;
        if (destination) links.push({ span: { from: start, to: length }, destination, label: key });
        if (!value) warn("beamer-unresolved-reference", `Unknown numeric reference '${key}'.`, invocation);
      } else if (command.name === "bibitem") {
        const label = context.citations.get(key)?.label ?? "?";
        entryBlock = 0;
        generated(`\\item[{${activeBibliography?.label(label) ?? `\\textnormal{[${label}]}`}}]${activeBibliography?.author ?? ""}`, invocation);
        // \bibitem ends with \ignorespaces; the zero-width author strut
        // has already entered horizontal mode.
        while (/\s/u.test(mapped.text[invocation.to] ?? "") && invocation.to < to) invocation.to += 1;
      } else if (command.name === "cite") {
        generated("[", invocation);
        key.split(",").forEach((entryKey, index) => {
          if (index) generated(", ", invocation);
          const entry = context.citations.get(entryKey.trim());
          const start = length;
          generated(`{${entry?.label ?? "?"}}`, invocation);
          if (entry) links.push({ span: { from: start, to: length }, destination: entry.destination, label: `Citation ${entryKey.trim()}` });
          else warn("beamer-unresolved-citation", `Unknown bibliography key '${entryKey.trim()}'.`, invocation);
        });
        if (optional) { generated(", ", invocation); visit(optional.contentSpan.from, optional.contentSpan.to, depth + 1); }
        generated("]", invocation);
      } else if (command.name === "hypertarget") {
        if (active && second) { generated("{", invocation); visit(second.contentSpan.from, second.contentSpan.to, depth + 1); generated("}", invocation); }
      } else if (command.name.endsWith("button")) {
        generated("\\fbox{", invocation);
        visit(first.contentSpan.from, first.contentSpan.to, depth + 1);
        generated("}", invocation);
      } else if (command.name !== "hyperlink" || active) {
        const content = second?.contentSpan ?? first.contentSpan;
        const destination = command.name === "href" || command.name === "url"
          ? (/^(?:https?:|mailto:)/iu.test(key) ? { kind: "external" as const, url: key } : undefined)
          : target(command.name === "hyperref" && optional ? raw(optional.contentSpan).trim() : key, invocation);
        if (!destination && (command.name === "href" || command.name === "url")) warn("beamer-unsupported-link-url", "Only http, https, and mailto links can be opened.", invocation);
        generated("{", invocation);
        const start = length;
        if (command.name === "url") {
          generated("\\texttt{", invocation);
          // URL punctuation is literal, not TeX math/alignment syntax.
          generated(raw(content).replace(/[\\{}%#$&_~^]/gu, (char) => ({ "\\": "\\textbackslash{}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" })[char] ?? `\\${char}`), invocation);
          generated("}", invocation);
        } else visit(content.from, content.to, depth + 1);
        if (destination && active) links.push({ span: { from: start, to: length }, destination, label: key });
        generated("}", invocation);
      }
      cursor = invocation.to;
    }
    append(sliceMappedText(mapped, cursor, to));
  };
  visit(0, mapped.text.length);
  return { mapped: concatMappedText(parts), links, bibliography, bibliographyMargins };
}

/** Keep every wrapped line separately clickable; never cover neighboring prose. */
export function layoutBeamerLinks(
  projection: BeamerReferenceProjection,
  report: ParagraphLayoutReport<"layout">,
  layout: TexVListLayout<"layout">,
  hiddenSpans: readonly Span[]
): BeamerLinkRegion[] {
  const regions: BeamerLinkRegion[] = [];
  const placements = new Map(layout.linePlacements.map((entry) => [entry.lineIndex, entry]));
  for (const link of projection.links) {
    for (const line of report.lines) {
      const placement = placements.get(line.lineIndex);
      if (!placement) continue;
      const lineRegions: BeamerLinkRegion[] = [];
      for (const segment of line.segments) {
        const start = segment.sourceStartRaw;
        const end = segment.sourceEndRaw;
        if (start == null || end == null || start >= link.span.to || end <= link.span.from || segment.width <= 0) continue;
        const hit = projectInputRange(projection.mapped.sourceMap, start, end);
        if (hit.kind === "source-range" && hiddenSpans.some((hidden) => hidden.from <= hit.from && hit.to <= hidden.to)) continue;
        const offset = line.segments.some((entry) => entry.role === "list-label") ? 0 : Math.max(0, placement.x - line.xStart);
        const bounds = { x: segment.x + offset, y: placement.y, width: segment.width, height: line.ascent + line.descent };
        const previous = lineRegions.at(-1);
        if (previous && Math.abs(previous.bounds.x + previous.bounds.width - bounds.x) < 0.01) {
          previous.bounds.width = bounds.x + bounds.width - previous.bounds.x;
          continue;
        }
        lineRegions.push({
          bounds,
          destination: link.destination,
          label: link.label,
        });
      }
      regions.push(...lineRegions);
    }
  }
  return regions;
}
