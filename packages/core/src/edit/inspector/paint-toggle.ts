import type { OptionEntry } from "../../options/types.js";
import type { ResolvedStyle } from "../../semantic/types.js";
import { normalizeColor } from "../../semantic/style/colors.js";
import { stripEnclosingBraces } from "../../semantic/style/option-utils.js";
import { normalizeOptionKey } from "../option-key.js";
import { isLikelyBareColorOption } from "../option-mutations.js";
import type { PropertyWriteMutation, SemanticPropertyId } from "../property-registry.js";
import { FILL_PATTERN_CLEAR_KEYS, FILL_SHADING_CLEAR_KEYS } from "./presets.js";
import type { InspectorSectionBuildContext } from "./section-builder.js";
import type { InspectorPaintToggle } from "./types.js";

type PaintOptionEntry = Extract<OptionEntry, { kind: "kv" | "flag" }>;

const NODE_TARGET_KINDS = new Set(["node-item", "matrix-cell", "tree-child"]);
const FILL_PAINT_KEYS = new Set<string>(["fill", ...FILL_PATTERN_CLEAR_KEYS, ...FILL_SHADING_CLEAR_KEYS]);
const FILL_SHADING_KEYS = new Set<string>(FILL_SHADING_CLEAR_KEYS.map(normalizeOptionKey));

// Turning a paint off writes `draw=none` / `fill=none`, the PGF way to disable
// it whatever a style or the path command says. The property-write planner
// then drops the `none` or rewrites the command (\filldraw → \draw) wherever
// that renders the same, so the source stays idiomatic.
export function buildPaintToggle(
  context: InspectorSectionBuildContext,
  paint: InspectorPaintToggle["paint"],
  state: { strokeEnabled: boolean; fillEnabled: boolean; colorSyntax: string | null }
): InspectorPaintToggle {
  const enabled = paint === "stroke" ? state.strokeEnabled : state.fillEnabled;
  const key = paint === "stroke" ? "draw" : "fill";
  const propertyId: SemanticPropertyId = paint === "stroke" ? "stroke-color" : "fill-color";
  const write = context.writeProperty(key);
  const entries = localOptionEntries(context);

  // A style named after this paint's own options (`\draw[red, t]` with t
  // drawing purple) decides the paint. Then `none` has to come after it, the
  // colours stay, and switching back on only removes the `none`.
  const repaintingStyles = new Set(
    context.element.styleChain.flatMap((entry) =>
      entry.kind === "named-style" && contributesPaint(entry.resolvedContributions, paint) ? [normalizeOptionKey(entry.styleName)] : []
    )
  );
  const lastStyleIndex = lastIndexOf(entries, (entry) => repaintingStyles.has(normalizeOptionKey(entry.key)));
  // On \draw (\fill) a bare colour counts as this paint's own option.
  const lastOwnIndex = lastIndexOf(entries, (entry) =>
    normalizeOptionKey(entry.key) === key || (commandName(context) === key && entry.kind === "flag" && isLikelyBareColorOption(entry.key))
  );
  // A fill colour from a style does not override local shading.
  const localShading = paint === "fill" && entries.some((entry) => FILL_SHADING_KEYS.has(normalizeOptionKey(entry.key)));
  const styleWins = lastStyleIndex >= 0 && lastStyleIndex > lastOwnIndex && !localShading;

  // A bare colour (`\draw[red]`) or `color=` colours both paints and node
  // text, and the nodes, edges and pics on the path, so it goes with this
  // paint only when nothing else uses it.
  const otherEnabled = paint === "stroke" ? state.fillEnabled : state.strokeEnabled;
  const colorDependents = context.resolvedTarget?.kind === "found" && context.resolvedTarget.target.hasColorDependents === true;
  const ownsColor = !otherEnabled && !isNodeTarget(context.targetKind) && !colorDependents && !styleWins;
  const colorFlags = entries.filter((entry) => entry.kind === "flag" && isLikelyBareColorOption(entry.key)).map((entry) => entry.key.trim());
  const colorKeys = ownsColor ? ["color", ...colorFlags] : [];
  const ownedKeys = new Set([...(paint === "stroke" ? ["draw"] : FILL_PAINT_KEYS), ...colorKeys.map(normalizeOptionKey)]);
  const owned = entries.filter((entry) => ownedKeys.has(normalizeOptionKey(entry.key)));

  // On \draw a bare colour is written as the stroke (on \fill, the fill), so
  // `draw=none` replaces it. When the other paint still uses it, spell that
  // paint's colour out first; either way the colour comes back on restore.
  const otherKey = paint === "stroke" ? "fill" : "draw";
  const otherHasColor = entries.some((entry) => entry.kind === "kv" && normalizeOptionKey(entry.key) === otherKey);
  const otherColor = paint === "stroke" ? context.element.style.fill : context.element.style.stroke;
  const aliasFlag = !ownsColor && !colorDependents && commandName(context) === key ? colorFlags.at(-1) ?? null : null;
  const sharedFlag = aliasFlag != null && otherColor != null && sameColor(otherColor, aliasFlag) ? aliasFlag : null;

  // `fill=none` leaves shading on, so shading that outlives the local options
  // (\shade, \shadedraw, a style) also needs `shade=none`, last: the fill
  // write first clears the local shading keys, which could switch it back on.
  const disableShade = paint === "fill" && shadesWithoutLocalOptions(context);

  // `none` has to come after anything that paints again, such as a style
  // named later in `\node[draw, t]`, so a local `draw` is removed and the
  // `none` appended rather than written in its place.
  const clearKeys = [...(paint === "fill" ? [...FILL_PATTERN_CLEAR_KEYS, ...FILL_SHADING_CLEAR_KEYS] : []), ...colorKeys];
  const moveToEnd = styleWins && lastOwnIndex >= 0;

  const disable: PropertyWriteMutation[] = [
    ...(sharedFlag && !otherHasColor
      ? [{ key: otherKey, value: sharedFlag, propertyId: paint === "stroke" ? "fill-color" as const : "stroke-color" as const }]
      : []),
    ...(moveToEnd ? [{ key, value: "", propertyId, clearKeys }] : []),
    { key, value: "none", propertyId, clearKeys },
    ...(disableShade ? [{ key: "shade", value: "none", propertyId: "fill-shade" as const }] : [])
  ];

  // A bare `draw` / `fill` paints with the current colour, which switching
  // this paint off may change: the planner writes `\fill[draw=blue]` as
  // `\draw[blue]`, and `draw=none` on \draw takes a bare colour with it. So
  // the paint comes back with its colour unless nothing can recolour it.
  const current = paint === "stroke" ? context.element.style.stroke : context.element.style.fill;
  const flagKeepsColor = aliasFlag == null && (!otherHasColor || colorDependents) && current != null
    && sameColor(current, context.element.style.textColor ?? "black");
  const writtenColor = state.colorSyntax != null && current != null && sameColor(state.colorSyntax, current) ? state.colorSyntax : null;
  // The resolved colour is only writable as TikZ when it is a colour name.
  const namedColor = current != null && /^[a-z]+$/iu.test(current.trim()) ? current.trim() : null;
  const paintValue = flagKeepsColor ? "true" : aliasFlag ?? writtenColor ?? namedColor ?? "true";

  return {
    paint,
    enabled,
    write,
    disable,
    restore: !enabled ? [] : [
      // Remove the suppression before replaying local options, which may
      // themselves include an authored shade=none / shade=false.
      ...(disableShade ? [{ key: "shade", value: "", propertyId: "fill-shade" as const }] : []),
      ...(styleWins ? [{ key, value: "", propertyId }] : restoreMutations(owned, key, propertyId, paintValue, commandPaints(context, key) || aliasFlag != null)),
      // Shading from \shade or \shadedraw went with the command.
      ...(paint === "fill" && commandShades(context) && context.element.style.shadeEnabled
        ? [{ key: "shade", value: "true", propertyId: "fill-shade" as const }]
        : [])
    ],
    enable: [{ key, value: "true", propertyId }]
  };
}

