export type TikzOpenExample = {
  id: string;
  title: string;
  description: string;
  source: string;
  featureLabels: string[];
};

export const OPEN_EXAMPLE_CATALOG: readonly TikzOpenExample[] = [
  {
    id: "beamer-lecture",
    title: "Lecture Slides",
    description: "A Beamer deck with a theorem, a graph and step-by-step reveals.",
    featureLabels: ["beamer", "overlays", "columns"],
    source: String.raw`\documentclass[aspectratio=169]{beamer}
\usetheme{Madrid}
\usepackage{amsmath,amssymb,tikz}
\usetikzlibrary{arrows.meta}
\title{Shortest Paths}
\subtitle{A lecture in four slides}
\author{Your Name}
\institute{Your University}
\date{Spring Term}
\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{The problem}
  \begin{itemize}
    \item<1-> A directed graph with nonnegative edge weights
    \item<2-> A source vertex $s$
    \item<3-> Wanted: the distance $d(v)$ from $s$ to every vertex $v$
  \end{itemize}
  \begin{block}<4->{Observation}
    The closest unsettled vertex already has its final distance.
  \end{block}
\end{frame}

\begin{frame}{An example}
  \begin{columns}
    \begin{column}{0.5\textwidth}
      \begin{tikzpicture}[>=Stealth, vertex/.style={circle, draw, fill=blue!10, minimum size=8mm}]
        \node[vertex] (s) at (0,0) {$s$};
        \node[vertex] (a) at (2,1.2) {$a$};
        \node[vertex] (b) at (2,-1.2) {$b$};
        \node[vertex] (t) at (4,0) {$t$};
        \draw[->] (s) -- node[above left] {2} (a);
        \draw[->] (s) -- node[below left] {5} (b);
        \draw[->] (a) -- node[right] {1} (b);
        \draw[->] (a) -- node[above right] {6} (t);
        \draw[->] (b) -- node[below right] {2} (t);
      \end{tikzpicture}
    \end{column}
    \begin{column}{0.5\textwidth}
      \begin{enumerate}
        \item Settle $s$: $d(a)=2$, $d(b)=5$
        \item Settle $a$: $d(b)=3$, $d(t)=8$
        \item Settle $b$: $d(t)=5$
      \end{enumerate}
    \end{column}
  \end{columns}
\end{frame}

\begin{frame}{Why it works}
  \begin{theorem}
    When a vertex $u$ is settled, $d(u)$ is the length of a shortest path from $s$ to $u$.
  \end{theorem}
  \begin{proof}
    Any other path to $u$ leaves the settled set through a vertex at least as far as $u$,
    and the remaining edges have nonnegative weight.
  \end{proof}
\end{frame}

\end{document}`
  },
  {
    id: "beamer-talk",
    title: "Talk with Columns",
    description: "A short Beamer talk with blocks side by side.",
    featureLabels: ["beamer", "blocks", "columns"],
    source: String.raw`\documentclass{beamer}
\usetheme{Boadilla}
\usecolortheme{orchid}
\usepackage{tikz}
\title{Building a Diagram Step by Step}
\author{Your Name}
\date{}
\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{A cycle, one step at a time}
  \begin{columns}
    \begin{column}{0.45\textwidth}
      \begin{tikzpicture}[thick, every node/.style={circle, draw, fill=orange!20, minimum size=9mm}]
        \node (1) at (90:1.6) {1};
        \node (2) at (210:1.6) {2};
        \node (3) at (330:1.6) {3};
        \draw (1) -- (2) -- (3) -- (1);
      \end{tikzpicture}
    \end{column}
    \begin{column}{0.55\textwidth}
      \begin{itemize}[<+->]
        \item Start at vertex 1
        \item Walk to 2, then to 3
        \item Return to 1: a cycle of length three
      \end{itemize}
    \end{column}
  \end{columns}
\end{frame}

\begin{frame}{Two columns}
  \begin{columns}[T]
    \begin{column}{0.48\textwidth}
      \begin{block}{Before}
        \begin{itemize}
          \item Sketch on paper
          \item Retype coordinates
          \item Recompile, repeat
        \end{itemize}
      \end{block}
    \end{column}
    \begin{column}{0.48\textwidth}
      \begin{exampleblock}{After}
        \begin{itemize}
          \item Drag on the slide
          \item The source updates
          \item No recompiling
        \end{itemize}
      \end{exampleblock}
    \end{column}
  \end{columns}
\end{frame}

\end{document}`
  },
  {
    id: "axes",
    title: "Coordinate Axes",
    description: "Axes with two plotted functions.",
    featureLabels: ["axes", "plot", "functions"],
    source: String.raw`\begin{tikzpicture}[>=Stealth]
  \draw[->] (-0.4,0) -- (4.8,0) node[right] {$x$};
  \draw[->] (0,-0.4) -- (0,3.6) node[above] {$y$};

  \foreach \x in {1,2,3,4} {
    \draw (\x,-0.08) -- (\x,0.08) node[below=3pt] {\x};
  }
  \foreach \y in {1,2,3} {
    \draw (-0.08,\y) -- (0.08,\y) node[left=3pt] {\y};
  }

  \draw[thick,blue,domain=0:4,samples=50,smooth]
    plot (\x, {0.6*\x+0.3}) node[right] {$f$};
  \draw[thick,red,domain=0:4,samples=80,smooth]
    plot (\x, {1.6+1.2*sin(\x r)}) node[right] {$g$};
\end{tikzpicture}`
  },
  {
    id: "flowchart",
    title: "Flowchart",
    description: "Labelled boxes connected by arrows.",
    featureLabels: ["nodes", "arrows", "styles"],
    source: String.raw`\begin{tikzpicture}[
  box/.style={draw,rounded corners=2pt,fill=blue!10,minimum width=2.4cm,minimum height=9mm,align=center},
  >=Stealth
]
  \node[box] (start) at (0,0) {Start};
  \node[box] (step)  at (0,-1.6) {Process};
  \node[box] (check) at (0,-3.2) {Check};
  \node[box,fill=green!15] (done) at (4,-3.2) {Done};

  \draw[->] (start) -- (step);
  \draw[->] (step)  -- (check);
  \draw[->] (check) -- node[above] {ok} (done);
\end{tikzpicture}`
  },
  {
    id: "graph",
    title: "Graph",
    description: "Vertices and edges with a couple of labels.",
    featureLabels: ["nodes", "edges"],
    source: String.raw`\begin{tikzpicture}[
  vertex/.style={draw,circle,fill=white,inner sep=1.5pt,minimum size=6mm},
  every edge/.style={draw,thick}
]
  \node[vertex] (a) at (90:1.6)  {$a$};
  \node[vertex] (b) at (162:1.6) {$b$};
  \node[vertex] (c) at (234:1.6) {$c$};
  \node[vertex] (d) at (306:1.6) {$d$};
  \node[vertex] (e) at (18:1.6)  {$e$};

  \path (a) edge (b)
        (b) edge (c)
        (c) edge (d)
        (d) edge (e)
        (e) edge (a)
        (b) edge node[above,sloped] {$w$} (e);
\end{tikzpicture}`
  },
  {
    id: "tree",
    title: "Tree",
    description: "Hierarchical tree with styled nodes.",
    featureLabels: ["trees", "child"],
    source: String.raw`\begin{tikzpicture}[
  level distance=13mm,
  level 1/.style={sibling distance=28mm},
  level 2/.style={sibling distance=14mm},
  every node/.style={draw,rounded corners=2pt,fill=blue!8,minimum width=12mm,align=center}
]
  \node {Root}
    child { node {Left}
      child { node {L1} }
      child { node {L2} }
    }
    child { node {Right}
      child { node {R1} }
      child { node {R2} }
    };
\end{tikzpicture}`
  },
  {
    id: "automaton",
    title: "Finite-State Automaton",
    description: "States, transitions, an initial arrow and an accepting state.",
    featureLabels: ["nodes", "loops", "edges"],
    source: String.raw`\begin{tikzpicture}[
  state/.style={draw,circle,minimum size=10mm,inner sep=0pt},
  accept/.style={state,double},
  >=Stealth,
  every edge/.style={draw,->,thick}
]
  \node[state] (q0) at (0,0) {$q_0$};
  \node[state] (q1) at (2.4,0) {$q_1$};
  \node[accept] (q2) at (4.8,0) {$q_2$};

  \draw[->] (-1.1,0) -- (q0);

  \path (q0) edge node[above] {$a$} (q1)
        (q1) edge node[above] {$b$} (q2)
        (q1) edge[bend left=30] node[below] {$a$} (q0)
        (q2) edge[out=60,in=120,looseness=8] node[above] {$b$} (q2);
\end{tikzpicture}`
  },
  {
    id: "commutative-diagram",
    title: "Commutative Diagram",
    description: "A 2x2 square of objects with labelled arrows.",
    featureLabels: ["matrix", "arrows", "math"],
    source: String.raw`\begin{tikzpicture}[>=Stealth]
  \matrix (m) [matrix of math nodes, row sep=14mm, column sep=18mm] {
    A & B \\
    C & D \\
  };
  \draw[->] (m-1-1) -- node[above] {$f$} (m-1-2);
  \draw[->] (m-1-1) -- node[left]  {$g$} (m-2-1);
  \draw[->] (m-1-2) -- node[right] {$h$} (m-2-2);
  \draw[->] (m-2-1) -- node[below] {$k$} (m-2-2);
\end{tikzpicture}`
  },
  {
    id: "geometry",
    title: "Labelled Geometry",
    description: "A triangle with labelled points and a side length.",
    featureLabels: ["coordinates", "labels"],
    source: String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \coordinate (B) at (4,0);
  \coordinate (C) at (1.3,2.2);

  \draw[thick] (A) -- (B) -- (C) -- cycle;

  \fill (A) circle (1.2pt);
  \fill (B) circle (1.2pt);
  \fill (C) circle (1.2pt);

  \node[below left]  at (A) {$A$};
  \node[below right] at (B) {$B$};
  \node[above]       at (C) {$C$};
  \node[below]       at (2,0) {$c$};
\end{tikzpicture}`
  },
  {
    id: "venn",
    title: "Venn Diagram",
    description: "Two overlapping sets with labels.",
    featureLabels: ["circles", "fill", "labels"],
    source: String.raw`\begin{tikzpicture}
  \draw[fill=blue!20,fill opacity=0.5] (0,0) circle (1.4);
  \draw[fill=red!20,fill opacity=0.5]  (1.6,0) circle (1.4);

  \node at (-0.6,0)  {$A$};
  \node at (2.2,0)   {$B$};
  \node at (0.8,0)   {$A\cap B$};

  \node[below] at (0.8,-1.6) {$A\cup B$};
\end{tikzpicture}`
  },
  {
    id: "digraph",
    title: "Directed Graph",
    description: "Nodes with directed edges and a self-loop.",
    featureLabels: ["nodes", "arrows", "loop"],
    source: String.raw`\begin{tikzpicture}[
  vertex/.style={draw,circle,inner sep=1.5pt,minimum size=6mm},
  >=Stealth,
  every edge/.style={draw,->,thick}
]
  \node[vertex] (1) at (0,0)    {$1$};
  \node[vertex] (2) at (2,0.8)  {$2$};
  \node[vertex] (3) at (3.6,0)  {$3$};
  \node[vertex] (4) at (2,-1)   {$4$};

  \path (1) edge (2)
        (2) edge (3)
        (3) edge (4)
        (4) edge (1)
        (1) edge (3)
        (3) edge[out=60,in=330,looseness=8] (3);
\end{tikzpicture}`
  },
  {
    id: "flow-network",
    title: "Flow Network",
    description: "Source, two intermediate layers, and a sink with capacities.",
    featureLabels: ["graph", "arrows", "labels"],
    source: String.raw`\begin{tikzpicture}[
  vertex/.style={draw,circle,fill=white,inner sep=1.5pt,minimum size=7mm},
  >=Stealth,
  every edge/.style={draw,->,thick}
]
  \node[vertex] (s)  at (0,0)     {$s$};
  \node[vertex] (a1) at (2,1.2)   {$a$};
  \node[vertex] (a2) at (2,-1.2)  {$b$};
  \node[vertex] (b1) at (4.2,1.2) {$c$};
  \node[vertex] (b2) at (4.2,-1.2){$d$};
  \node[vertex] (t)  at (6.2,0)   {$t$};

  \path (s)  edge node[above,sloped] {$10$} (a1)
        (s)  edge node[below,sloped] {$8$}  (a2)
        (a1) edge node[above] {$6$}         (b1)
        (a1) edge node[above,sloped,pos=0.3] {$3$} (b2)
        (a2) edge node[below] {$9$}         (b2)
        (b1) edge node[above,sloped] {$7$}  (t)
        (b2) edge node[below,sloped] {$5$}  (t);
\end{tikzpicture}`
  },
  {
    id: "bipartite",
    title: "Bipartite Graph",
    description: "Two columns of vertices connected across.",
    featureLabels: ["graph", "edges"],
    source: String.raw`\begin{tikzpicture}[
  vertex/.style={draw,circle,fill=white,inner sep=1.5pt,minimum size=6mm},
  every edge/.style={draw,thick}
]
  \foreach \i/\name in {1/x_1, 2/x_2, 3/x_3, 4/x_4} {
    \node[vertex] (l\i) at (0,-\i) {$\name$};
  }
  \foreach \i/\name in {1/y_1, 2/y_2, 3/y_3} {
    \node[vertex] (r\i) at (3,-\i-0.5) {$\name$};
  }

  \path (l1) edge (r1)
        (l1) edge (r2)
        (l2) edge (r1)
        (l2) edge (r3)
        (l3) edge (r2)
        (l4) edge (r2)
        (l4) edge (r3);
\end{tikzpicture}`
  },
  {
    id: "swimlane",
    title: "Swimlane Diagram",
    description: "Two horizontal lanes with steps and cross-lane arrows.",
    featureLabels: ["nodes", "lanes", "arrows"],
    source: String.raw`\begin{tikzpicture}[
  step/.style={draw,rounded corners=2pt,fill=blue!10,minimum width=2cm,minimum height=8mm,align=center},
  >=Stealth
]
  \draw[gray!50] (-0.3,-0.8) rectangle (8.7,0.8);
  \draw[gray!50] (-0.3,-2.6) rectangle (8.7,-1.0);
  \node[anchor=east] at (-0.4,0)    {User};
  \node[anchor=east] at (-0.4,-1.8) {System};

  \node[step] (u1) at (1,0)    {Request};
  \node[step] (s1) at (3.5,-1.8) {Validate};
  \node[step] (s2) at (6,-1.8)   {Process};
  \node[step] (u2) at (7.5,0)    {Result};

  \draw[->] (u1) -- (s1);
  \draw[->] (s1) -- (s2);
  \draw[->] (s2) -- (u2);
\end{tikzpicture}`
  },
  {
    id: "decision-tree",
    title: "Decision Tree",
    description: "Tree with yes/no edge labels and leaf outcomes.",
    featureLabels: ["trees", "labels"],
    source: String.raw`\begin{tikzpicture}[
  decision/.style={draw,diamond,aspect=2,fill=yellow!20,inner sep=2pt,align=center},
  outcome/.style={draw,rectangle,rounded corners=2pt,fill=green!15,minimum width=14mm,minimum height=7mm,align=center},
  >=Stealth
]
  \node[decision] (q1) at (0,0)     {$x > 0$?};
  \node[decision] (q2) at (-2.2,-2) {$y > 0$?};
  \node[outcome]  (C)  at (2.2,-2)  {No action};
  \node[outcome]  (A)  at (-3.4,-4) {Accept};
  \node[outcome]  (B)  at (-1.0,-4) {Review};

  \draw[->] (q1) -- node[above left=-2pt]  {yes} (q2);
  \draw[->] (q1) -- node[above right=-2pt] {no}  (C);
  \draw[->] (q2) -- node[above left=-2pt]  {yes} (A);
  \draw[->] (q2) -- node[above right=-2pt] {no}  (B);
\end{tikzpicture}`
  },
  {
    id: "bar-chart",
    title: "Bar Chart",
    description: "Labelled bars with a baseline and value axis.",
    featureLabels: ["rectangles", "axes", "labels"],
    source: String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- (0,3.3) node[above] {count};
  \draw (0,0) -- (5.4,0);
  \foreach \y in {1,2,3} {
    \draw (-0.08,\y) -- (0.08,\y) node[left=3pt] {\y};
  }

  \foreach \i/\h/\name in {1/1.8/A, 2/2.6/B, 3/1.2/C, 4/2.9/D, 5/2.1/E} {
    \draw[fill=blue!30] (\i-0.35,0) rectangle (\i+0.35,\h);
    \node[below] at (\i,0) {\name};
  }
\end{tikzpicture}`
  },
  {
    id: "shaded-region",
    title: "Shaded Region",
    description: "Area under a curve, shaded between two bounds.",
    featureLabels: ["plot", "fill", "axes"],
    source: String.raw`\begin{tikzpicture}[>=Stealth]
  \draw[->] (-0.4,0) -- (4.8,0) node[right] {$x$};
  \draw[->] (0,-0.4) -- (0,3.8) node[above] {$y$};

  \foreach \y in {1,2,3} {
    \draw (-0.08,\y) -- (0.08,\y) node[left=3pt] {\y};
  }

  \fill[blue!25] (0.8,0)
    -- (0.8,2.28) -- (1.0,2.5)  -- (1.2,2.68) -- (1.4,2.82)
    -- (1.6,2.92) -- (1.8,2.98) -- (2.0,3.0)  -- (2.2,2.98)
    -- (2.4,2.92) -- (2.6,2.82) -- (2.8,2.68) -- (3.0,2.5)
    -- (3.2,2.28) -- (3.2,0) -- cycle;

  \draw[thick,blue,domain=0:4,samples=80,smooth]
    plot (\x, {3 - 0.5*(\x-2)*(\x-2)}) node[above right] {$f$};

  \draw (0.8,-0.08) -- (0.8,0.08) node[below=3pt] {$a$};
  \draw (3.2,-0.08) -- (3.2,0.08) node[below=3pt] {$b$};
\end{tikzpicture}`
  },
  {
    id: "hasse",
    title: "Hasse Diagram",
    description: "Partial order drawn with bottom-up covering edges.",
    featureLabels: ["poset", "nodes", "edges"],
    source: String.raw`\begin{tikzpicture}[
  vertex/.style={draw,rectangle,rounded corners=1pt,fill=white,inner sep=3pt,minimum height=6mm},
  every edge/.style={draw,thick}
]
  \node[vertex] (0)   at (0,0)    {$\emptyset$};
  \node[vertex] (a)   at (-2,1.3) {$\{a\}$};
  \node[vertex] (b)   at (0,1.3)  {$\{b\}$};
  \node[vertex] (c)   at (2,1.3)  {$\{c\}$};
  \node[vertex] (ab)  at (-2,2.8) {$\{a,b\}$};
  \node[vertex] (ac)  at (0,2.8)  {$\{a,c\}$};
  \node[vertex] (bc)  at (2,2.8)  {$\{b,c\}$};
  \node[vertex] (abc) at (0,4.2)  {$\{a,b,c\}$};

  \path (0) edge (a) edge (b) edge (c)
        (a) edge (ab) edge (ac)
        (b) edge (ab) edge (bc)
        (c) edge (ac) edge (bc)
        (ab) edge (abc)
        (ac) edge (abc)
        (bc) edge (abc);
\end{tikzpicture}`
  }
];
