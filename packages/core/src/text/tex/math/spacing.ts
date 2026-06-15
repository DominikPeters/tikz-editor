import type {
  TexMathAtom,
  TexMathAtomClass,
  TexMathGlue,
  TexMathItem,
  TexMathList,
  TexMathNucleus,
  TexMathScript,
  TexMathSourceSpan,
  TexMathStyle,
  TexMathUnsupportedItem,
} from "./ir.js";

export type TexMathGlueSource = "inter-atom" | "explicit";

export interface TexMathResolvedGlue {
  readonly kind: "resolved-glue";
  readonly source: TexMathGlueSource;
  readonly mu: number;
  readonly stretchMu: number;
  readonly shrinkMu: number;
  readonly sourceSpan: TexMathSourceSpan;
  readonly command?: TexMathGlue["command"];
  readonly leftClass?: TexMathAtomClass;
  readonly rightClass?: TexMathAtomClass;
}

export type TexMathSpacedItem =
  | TexMathAtom
  | TexMathResolvedGlue
  | TexMathUnsupportedItem;

export interface TexMathSpacedList {
  readonly kind: "spaced-math-list";
  readonly style: TexMathStyle;
  readonly items: readonly TexMathSpacedItem[];
  readonly sourceSpan: TexMathSourceSpan;
}

const classOrder = [
  "ord",
  "op",
  "bin",
  "rel",
  "open",
  "close",
  "punct",
  "inner",
] as const satisfies readonly TexMathAtomClass[];

type TexMathSpacingDigit = "0" | "1" | "2" | "3" | "4" | "*";

// Encoded exactly like TeX's `math_spacing` table in tex.web: rows/columns are
// Ord, Op, Bin, Rel, Open, Close, Punct, Inner.
const texMathSpacingTable =
  "02340001" +
  "22*40001" +
  "33**3**3" +
  "44*04004" +
  "00*00000" +
  "02340001" +
  "11*11111" +
  "12341011";

export function normalizeTexMathAtomClasses(list: TexMathList): TexMathList {
  const normalizedItems = list.items.map(normalizeNestedItem);
  return {
    ...list,
    items: normalizedItems.map((item, index) =>
      item.kind === "atom" && item.atomClass === "bin" && shouldReclassifyBin(normalizedItems, index)
        ? { ...item, atomClass: "ord" }
        : item
    ),
  };
}

export function spaceTexMathList(
  list: TexMathList,
  options: { readonly style?: TexMathStyle } = {}
): TexMathSpacedList {
  const style = options.style ?? "text";
  const normalized = normalizeTexMathAtomClasses(list);
  const items: TexMathSpacedItem[] = [];
  let previousAtom: TexMathAtom | null = null;
  for (const item of normalized.items) {
    if (item.kind === "glue") {
      const resolved = resolveExplicitMathGlue(item);
      if (resolved) {
        items.push(resolved);
      }
      previousAtom = null;
      continue;
    }
    if (item.kind === "unsupported") {
      items.push(item);
      previousAtom = null;
      continue;
    }
    if (previousAtom) {
      const glue = texMathSpacingBetween(previousAtom, item, style);
      if (glue) {
        items.push(glue);
      }
    }
    items.push(item);
    previousAtom = item;
  }
  return {
    kind: "spaced-math-list",
    style,
    items,
    sourceSpan: list.sourceSpan,
  };
}

export function texMathSpacingBetween(
  left: TexMathAtom,
  right: TexMathAtom,
  style: TexMathStyle
): TexMathResolvedGlue | null {
  const digit = spacingDigit(left.atomClass, right.atomClass);
  const dimensions = interAtomGlueDimensions(digit, style);
  if (!dimensions) {
    return null;
  }
  return {
    kind: "resolved-glue",
    source: "inter-atom",
    ...dimensions,
    sourceSpan: {
      start: left.sourceSpan.end,
      end: right.sourceSpan.start,
    },
    leftClass: left.atomClass,
    rightClass: right.atomClass,
  };
}

export function resolveExplicitMathGlue(glue: TexMathGlue): TexMathResolvedGlue | null {
  const dimensions = explicitGlueDimensions(glue.command);
  if (!dimensions) {
    return null;
  }
  return {
    kind: "resolved-glue",
    source: "explicit",
    command: glue.command,
    ...dimensions,
    sourceSpan: glue.sourceSpan,
  };
}

function normalizeNestedItem(item: TexMathItem): TexMathItem {
  if (item.kind !== "atom") {
    return item;
  }
  return {
    ...item,
    nucleus: normalizeNucleus(item.nucleus),
    ...(item.subscript ? { subscript: normalizeScript(item.subscript) } : {}),
    ...(item.superscript ? { superscript: normalizeScript(item.superscript) } : {}),
  };
}

