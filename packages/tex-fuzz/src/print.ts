import type {
  TexFuzzDimension,
  TexFuzzDisplayMathDelimiter,
  TexFuzzMathNode,
  TexFuzzMutation,
  TexFuzzNode,
  TexFuzzSourceSpan,
} from "./model.js";

export interface PrintedTexFuzzAst {
  readonly source: string;
  readonly sourceMap: readonly TexFuzzSourceSpan[];
}

function printDimension(dimension: TexFuzzDimension): string {
  if (!Number.isFinite(dimension.amount)) {
    throw new RangeError(`Cannot print non-finite TeX dimension ${dimension.amount}${dimension.unit}.`);
  }
  return `${dimension.amount}${dimension.unit}`;
}

function displayMathDelimiters(delimiter: TexFuzzDisplayMathDelimiter): readonly [string, string] {
  if (delimiter === "bracket") return ["\\[", "\\]"];
  if (delimiter === "double-dollar") return ["$$", "$$"];
  const environment = delimiter.endsWith("-star") ? `${delimiter.slice(0, -5)}*` : delimiter;
  return [`\\begin{${environment}}`, `\\end{${environment}}`];
}

function printMathNode(
  node: TexFuzzMathNode,
  path: string,
  output: { source: string; spans: TexFuzzSourceSpan[] }
): void {
  const start = output.source.length;
  const nested = (child: TexFuzzMathNode, segment: string): void => {
    printMathNode(child, `${path}/${segment}`, output);
  };
  switch (node.kind) {
    case "atom": output.source += node.value; break;
    case "group":
      output.source += "{";
      nested(node.body, "body");
      output.source += "}";
      break;
    case "sequence":
      node.items.forEach((item, index) => {
        if (index > 0) {
          const operator = node.operators[index - 1] ?? "+";
          output.source += operator.startsWith("\\") ? `${operator}{}` : operator;
        }
        nested(item, `items/${index}`);
      });
      break;
    case "fraction":
      output.source += `\\${node.command}{`;
      nested(node.numerator, "numerator");
      output.source += "}{";
      nested(node.denominator, "denominator");
      output.source += "}";
      break;
    case "radical":
      output.source += "\\sqrt";
      if (node.degree) {
        output.source += "[";
        nested(node.degree, "degree");
        output.source += "]";
      }
      output.source += "{";
      nested(node.body, "body");
      output.source += "}";
      break;
    case "script":
      output.source += "{";
      nested(node.base, "base");
      output.source += "}";
      if (node.subscript) {
        output.source += "_{";
        nested(node.subscript, "subscript");
        output.source += "}";
      }
      if (node.superscript) {
        output.source += "^{";
        nested(node.superscript, "superscript");
        output.source += "}";
      }
      break;
    case "accent":
    case "alphabet":
    case "line":
      output.source += `\\${node.command}{`;
      nested(node.body, "body");
      output.source += "}";
      break;
    case "left-right":
      output.source += `\\left${node.left.startsWith("\\") ? `${node.left}{}` : node.left}`;
      nested(node.body, "body");
      output.source += `\\right${node.right}`;
      break;
    case "operator":
      output.source += `\\${node.command}`;
      if (node.script) {
        output.source += "_{";
        nested(node.script, "script");
        output.source += "}";
      }
      break;
    case "stackrel":
      output.source += "\\stackrel{";
      nested(node.above, "above");
      output.source += "}{";
      nested(node.body, "body");
      output.source += "}";
      break;
    case "xarrow":
      output.source += `\\${node.command}`;
      if (node.below) {
        output.source += "[";
        nested(node.below, "below");
        output.source += "]";
      }
      output.source += "{";
      nested(node.above, "above");
      output.source += "}";
      break;
    case "matrix":
      output.source += `\\begin{${node.environment}}`;
      node.cells.forEach((row, rowIndex) => {
        if (rowIndex > 0) output.source += "\\\\";
        row.forEach((cell, columnIndex) => {
          if (columnIndex > 0) output.source += "&";
          nested(cell, `cells/${rowIndex}/${columnIndex}`);
        });
      });
      output.source += `\\end{${node.environment}}`;
      break;
    case "text": output.source += `\\${node.command}{${node.value}}`; break;
  }
  output.spans.push({ path, kind: `math.${node.kind}`, start, end: output.source.length });
}

