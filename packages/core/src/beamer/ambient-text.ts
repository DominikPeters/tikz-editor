import type { Span } from "../ast/types.js";
import { matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import { beamerControlSequencesIn, beamerRequiredArgumentAfter, beamerOptionalArgumentAfter, beamerOverlayArgumentAfter, createBeamerSyntaxContext } from "./syntax.js";

const declarations = new Set("tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge rmfamily sffamily ttfamily bfseries mdseries itshape upshape slshape normalfont centering raggedleft raggedright".split(" "));

/** Formatting declarations still active at a structural split. The generic
 * paragraph frontend executes them itself when no split occurs. */
export function createBeamerAmbientText(source: string, executesItem: (span: Span) => boolean) {
  const context = createBeamerSyntaxContext(source);
  const environments = [...matchTexSyntaxEnvironments(context.syntax).values()]
    .sort((left, right) => left.begin.span.from - right.begin.span.from);
  const controls = beamerControlSequencesIn(context, { from: 0, to: source.length });
  const storedOptions = new Set(environments.filter(env => env.name === "tcolorbox").flatMap(env => {
    const options = beamerOptionalArgumentAfter(context, env.begin.span.to, source.length);
    return options ? [options.span.from] : [];
  }));
  const events = controls.flatMap(command => {
    if (!declarations.has(command.name) && command.name !== "color") return [];
    let to = command.to;
    if (command.name === "color") {
      const optional = beamerOptionalArgumentAfter(context, to, source.length);
      const color = beamerRequiredArgumentAfter(context, optional?.span.to ?? to, source.length);
      if (!color) return [];
      to = color.span.to;
    }
    let end = source.length;
    let node = context.syntax.tree.resolveInner(command.from + 1, 1);
    while (node.parent) {
      node = node.parent;
      // tcolorbox stores fonttitle/fontupper options for separate saveboxes.
      // Ordinary square brackets in prose do not create TeX groups.
      if (node.name === "Group" || node.name === "Environment" ||
          node.name === "OptionalArgument" && storedOptions.has(node.from)) end = Math.min(end, node.to);
    }
    return [{ from: command.from, to, end, text: source.slice(command.from, to) }];
  });
  for (const env of environments) {
    if (!["column", "block", "alertblock", "exampleblock"].includes(env.name)) continue;
    events.push({ from: env.begin.span.from, to: env.begin.span.to, end: env.end.span.to, text: "\\raggedright" });
  }
  const lists = environments.filter(env => ["itemize", "enumerate"].includes(env.name));
  const enumerations = lists.filter(env => env.name === "enumerate");
  for (const env of lists) {
    const depth = lists.filter(parent => parent.begin.span.from < env.begin.span.from && env.end.span.to < parent.end.span.to).length;
    if (depth > 0) events.push({ from: env.begin.span.from, to: env.begin.span.to, end: env.end.span.to,
      text: depth > 1 ? "\\footnotesize" : "\\small" });
  }
  events.sort((a, b) => a.from - b.from);
  const cache = new Map<number, string>();
  const at = (offset: number): string => {
    const cached = cache.get(offset);
    if (cached !== undefined) return cached;
    const text = events.filter(event => event.to <= offset && offset < event.end).map(event => event.text).join(" ");
    cache.set(offset, text);
    return text;
  };
  const allLists = environments.filter(env => ["itemize", "enumerate", "description"].includes(env.name)).reverse();
  const enumerationItems = new Map<number, Span[]>();
  for (const command of controls) {
    if (command.name !== "item") continue;
    const owner = allLists.find(env => env.begin.span.to <= command.from && command.from < env.end.span.from);
    if (owner?.name !== "enumerate") continue;
    const limit = owner.end.span.from;
    const overlay = beamerOverlayArgumentAfter(context, command.to, limit);
    if (beamerOptionalArgumentAfter(context, overlay?.span.to ?? command.to, limit)) continue;
    const span = { from: command.from, to: command.to };
    if (!executesItem(span)) continue;
    const items = enumerationItems.get(owner.begin.span.from) ?? [];
    items.push(span);
    enumerationItems.set(owner.begin.span.from, items);
  }
  const minipages = environments.filter(env => ["column", "minipage"].includes(env.name));
  const listDepthAt = (offset: number, includeEnclosingLists = false) => {
    const start = includeEnclosingLists ? 0 : Math.max(0, ...minipages.filter(env => env.begin.span.to <= offset && offset < env.end.span.from).map(env => env.begin.span.to));
    return allLists.filter(env => start <= env.begin.span.from && env.begin.span.to <= offset && offset < env.end.span.from).length;
  };
  const alignments = environments.filter(env => ["center", "flushleft", "flushright"].includes(env.name));
  return Object.assign(at, {
    listDepthAt,
    insideAlignmentAt: (offset: number) => alignments.some(env => env.begin.span.to <= offset && offset < env.end.span.from),
    itemDepthAt: (offset: number) => lists.filter(env => env.begin.span.to <= offset && offset < env.end.span.from).length,
    enumerateCountersAt: (offset: number) => enumerations
      .filter(env => env.begin.span.to <= offset && offset < env.end.span.from)
      .map(env => enumerationItems.get(env.begin.span.from)?.filter(item => item.to <= offset).length ?? 0),
  });
}