function normalizeNucleus(nucleus: TexMathNucleus): TexMathNucleus {
  if (nucleus.kind === "list") {
    return {
      ...nucleus,
      list: normalizeTexMathAtomClasses(nucleus.list),
    };
  }
  if (nucleus.kind === "fraction") {
    return {
      ...nucleus,
      numerator: normalizeTexMathAtomClasses(nucleus.numerator),
      denominator: normalizeTexMathAtomClasses(nucleus.denominator),
    };
  }
  if (nucleus.kind === "radical") {
    return {
      ...nucleus,
      radicand: normalizeTexMathAtomClasses(nucleus.radicand),
    };
  }
  if (nucleus.kind === "left-right") {
    return {
      ...nucleus,
      body: normalizeTexMathAtomClasses(nucleus.body),
    };
  }
  return nucleus;
}

function normalizeScript(script: TexMathScript): TexMathScript {
  return {
    ...script,
    list: normalizeTexMathAtomClasses(script.list),
  };
}

function shouldReclassifyBin(items: readonly TexMathItem[], index: number): boolean {
  const previous = previousAtom(items, index);
  if (
    !previous ||
    previous.atomClass === "bin" ||
    previous.atomClass === "op" ||
    previous.atomClass === "rel" ||
    previous.atomClass === "open" ||
    previous.atomClass === "punct"
  ) {
    return true;
  }
  const next = nextAtom(items, index);
  return (
    !next ||
    next.atomClass === "rel" ||
    next.atomClass === "close" ||
    next.atomClass === "punct"
  );
}

function previousAtom(items: readonly TexMathItem[], index: number): TexMathAtom | null {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const item = items[cursor];
    if (item?.kind === "atom") {
      return item;
    }
    if (item?.kind === "unsupported") {
      return null;
    }
  }
  return null;
}

function nextAtom(items: readonly TexMathItem[], index: number): TexMathAtom | null {
  for (let cursor = index + 1; cursor < items.length; cursor++) {
    const item = items[cursor];
    if (item?.kind === "atom") {
      return item;
    }
    if (item?.kind === "unsupported") {
      return null;
    }
  }
  return null;
}

function spacingDigit(left: TexMathAtomClass, right: TexMathAtomClass): TexMathSpacingDigit {
  const rowIndex = classOrder.indexOf(left);
  const columnIndex = classOrder.indexOf(right);
  const digit = texMathSpacingTable[rowIndex * classOrder.length + columnIndex];
  return isTexMathSpacingDigit(digit) ? digit : "0";
}

function interAtomGlueDimensions(
  digit: TexMathSpacingDigit,
  style: TexMathStyle
): Pick<TexMathResolvedGlue, "mu" | "stretchMu" | "shrinkMu"> | null {
  switch (digit) {
    case "0":
    case "*":
      return null;
    case "1":
      return isScriptStyle(style) ? null : { mu: 3, stretchMu: 0, shrinkMu: 0 };
    case "2":
      return { mu: 3, stretchMu: 0, shrinkMu: 0 };
    case "3":
      return isScriptStyle(style) ? null : { mu: 4, stretchMu: 2, shrinkMu: 4 };
    case "4":
      return isScriptStyle(style) ? null : { mu: 5, stretchMu: 5, shrinkMu: 0 };
  }
}

function isTexMathSpacingDigit(value: string | undefined): value is TexMathSpacingDigit {
  return value === "0" ||
    value === "1" ||
    value === "2" ||
    value === "3" ||
    value === "4" ||
    value === "*";
}

function namedMuGlueDimensions(
  name: "thin" | "med" | "thick"
): Pick<TexMathResolvedGlue, "mu" | "stretchMu" | "shrinkMu"> {
  switch (name) {
    case "thin":
      return { mu: 3, stretchMu: 0, shrinkMu: 0 };
    case "med":
      return { mu: 4, stretchMu: 2, shrinkMu: 4 };
    case "thick":
      return { mu: 5, stretchMu: 5, shrinkMu: 0 };
  }
}

function explicitGlueDimensions(
  command: TexMathGlue["command"]
): Pick<TexMathResolvedGlue, "mu" | "stretchMu" | "shrinkMu"> | null {
  switch (command) {
    case ",":
      return namedMuGlueDimensions("thin");
    case ":":
      return namedMuGlueDimensions("med");
    case ";":
      return namedMuGlueDimensions("thick");
    case "!":
      return { mu: -3, stretchMu: 0, shrinkMu: 0 };
    case "quad":
      return { mu: 18, stretchMu: 0, shrinkMu: 0 };
    case "qquad":
      return { mu: 36, stretchMu: 0, shrinkMu: 0 };
  }
}

function isScriptStyle(style: TexMathStyle): boolean {
  return style === "script" || style === "scriptscript";
}
