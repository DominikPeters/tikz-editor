/**
 * The `/pgfplots/` key tree, as far as the axis evaluator needs it.
 *
 * pgfplots keys are processed in order. A key is one of:
 * - a style definition (`name/.style`, `.append style`, `.prefix style`),
 *   which updates the style registry;
 * - a documented "short style key" (`xlabel style={…}` is
 *   `every axis x label/.append style={…}`, manual styleoptions.tex);
 * - the use of a style (`every axis`, or a user style such as `mystyle`),
 *   which is expanded in place, with `#1` replaced by the value;
 * - anything else, which is handed to the caller's sink: an axis or plot
 *   key, or a TikZ key that falls through to `/tikz/`.
 *
 * Everything here is from the manual's key documentation; see
 * design/pgfplots-behaviour.md for measured defaults.
 */
import type { Span } from "../ast/types.js";
import { parseOptionListRaw, parseStyleValueAsOptionList } from "../options/parse.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";

/** A style: option lists in application order. */
export type PgfplotsStyleRegistry = Map<string, OptionListAst[]>;

/** One key after style expansion. `entry` is the user-written entry it came from (for spans). */
export type PgfplotsKeyUse = {
  key: string;
  value: string | null;
  /** The entry as written where the expansion started (spans point into the document when it was parsed from it). */
  origin: OptionEntry;
};

export type PgfplotsKeyProblem = { key: string; span: Span; reason: "unsupported-handler" | "recursion" };

const SHORT_STYLE_KEYS: Record<string, string> = {
  "label style": "every axis label",
  "title style": "every axis title",
  "legend style": "every axis legend",
  "tick style": "every tick",
  "minor tick style": "every minor tick",
  "major tick style": "every major tick",
  "tick label style": "every tick label",
  "ticklabel style": "every tick label",
  "grid style": "every axis grid",
  "minor grid style": "every minor grid",
  "major grid style": "every major grid",
  "forget plot style": "every forget plot",
  "legend image post style": "every legend image post",
  "colorbar style": "every colorbar",
  "extra tick style": "every extra tick"
};
for (const a of ["x", "y", "z"]) {
  Object.assign(SHORT_STYLE_KEYS, {
    [`${a} label style`]: `every axis ${a} label`,
    [`${a}label style`]: `every axis ${a} label`,
    [`${a} tick label style`]: `every ${a} tick label`,
    [`${a}ticklabel style`]: `every ${a} tick label`,
    [`${a} tick scale label style`]: `every ${a} tick scale label`,
    [`${a}tick style`]: `every ${a} tick`,
    // Documented as `\x tick style` (= `xtick style`); documents also write `x tick style`, which compiles.
    [`${a} tick style`]: `every ${a} tick`,
    [`minor ${a} tick style`]: `every minor ${a} tick`,
    [`major ${a} tick style`]: `every major ${a} tick`,
    [`extra ${a} tick style`]: `every extra ${a} tick`,
    [`${a} grid style`]: `every axis ${a} grid`,
    [`minor ${a} grid style`]: `every minor ${a} grid`,
    [`major ${a} grid style`]: `every major ${a} grid`
  });
}

/** The styles pgfplots defines, with their documented initial values (manual styleoptions.tex). */
const INITIAL_STYLES: Record<string, string> = {
  "every axis": "",
  "every axis post": "",
  "every linear axis": "",
  "every axis plot": "",
  "every axis plot post": "",
  "every forget plot": "",
  "every axis label": "",
  "every axis x label": "",
  "every axis y label": "",
  // `every axis title/.style={at={(0.5,1)},above,yshift=6pt}`; the evaluator places it (E3).
  "every axis title": "",
  // Manual axisdescription.tex, "The default every axis legend style is" (behaviour L1).
  "every axis legend": "cells={anchor=center},inner xsep=3pt,inner ysep=2pt,nodes={inner sep=2pt,text depth=0.15em},anchor=north east,shape=rectangle,fill=white,draw=black,at={(0.98,0.98)}",
  "every legend image post": "",
  "every tick": "very thin,gray",
  "every minor tick": "",
  "every major tick": "",
  "every x tick": "",
  "every y tick": "",
  "every minor x tick": "",
  "every minor y tick": "",
  "every major x tick": "",
  "every major y tick": "",
  "every tick label": "",
  "every x tick label": "",
  "every y tick label": "",
  "every x tick scale label": "",
  "every y tick scale label": "",
  "every axis grid": "thin,black!25",
  "every minor grid": "",
  "every major grid": "",
  "every axis x grid": "",
  "every axis y grid": "",
  "every minor x grid": "",
  "every minor y grid": "",
  "every major x grid": "",
  "every major y grid": "",
  "every mark": ""
};

export function createInitialStyleRegistry(): PgfplotsStyleRegistry {
  const registry: PgfplotsStyleRegistry = new Map();
  for (const [name, value] of Object.entries(INITIAL_STYLES)) {
    registry.set(name, value ? [parseOptionListRaw(`[${value}]`)] : []);
  }
  return registry;
}

export function cloneStyleRegistry(registry: PgfplotsStyleRegistry): PgfplotsStyleRegistry {
  return new Map([...registry].map(([name, lists]) => [name, [...lists]]));
}

