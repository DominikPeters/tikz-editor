import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { NAMED_COLORS, NON_STYLE_OPTION_FLAGS, NON_STYLE_OPTION_KEYS } from "tikz-editor/semantic/style/constants";
import type { DocumentSymbols } from "tikz-editor/completion/index";

// ── Value maps ──────────────────────────────────────────────────────────────

const VALUE_MAP: Record<string, readonly string[]> = {
  "align": ["left", "center", "right", "justify", "flush left", "flush right", "flush center", "none"],
  "line cap": ["round", "butt", "rect"],
  "line join": ["round", "bevel", "miter"],
  "shading": ["axis", "radial", "ball"],
  "anchor": [
    "center", "north", "south", "east", "west",
    "north east", "north west", "south east", "south west",
    "base", "base east", "base west",
    "mid", "mid east", "mid west",
    "text",
    "apex", "tip", "pointer",
  ],
  "shape": [
    "rectangle", "circle", "ellipse", "diamond",
    "trapezium", "semicircle", "regular polygon", "star",
    "isosceles triangle", "kite", "dart", "circular sector",
    "cylinder", "cloud", "starburst", "signal", "tape",
    "rectangle callout", "ellipse callout", "cloud callout",
    "single arrow", "double arrow", "coordinate",
  ],
  "pattern": [
    // Modern meta-pattern families first
    "lines", "hatch", "dots", "stars",
    // Legacy patterns
    "horizontal lines", "vertical lines", "north east lines", "north west lines",
    "grid", "crosshatch", "crosshatch dots",
    "fivepointed stars", "sixpointed stars",
    "bricks", "checkerboard",
    "checkerboard light gray",
    "horizontal lines light gray", "horizontal lines gray", "horizontal lines dark gray",
    "horizontal lines light blue", "horizontal lines dark blue",
    "crosshatch dots gray", "crosshatch dots light steel blue",
    "none",
  ],
};

const ANCHOR_COMPLETIONS: readonly string[] = [
  "center", "north", "south", "east", "west",
  "north east", "north west", "south east", "south west",
  "base", "base east", "base west",
  "mid", "mid east", "mid west",
  "text",
];

const COLOR_KEYS = new Set([
  "draw", "fill", "text", "color",
  "top color", "bottom color", "left color", "right color",
  "inner color", "outer color", "ball color",
]);

const COLOR_NAMES = [...NAMED_COLORS, "none"];

// ── Option key list ─────────────────────────────────────────────────────────

const COMMON_OPTION_KEYS = [
  "draw", "fill", "text", "line width", "opacity", "fill opacity", "text opacity",
  "rounded corners", "dash pattern", "dashed", "dotted",
  "thick", "thin", "very thick", "very thin", "ultra thick", "ultra thin",
  "line cap", "line join", "font",
  "xshift", "yshift", "shift", "rotate", "scale", "xscale", "yscale",
  "minimum width", "minimum height", "minimum size",
  "inner sep", "outer sep", "shape", "name", "alias", "at",
  "anchor", "align", "above", "below", "left", "right",
  "above left", "above right", "below left", "below right",
  "node distance", "shading", "pattern",
  "<-", "->", "<->",
] as const;

const ALL_OPTION_KEYS: Completion[] = buildOptionKeyCompletions();

function buildOptionKeyCompletions(): Completion[] {
  const seen = new Set<string>();
  const result: Completion[] = [];
  const add = (label: string, detail: string) => {
    if (seen.has(label)) return;
    seen.add(label);
    result.push({ label, type: "keyword", detail });
  };
  for (const k of COMMON_OPTION_KEYS) add(k, "TikZ option");
  for (const k of NON_STYLE_OPTION_KEYS) add(k, "TikZ option");
  for (const k of NON_STYLE_OPTION_FLAGS) add(k, "TikZ option");
  return result;
}

// ── Context detection ───────────────────────────────────────────────────────