export function printTexFuzzMathAst(ast: TexFuzzMathNode): PrintedTexFuzzAst {
  const output = { source: "", spans: [] as TexFuzzSourceSpan[] };
  printMathNode(ast, "math", output);
  return { source: output.source, sourceMap: output.spans };
}

function printNodes(
  nodes: readonly TexFuzzNode[],
  parentPath: string,
  output: { source: string; spans: TexFuzzSourceSpan[] }
): void {
  nodes.forEach((node, index) => {
    const path = `${parentPath}/${index}`;
    const start = output.source.length;
    const printNested = (children: readonly TexFuzzNode[], segment = "children"): void => {
      printNodes(children, `${path}/${segment}`, output);
    };
    switch (node.kind) {
      case "text":
        output.source += node.value;
        break;
      case "space":
        output.source += node.nonBreaking ? "~" : " ";
        break;
      case "group":
        output.source += "{";
        printNested(node.children);
        output.source += "}";
        break;
      case "font":
        output.source += `\\${node.command}{`;
        printNested(node.children);
        output.source += "}";
        break;
      case "font-declaration":
        output.source += `{\\${node.command} `;
        printNested(node.children);
        output.source += "}";
        break;
      case "style-declaration":
        if (node.command === "color") {
          output.source += `{\\color{${node.color}}`;
        } else if (node.command === "fontsize") {
          output.source += `{\\fontsize{${printDimension(node.size)}}{${printDimension(node.baselineSkip)}}\\selectfont `;
        } else {
          output.source += `{\\${node.command} `;
        }
        printNested(node.children);
        output.source += "}";
        break;
      case "color":
        output.source += `\\textcolor{${node.color}}{`;
        printNested(node.children);
        output.source += "}";
        break;
      case "math":
        output.source += node.delimiter === "paren" ? "\\(" : "$";
        if (node.body) printMathNode(node.body, `${path}/math`, output);
        else output.source += node.content;
        output.source += node.delimiter === "paren" ? "\\)" : "$";
        break;
      case "display-math": {
        const delimiters = displayMathDelimiters(node.delimiter);
        output.source += delimiters[0];
        if (node.body) printMathNode(node.body, `${path}/math`, output);
        else output.source += node.content;
        output.source += delimiters[1];
        break;
      }
      case "accent":
        output.source += `\\${node.command}{${node.base}}`;
        break;
      case "line-break":
        if (node.command === "\\") {
          output.source += `\\\\${node.starred ? "*" : ""}${node.leading ? `[${printDimension(node.leading)}]` : ""}`;
        } else if (node.command === "linebreak") {
          output.source += `\\linebreak${node.priority === undefined ? "{}" : `[${node.priority}]`}`;
        } else {
          output.source += "\\newline{}";
        }
        break;
      case "box": {
        output.source += `\\${node.command}`;
        if (node.command === "colorbox") {
          output.source += `{${node.backgroundColor}}`;
        } else if (node.command === "fcolorbox") {
          output.source += `{${node.frameColor}}{${node.backgroundColor}}`;
        } else if ((node.command === "makebox" || node.command === "framebox") && node.width) {
          output.source += `[${printDimension(node.width)}]`;
          if (node.alignment) output.source += `[${node.alignment}]`;
        } else if ((node.command === "makebox" || node.command === "framebox") && node.alignment) {
          throw new Error(`Cannot print ${node.command} alignment without an explicit width.`);
        }
        output.source += "{";
        printNested(node.children);
        output.source += "}";
        break;
      }
      case "dimension-box":
        output.source += `\\${node.command}{`;
        printNested(node.children);
        output.source += "}";
        break;
      case "raisebox":
        output.source += `\\raisebox{${printDimension(node.lift)}}`;
        if (node.height || node.depth) output.source += `[${node.height ? printDimension(node.height) : "0pt"}]`;
        if (node.depth) output.source += `[${printDimension(node.depth)}]`;
        output.source += "{";
        printNested(node.children);
        output.source += "}";
        break;
      case "rule":
        output.source += `\\rule${node.raise ? `[${printDimension(node.raise)}]` : ""}{${printDimension(node.width)}}{${printDimension(node.height)}}`;
        break;
      case "paragraph-break":
        output.source += node.command === "blank-line" ? "\n\n" : "\\par ";
        break;
      case "noindent":
        output.source += "\\noindent ";
        break;
      case "alignment":
        output.source += `\\${node.command} `;
        break;
      case "environment":
        output.source += `\\begin{${node.name}}`;
        printNested(node.children);
        output.source += `\\end{${node.name}}`;
        break;
      case "item":
        output.source += "\\item";
        if (node.label) {
          output.source += "[";
          printNested(node.label, "label");
          output.source += "]";
        }
        output.source += " ";
        break;
      case "vertical-glue":
        if (node.command === "vspace") {
          output.source += `\\vspace${node.starred ? "*" : ""}{${printDimension(node.size)}}`;
        } else if (node.command === "vskip") {
          output.source += `\\vskip ${printDimension(node.size)} `;
        } else {
          output.source += `\\${node.command} `;
        }
        break;
      case "penalty":
        if (!Number.isSafeInteger(node.value)) {
          throw new RangeError(`Cannot print non-integer TeX penalty ${node.value}.`);
        }
        output.source += `\\penalty ${node.value} `;
        break;
      case "vertical-rule":
        output.source += "\\hrule";
        if (node.width) output.source += ` width ${printDimension(node.width)}`;
        if (node.height) output.source += ` height ${printDimension(node.height)}`;
        if (node.depth) output.source += ` depth ${printDimension(node.depth)}`;
        output.source += " ";
        break;
      case "document-box":
        if (node.command === "parbox") {
          output.source += "\\parbox";
          if (node.position || node.height || node.innerPosition) {
            output.source += `[${node.position ?? "c"}]`;
          }
          if (node.height) output.source += `[${printDimension(node.height)}]`;
          if (node.innerPosition) {
            if (!node.height) throw new Error("Cannot print a parbox inner position without an explicit height.");
            output.source += `[${node.innerPosition}]`;
          }
          output.source += `{${printDimension(node.width)}}{`;
          printNested(node.children);
          output.source += "}";
        } else {
          output.source += `\\begin{minipage}${node.position ? `[${node.position}]` : ""}{${printDimension(node.width)}}`;
          printNested(node.children);
          output.source += "\\end{minipage}";
        }
        break;
      case "oracle-command":
        output.source += `\\${node.command}{}`;
        break;
    }
    output.spans.push({ path, kind: node.kind, start, end: output.source.length });
  });
}

export function printTexFuzzAst(ast: readonly TexFuzzNode[]): PrintedTexFuzzAst {
  const output = { source: "", spans: [] as TexFuzzSourceSpan[] };
  printNodes(ast, "root", output);
  return { source: output.source, sourceMap: output.spans };
}

export function applyTexFuzzMutations(source: string, mutations: readonly TexFuzzMutation[]): string {
  let result = source;
  for (const mutation of mutations) {
    const clamp = (offset: number): number => Math.max(0, Math.min(result.length, offset));
    switch (mutation.kind) {
      case "truncate":
        result = result.slice(0, clamp(mutation.offset));
        break;
      case "insert": {
        const offset = clamp(mutation.offset);
        result = result.slice(0, offset) + mutation.text + result.slice(offset);
        break;
      }
      case "delete": {
        const start = clamp(Math.min(mutation.start, mutation.end));
        const end = clamp(Math.max(mutation.start, mutation.end));
        result = result.slice(0, start) + result.slice(end);
        break;
      }
      case "replace": {
        const start = clamp(Math.min(mutation.start, mutation.end));
        const end = clamp(Math.max(mutation.start, mutation.end));
        result = result.slice(0, start) + mutation.text + result.slice(end);
        break;
      }
    }
  }
  return result;
}
