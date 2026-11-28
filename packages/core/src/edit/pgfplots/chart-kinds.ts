/**
 * The kinds of chart the editor inserts, in one list for every place that
 * offers them: the Insert menu, the toolbar gallery and (later) the chart
 * type switcher, so the lists never diverge. Each kind has a stable id, a
 * label and its template; the texts are ours (AGENTS.md: no manual examples).
 *
 * `convertibleFrom` says which kinds Change Chart Type can turn into this
 * one by option edits alone (switching type keeps the data statements). It
 * is the static part of the rule; whether a given chart can switch is decided
 * by chart-type.ts from its options and data. Function and Data Plot are the
 * line chart of expressions and of data; Log-Scale Plot is a scale, set in
 * the inspector's Axes section, so nothing converts into it.
 */
export type ChartKindId = "function" | "data" | "scatter" | "bar" | "stacked-bar" | "area" | "semilogy";

export type ChartKind = {
  id: ChartKindId;
  /** Menu and gallery label (title case, like the other Insert menu items). */
  label: string;
  /** The axis environment, with its plots, written into the picture. */
  template: string;
  /** For the type switcher: whether an axis of kind `from` can become this kind by option edits. */
  convertibleFrom?: (from: ChartKindId) => boolean;
};

const convertibleFrom = (kinds: readonly ChartKindId[]) => (from: ChartKindId): boolean => kinds.includes(from);

export const CHART_KINDS: readonly ChartKind[] = [
  {
    id: "function",
    label: "Function Plot",
    template: String.raw`\begin{axis}[xlabel={$x$}, ylabel={$f(x)$}, domain=-2:2, samples=50]
  \addplot {x^2 - 1};
  \addlegendentry{$x^2 - 1$}
\end{axis}`,
    convertibleFrom: convertibleFrom(["area", "bar", "stacked-bar"])
  },
  {
    id: "data",
    label: "Data Plot",
    template: String.raw`\begin{axis}[xlabel={Time}, ylabel={Value}]
  \addplot coordinates {(0,1.2) (1,2.3) (2,2.9) (3,4.1) (4,4.8)};
  \addlegendentry{Measurements}
\end{axis}`,
    convertibleFrom: convertibleFrom(["scatter", "bar", "stacked-bar", "area"])
  },
  {
    id: "scatter",
    label: "Scatter Plot",
    template: String.raw`\begin{axis}[xlabel={Height}, ylabel={Weight}]
  \addplot+[only marks] coordinates {(1.2,2.1) (1.9,2.4) (2.3,3.6) (2.8,3.1) (3.4,4.4) (3.9,4.0)};
  \addlegendentry{Samples}
\end{axis}`,
    convertibleFrom: convertibleFrom(["data", "bar", "stacked-bar", "area"])
  },
  {
    id: "bar",
    label: "Bar Chart",
    template: String.raw`\begin{axis}[ybar, ymin=0, xlabel={Quarter}, ylabel={Sales},
  symbolic x coords={Q1,Q2,Q3,Q4}, xtick=data]
  \addplot coordinates {(Q1,3) (Q2,5) (Q3,4) (Q4,6)};
\end{axis}`,
    convertibleFrom: convertibleFrom(["function", "data", "scatter", "stacked-bar", "area"])
  },
  {
    id: "stacked-bar",
    label: "Stacked Bar Chart",
    template: String.raw`\begin{axis}[ybar stacked, ymin=0, xlabel={Quarter}, ylabel={Sales},
  symbolic x coords={Q1,Q2,Q3,Q4}, xtick=data]
  \addplot coordinates {(Q1,3) (Q2,5) (Q3,4) (Q4,6)};
  \addlegendentry{North}
  \addplot coordinates {(Q1,2) (Q2,1) (Q3,3) (Q4,2)};
  \addlegendentry{South}
\end{axis}`,
    convertibleFrom: convertibleFrom(["function", "data", "scatter", "bar", "area"])
  },
  {
    id: "area",
    label: "Area Plot",
    template: String.raw`\begin{axis}[xlabel={Time}, ylabel={Load}, ymin=0]
  \addplot+[fill, fill opacity=0.3, mark=none] coordinates {(0,1) (1,3) (2,2.5) (3,4) (4,3.2)} \closedcycle;
\end{axis}`,
    convertibleFrom: convertibleFrom(["function", "data", "scatter", "bar", "stacked-bar"])
  },
  {
    id: "semilogy",
    label: "Log-Scale Plot",
    template: String.raw`\begin{semilogyaxis}[xlabel={$x$}, ylabel={$10^x$}, domain=0:3, samples=31]
  \addplot {10^x};
\end{semilogyaxis}`,
    convertibleFrom: convertibleFrom([])
  }
];

export function chartKind(id: ChartKindId): ChartKind {
  const kind = CHART_KINDS.find((candidate) => candidate.id === id);
  if (!kind) throw new Error(`Unknown chart kind ${id}`);
  return kind;
}

export function isChartKindId(value: string): value is ChartKindId {
  return CHART_KINDS.some((kind) => kind.id === value);
}

/** A whole document with the chart, for previews and compile checks. */
export function chartKindDocument(id: ChartKindId): string {
  return [
    "\\documentclass{standalone}",
    "\\usepackage{pgfplots}",
    "\\pgfplotsset{compat=1.18}",
    "\\begin{document}",
    "\\begin{tikzpicture}",
    chartKind(id).template,
    "\\end{tikzpicture}",
    "\\end{document}",
    ""
  ].join("\n");
}
