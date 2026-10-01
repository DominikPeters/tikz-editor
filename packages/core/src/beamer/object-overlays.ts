import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import { beamerBuildSpecPatch, canEditBeamerBuildTiming, isExplicitBeamerBuildSpec, type BeamerBuildModel, type BeamerBuildRow } from "./builds.js";
import type { BeamerObjectNode } from "./object-index.js";
import { createBeamerSyntaxContext } from "./syntax.js";

export type BeamerObjectOverlayTarget = {
  /** The rule to reveal, including a shared owner when direct editing is unavailable. */
  row: BeamerBuildRow | null;
  canSet: boolean;
  removePatches: readonly SourcePatch[];
  setSpec: (spec: string) => SourcePatch | null;
};

const contains = (outer: Span, inner: Span) => outer.from <= inner.from && outer.to >= inner.to;
const same = (a: Span, b: Span) => a.from === b.from && a.to === b.to;
const patch = (span: Span, replacement: string): SourcePatch => ({
  oldSpan: span, newSpan: { from: span.from, to: span.from + replacement.length }, replacement,
});

/** Resolve one rendered object back to its authored overlay owner. Never retime a shared owner. */
export function beamerObjectOverlayTarget(model: BeamerBuildModel, node: BeamerObjectNode): BeamerObjectOverlayTarget {
  const { source } = model;
  const syntax = createBeamerSyntaxContext(source);
  const trivia = (span: Span) => source.slice(span.from, span.to).replace(/(?<!\\)%[^\n]*/gu, "").trim() === "";
  const wrapsOnlyObject = (row: BeamerBuildRow) => row.command?.branches.length === 1 && row.contentSpans.some((span) =>
    contains(span, node.sourceSpan) && trivia({ from: span.from, to: node.sourceSpan.from }) && trivia({ from: node.sourceSpan.to, to: span.to }));
  const owners = model.rows.filter((row) => row.kind !== "branch" && row.kind !== "list" &&
    (contains(row.sourceSpan, node.sourceSpan) || (row.kind === "unsupported" && row.sourceSpan.from === node.sourceSpan.from)))
    .sort((a, b) => (a.sourceSpan.to - a.sourceSpan.from) - (b.sourceSpan.to - b.sourceSpan.from));
  const nativeRule = (row: BeamerBuildRow) => same(row.sourceSpan, node.sourceSpan) || (node.kind === "item" && row.id === `item:${node.sourceSpan.from}`);
  const own = owners.find((row) => row.provenance !== "list-default" && (nativeRule(row) || wrapsOnlyObject(row))) ?? null;
  const inherited = owners.find((row) => row !== own);
  const row = own ?? owners[0] ?? null;
  const supported = ["block", "item", "graphics", "tikzpicture"].includes(node.kind);
  // Changing a relative item spec changes the + counter for following items. Shared
  // and stateful rules are edited at their owner instead of being overridden here.
  const precedingStateful = model.rows.some((candidate) => candidate.kind === "unsupported" && candidate.contentSpans.length === 0 && candidate.sourceSpan.from < node.sourceSpan.from);
  const canSet = supported && !inherited && !precedingStateful && (!own || canEditBeamerBuildTiming(own));
  const relativeDefault = node.kind === "item" && model.rows.some((candidate) => candidate.kind === "list" && !candidate.editable && contains(candidate.sourceSpan, node.sourceSpan));
  let removePatches: SourcePatch[] = [];
  if (own && canEditBeamerBuildTiming(own) && own.spec && !relativeDefault) {
    if (nativeRule(own)) {
      removePatches = [patch(own.spec.source.span, "")];
    } else if (own.command) {
      const command = own.command;
      const branch = command.branches[0];
      const spans = [command.commandSpan, own.spec.source.span];
      if (source.slice(command.commandSpan.from, command.commandSpan.to).startsWith("\\begin")) {
        spans.push({ from: branch.contentSpan.to, to: command.span.to });
      } else {
        spans.push({ from: branch.span.from, to: branch.contentSpan.from }, { from: branch.contentSpan.to, to: branch.span.to });
      }
      // Keep comments and spacing between the wrapper's tokens.
      let delta = 0;
      removePatches = spans.sort((a, b) => a.from - b.from).map((span) => {
        const result = patch(span, "");
        result.newSpan = { from: span.from + delta, to: span.from + delta };
        delta -= span.to - span.from;
        return result;
      });
    }
  }
  return { row, canSet, removePatches, setSpec: (spec) => {
    if (!canSet || !isExplicitBeamerBuildSpec(spec)) return null;
    if (own) return beamerBuildSpecPatch(model, own.id, spec);
    if (node.kind === "item") {
      const anchor = node.sourceSpan.from + "\\item".length;
      return patch({ from: anchor, to: anchor }, `<${spec}>`);
    }
    if (node.kind === "block") {
      const begin = syntax.syntax.environmentBoundariesIn(node.sourceSpan).find((entry) => entry.kind === "begin" && entry.span.from === node.sourceSpan.from);
      return begin ? patch({ from: begin.span.to, to: begin.span.to }, `<${spec}>`) : null;
    }
    return patch(node.sourceSpan, `\\uncover<${spec}>{${source.slice(node.sourceSpan.from, node.sourceSpan.to)}}`);
  } };
}