/**
 * Check if position is inside `[...]` by scanning backward for unmatched `[`.
 */
function isInsideBrackets(state: EditorState, pos: number): boolean {
  const text = state.doc.sliceString(0, pos);
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "]") depth++;
    else if (ch === "[") {
      if (depth === 0) return true;
      depth--;
    }
    // Stop scanning at statement boundaries
    if (ch === ";" || ch === "\n") {
      // newlines are fine inside brackets, but semicolons are not
      if (ch === ";") return false;
    }
  }
  return false;
}

/**
 * Extract the key name from text before cursor in a `key = partial` context.
 * Returns null if not in a key=value context.
 */
function getKeyBeforeEquals(text: string): string | null {
  // Match: key = partial_value (value may be empty)
  const match = text.match(/([\w][\w ]*?)\s*=\s*[A-Za-z ]*$/);
  if (!match) return null;
  return match[1].trim().toLowerCase();
}

// ── Main completion function ────────────────────────────────────────────────

export function tikzCompletion(
  context: CompletionContext,
  symbols: DocumentSymbols
): CompletionResult | null {
  const pos = context.pos;
  const lineText = context.state.doc.lineAt(pos);
  const textBefore = lineText.text.slice(0, pos - lineText.from);

  // 1. Anchor completion after "." in node references (e.g. nodename.nor)
  const dotMatch = context.matchBefore(/[A-Za-z_][\w-]*\.([a-z ]*)/);
  if (dotMatch) {
    const afterDot = dotMatch.text.indexOf(".");
    const from = dotMatch.from + afterDot + 1;
    return {
      from,
      options: ANCHOR_COMPLETIONS.map((a) => ({
        label: a,
        type: "property",
        detail: "anchor",
      })),
      validFor: /[a-z ]*/,
    };
  }

  // 2. Value completion after "=" for known keys
  const eqMatch = context.matchBefore(/([\w][\w ]*?)\s*=\s*([A-Za-z ]*)/);
  if (eqMatch && isInsideBrackets(context.state, pos)) {
    const key = getKeyBeforeEquals(textBefore);
    if (key) {
      // Find the start of the value (after the =)
      const eqIdx = eqMatch.text.lastIndexOf("=");
      const afterEq = eqMatch.text.slice(eqIdx + 1);
      const valueStart = eqMatch.from + eqIdx + 1 + (afterEq.length - afterEq.trimStart().length);
      const typed = context.state.doc.sliceString(valueStart, pos);

      // Color keys: only after 2+ chars
      if (COLOR_KEYS.has(key)) {
        if (typed.length >= 2 || context.explicit) {
          return {
            from: valueStart,
            options: COLOR_NAMES.map((c) => ({
              label: c,
              type: "constant",
              detail: "color",
            })),
            validFor: /[a-z ]*/,
          };
        }
        return null;
      }

      // Known value sets: always show after =
      if (key in VALUE_MAP) {
        const boost = VALUE_MAP[key].length;
        return {
          from: valueStart,
          options: VALUE_MAP[key].map((v, i) => ({
            label: v,
            type: "enum",
            detail: key,
            boost: boost - i,
          })),
          validFor: /[a-z ]*/,
        };
      }
    }
  }

  // 3. Option key completion inside [...] after 3+ chars
  const word = context.matchBefore(/[A-Za-z][\w -]*/);
  if (word && isInsideBrackets(context.state, pos)) {
    const typed = word.text;
    if (typed.length >= 3 || context.explicit) {
      // Check we're not after "=" (that's value context, handled above)
      if (!textBefore.match(/=\s*[A-Za-z][\w -]*$/)) {
        const dynamicOptions: Completion[] = symbols.styleNames.map((s) => ({
          label: s,
          type: "type",
          detail: "style",
        }));
        return {
          from: word.from,
          options: [...dynamicOptions, ...ALL_OPTION_KEYS],
          validFor: /[A-Za-z][\w -]*/,
        };
      }
    }
  }

  return null;
}
