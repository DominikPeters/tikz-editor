/**
 * Charts the type switch is checked on (packages/core/src/edit/pgfplots/chart-type.ts):
 * the insert templates and hand-written "real-ish" charts. Shared by the
 * conversion matrix test (test/pgfplots-chart-type.spec.ts) and the LuaLaTeX
 * check of every offered conversion (scripts/pgfplots-oracle/experiments/e26-chart-type-cases.ts).
 * The texts are ours.
 */
import { CHART_KINDS } from "../../../packages/core/src/edit/pgfplots/chart-kinds.js";

export type ChartTypeFixture = { id: string; picture: string };

const picture = (axis: string) => `\\begin{tikzpicture}\n${axis}\n\\end{tikzpicture}`;

export const CHART_TYPE_FIXTURES: readonly ChartTypeFixture[] = [
  ...CHART_KINDS.map((kind) => ({ id: `template-${kind.id}`, picture: picture(kind.template) })),
  {
    // Several plots, a legend, own colours and marks, a grid.
    id: "real-colours-legend",
    picture: picture(String.raw`\begin{axis}[xlabel={Year}, ylabel={Revenue}, legend pos=north west, grid=major]
  \addplot[blue, thick, mark=*] coordinates {(2019,2.1) (2020,2.8) (2021,3.5) (2022,4.1)};
  \addlegendentry{North}
  \addplot+[red, mark=square*] coordinates {(2019,1.2) (2020,1.9) (2021,2.2) (2022,3.0)};
  \addlegendentry{South}
\end{axis}`)
  },
  {
    // Grouped bars over symbolic categories, with a legend.
    id: "real-symbolic-bars",
    picture: picture(String.raw`\begin{axis}[ybar, ymin=0, symbolic x coords={Mon,Tue,Wed,Thu}, xtick=data, legend pos=north west]
  \addplot coordinates {(Mon,3) (Tue,5) (Wed,2) (Thu,4)};
  \addlegendentry{Team A}
  \addplot coordinates {(Mon,4) (Tue,1) (Wed,3) (Thu,2)};
  \addlegendentry{Team B}
\end{axis}`)
  },
  {
    // An inline table with named columns.
    id: "real-table",
    picture: picture(String.raw`\begin{axis}[xlabel={$t$ (s)}, ylabel={$v$ (m/s)}]
  \addplot table [x=t, y=v] {
    t v
    0 1.0
    1 1.5
    2 3.0
    3 2.2
    4 2.6
  };
  \addlegendentry{run 1}
\end{axis}`)
  },
  {
    // A log y axis: lines and scatter switch, bars and areas do not.
    id: "real-log",
    picture: picture(String.raw`\begin{axis}[ymode=log, xlabel={Size}, ylabel={Time}]
  \addplot coordinates {(1,10) (2,100) (3,50) (4,1000)};
  \addplot+[only marks] coordinates {(1,20) (2,60) (3,300) (4,500)};
\end{axis}`)
  },
  {
    // A plot in an axis scope with options (behaviour AC5) and one outside.
    id: "real-scope",
    picture: picture(String.raw`\begin{axis}[ymin=0]
  \begin{scope}[densely dashed]
    \addplot coordinates {(0,1) (1,2) (2,1.5) (3,2.5)};
  \end{scope}
  \addplot coordinates {(0,2) (1,2.5) (2,3) (3,3.2)};
\end{axis}`)
  },
  {
    // Settings between plots: a safe key (samples) and one that sets a type (`smooth`, AB2).
    id: "real-settings-safe",
    picture: picture(String.raw`\begin{axis}[domain=0:3]
  \addplot coordinates {(0,1) (1,2) (2,1.5) (3,2.5)};
  \pgfplotsset{samples=7}
  \addplot {x};
\end{axis}`)
  },
  {
    id: "real-settings-smooth",
    picture: picture(String.raw`\begin{axis}
  \addplot coordinates {(0,1) (1,2) (2,1.5) (3,2.5)};
  \pgfplotsset{smooth}
  \addplot coordinates {(0,2) (1,2.5) (2,3) (3,3.2)};
\end{axis}`)
  },
  {
    // A legend and plots without marks.
    id: "real-legend-no-marks",
    picture: picture(String.raw`\begin{axis}[ymin=0, legend pos=north west]
  \addplot+[mark=none] coordinates {(1,2) (2,3) (3,2.5) (4,4)};
  \addlegendentry{measured}
  \addplot+[mark=none, dashed] coordinates {(1,1.5) (2,2) (3,3) (4,3.5)};
  \addlegendentry{model}
\end{axis}`)
  },
  {
    // Two filled areas with own colours.
    id: "real-areas",
    picture: picture(String.raw`\begin{axis}[ymin=0, xlabel={Hour}]
  \addplot+[fill, fill opacity=0.3, mark=none] coordinates {(0,1) (1,3) (2,2) (3,4)} \closedcycle;
  \addplot+[green!50!black, fill, fill opacity=0.3, mark=none] coordinates {(0,0.5) (1,1) (2,1.5) (3,1)} \closedcycle;
\end{axis}`)
  },
  {
    // A user style and `nodes near coords`: refused, with the key named.
    id: "real-user-style",
    picture: picture(String.raw`\pgfplotsset{mystyle/.style={thick}}
\begin{axis}[nodes near coords]
  \addplot+[mystyle] coordinates {(0,1) (1,2) (2,1.5)};
\end{axis}`)
  },
  {
    // A smooth function and a step plot of data together.
    id: "real-smooth-step",
    picture: picture(String.raw`\begin{axis}[domain=0:4, samples=20, ymin=-0.5]
  \addplot+[smooth, mark=none] {sin(deg(x))};
  \addplot+[const plot] coordinates {(0,0) (1,0.5) (2,-0.2) (3,0.4) (4,0.1)};
\end{axis}`)
  }
];

export const CHART_TYPE_PREAMBLE = "\\pgfplotsset{compat=1.18}\n";
