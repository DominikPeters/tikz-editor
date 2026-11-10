import { matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import { beamerControlSequencesIn, beamerRequiredArgumentAfter, beamerOptionalArgumentAfter, createBeamerSyntaxContext } from "./syntax.js";

const declarations = new Set("tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge rmfamily sffamily ttfamily bfseries mdseries itshape upshape slshape normalfont centering raggedleft raggedright".split(" "));

/** Formatting declarations still active at a structural split. The generic
 * paragraph frontend executes them itself when no split occurs. */
export function createBeamerAmbientText(source: string) {
  const context = createBeamerSyntaxContext(source);
  const environments = [...matchTexSyntaxEnvironments(context.syntax).values()];
  const storedOptions = new Set(environments.filter(env => env.name === "tcolorbox").flatMap(env => {
    const options = beamerOptionalArgumentAfter(context, env.begin.span.to, source.length);
    return options ? [options.span.from] : [];
  }));
  const events = beamerControlSequencesIn(context, { from: 0, to: source.length }).flatMap(command => {
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
  return Object.assign(at, { itemDepthAt: (offset: number) => lists.filter(env => env.begin.span.to <= offset && offset < env.end.span.from).length });
}