/** `/pgfplots/xmin` → `xmin`, `/tikz/thick` → `thick`; whitespace collapsed. */
export function normalizePgfplotsKey(raw: string): string {
  return raw.trim().replace(/\s+/gu, " ").replace(/^\/pgfplots\//u, "").replace(/^\/tikz\//u, "");
}

const STYLE_HANDLER = /^(.*?)\s*\/\.(style|append style|prefix style|code|style args|style \d+ args|style n args|initial|add|append code|prefix code|default|value required|is choice|is if|estore in|store in|try|unknown)$/u;

export type ExpandOptions = {
  /** Called for each style definition, after the registry has been updated. */
  onStyleDefinition?: (name: string, use: PgfplotsKeyUse) => void;
  /** Problems with handlers this module does not support. */
  onProblem?: (problem: PgfplotsKeyProblem) => void;
};

/**
 * Expands `lists` in order against `registry` (which style definitions
 * update) and hands every remaining key to `sink`.
 */
export function expandPgfplotsOptions(
  lists: readonly OptionListAst[],
  registry: PgfplotsStyleRegistry,
  sink: (use: PgfplotsKeyUse) => void,
  options: ExpandOptions = {}
): void {
  const visit = (entries: readonly OptionEntry[], origin: OptionEntry | null, depth: number, argument: string | null): void => {
    for (const rawEntry of entries) {
      const entry = argument === null ? rawEntry : substituteArgument(rawEntry, argument);
      const outer = origin ?? entry;
      if (entry.kind === "unknown") {
        sink({ key: entry.raw.trim(), value: null, origin: outer });
        continue;
      }
      const key = normalizePgfplotsKey(entry.key);
      const value = entry.kind === "kv" ? entry.valueRaw : null;
      const handler = STYLE_HANDLER.exec(key);
      if (handler) {
        const name = normalizePgfplotsKey(handler[1] ?? "");
        const kind = handler[2] ?? "";
        if (kind === "style" || kind === "append style" || kind === "prefix style") {
          const parsed = value === null ? null : parseStyleValueAsOptionList(value, entry.kind === "kv" ? entry.valueSpan?.from ?? 0 : 0);
          const list = parsed ?? parseOptionListRaw("[]");
          const existing = registry.get(name) ?? [];
          registry.set(name, kind === "style" ? [list] : kind === "append style" ? [...existing, list] : [list, ...existing]);
          options.onStyleDefinition?.(name, { key, value, origin: outer });
        } else {
          options.onProblem?.({ key: `${name}/.${kind}`, span: outer.span, reason: "unsupported-handler" });
        }
        continue;
      }
      const shortTarget = SHORT_STYLE_KEYS[key];
      if (shortTarget !== undefined && value !== null) {
        const parsed = parseStyleValueAsOptionList(value, entry.kind === "kv" ? entry.valueSpan?.from ?? 0 : 0);
        if (parsed) registry.set(shortTarget, [...(registry.get(shortTarget) ?? []), parsed]);
        options.onStyleDefinition?.(shortTarget, { key, value, origin: outer });
        continue;
      }
      const style = registry.get(key);
      if (style !== undefined && !ELEMENT_STYLES.has(key)) {
        if (depth > 32) {
          options.onProblem?.({ key, span: outer.span, reason: "recursion" });
          continue;
        }
        for (const list of style) visit(list.entries, outer, depth + 1, value);
        continue;
      }
      sink({ key, value, origin: outer });
    }
  };
  for (const list of lists) visit(list.entries, null, 0, null);
}

/**
 * Styles that belong to one kind of element (a tick label, the grid…):
 * naming one as a flag inside axis options would apply it to the axis,
 * which is never what a document means, so they are only read by the
 * evaluator when it builds that element.
 */
const ELEMENT_STYLES = new Set(Object.keys(INITIAL_STYLES).filter((name) => name !== "every axis" && name !== "every linear axis" && name !== "every axis post"));

function substituteArgument(entry: OptionEntry, argument: string): OptionEntry {
  if (!entry.raw.includes("#1")) return entry;
  const replaced = entry.raw.split("#1").join(argument.trim().replace(/^\{([\s\S]*)\}$/u, "$1"));
  const reparsed = parseOptionListRaw(`[${replaced}]`).entries[0];
  return reparsed ? { ...reparsed, span: entry.span } : entry;
}

/** The option lists of `names` in the registry, in order, each style expanded recursively against it. */
export function styleLists(registry: PgfplotsStyleRegistry, names: readonly string[]): OptionListAst[] {
  return names.flatMap((name) => registry.get(name) ?? []);
}

/** Flattens styles to the TikZ-level entries they mean (user styles expanded, pgfplots keys passed through). */
export function flattenStyleEntries(lists: readonly OptionListAst[], registry: PgfplotsStyleRegistry): PgfplotsKeyUse[] {
  const uses: PgfplotsKeyUse[] = [];
  // Expansion must not redefine the document's styles.
  expandPgfplotsOptions(lists, cloneStyleRegistry(registry), (use) => uses.push(use));
  return uses;
}

/** Re-serialises key uses as one TikZ option list. */
export function keyUsesToOptionList(uses: readonly PgfplotsKeyUse[]): OptionListAst {
  const raw = uses.map((use) => use.value === null ? use.key : `${use.key}=${use.value}`).join(",");
  return parseOptionListRaw(`[${raw}]`);
}