function restoreMutations(
  owned: PaintOptionEntry[],
  key: "draw" | "fill",
  propertyId: SemanticPropertyId,
  paintValue: string,
  fromCommand: boolean
): PropertyWriteMutation[] {
  const restored: PropertyWriteMutation[] = owned.map((entry) => {
    const own = normalizeOptionKey(entry.key) === key;
    const value = entry.kind === "kv" ? stripEnclosingBraces(entry.valueRaw).trim() : own ? paintValue : "true";
    return { key: entry.key.trim(), value, ...(own ? { propertyId } : {}) };
  });
  if (owned.some((entry) => normalizeOptionKey(entry.key) === key)) {
    return restored;
  }
  // Paint from the command (\fill[red]) went with the command, so writing it
  // brings it back and the planner folds it into the command again. Paint
  // from a style comes back once the `none` is gone.
  if (fromCommand) {
    // The command's paint comes before its options, as in PGF.
    return [{ key, value: paintValue, propertyId }, ...restored];
  }
  return [{ key, value: "", propertyId }, ...restored];
}

function commandName(context: InspectorSectionBuildContext): string | undefined {
  const target = context.resolvedTarget?.kind === "found" ? context.resolvedTarget.target : null;
  return target?.kind === "path-statement" ? target.pathCommand?.trim().toLowerCase() : undefined;
}

function contributesPaint(contributions: Partial<ResolvedStyle>, paint: InspectorPaintToggle["paint"]): boolean {
  return paint === "stroke"
    ? contributions.drawExplicit === true || contributions.stroke != null
    : contributions.fill != null || contributions.fillPattern != null || contributions.shadeEnabled === true;
}

function sameColor(left: string, right: string): boolean {
  return normalizeColor(left) === normalizeColor(right);
}

function commandShades(context: InspectorSectionBuildContext): boolean {
  const command = commandName(context);
  return command === "shade" || command === "shadedraw";
}

function commandPaints(context: InspectorSectionBuildContext, key: "draw" | "fill"): boolean {
  const command = commandName(context);
  return key === "draw"
    ? command === "draw" || command === "filldraw" || command === "shadedraw"
    : command === "fill" || command === "filldraw";
}

// Shading switched on by the command (\shadedraw), a scope or a style named in
// the options survives clearing the shading keys written on the path itself.
function shadesWithoutLocalOptions(context: InspectorSectionBuildContext): boolean {
  const { element } = context;
  // No early exit on an unshaded element: a local pattern hides the shading of
  // \shade[pattern=dots] in the editor, and it returns once the pattern is gone.
  const options = context.resolvedTarget?.kind === "found" ? context.resolvedTarget.target.options : undefined;
  return element.styleChain.some((entry) =>
    entry.resolvedContributions.shadeEnabled === true
    && !(options && entry.rawOptions.some((list) => list.span.from === options.span.from && list.span.to === options.span.to))
  );
}

function localOptionEntries(context: InspectorSectionBuildContext): PaintOptionEntry[] {
  const options = context.resolvedTarget?.kind === "found" ? context.resolvedTarget.target.options : undefined;
  return (options?.entries ?? []).filter(
    (entry): entry is PaintOptionEntry => entry.kind === "kv" || entry.kind === "flag"
  );
}

function lastIndexOf<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) return index;
  }
  return -1;
}

function isNodeTarget(targetKind: string | null): boolean {
  return targetKind != null && NODE_TARGET_KINDS.has(targetKind);
}
