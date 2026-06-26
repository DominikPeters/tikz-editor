export const capabilityFixtures: Record<string, string> = {
  basic_draw: String.raw`\begin{tikzpicture}
  \draw[thick, ->] (0,0) -- (1,1) -| (2,0) |- (3,1);
\end{tikzpicture}`,
  scope_transform: String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1cm,yshift=2cm,rotate=10]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`,
  transform_cm: String.raw`\begin{tikzpicture}
  \draw[cm={0,1,1,0,(1cm,1cm)}] (0,0) -- (1,1) -- (1,0);
\end{tikzpicture}`,
  foreach_basic: String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} \draw (\x,0) -- ++(1,0);
\end{tikzpicture}`,
  foreach_path_basic: String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (\x,0) };
\end{tikzpicture}`,
  foreach_node_basic: String.raw`\begin{tikzpicture}
  \path (0,0) -- (2,0) node foreach \p in {0.25,0.75} [pos=\p] {\p};
\end{tikzpicture}`,
  pic_inline_code: String.raw`\begin{tikzpicture}
  \pic at (1,0) [pics/code={\draw (0,0) -- (1,0); \node at (.5,.25) {P};}] {};
\end{tikzpicture}`,
  pic_simple_definition: String.raw`\begin{tikzpicture}
  \tikzset{tick/.pic={\draw (0,-.1) -- (0,.1);}, pics/dot/.style={code={\fill (0,0) circle [radius=1pt];}}}
  \pic at (0,0) {tick};
  \pic at (1,0) {dot};
\end{tikzpicture}`,
  pic_path_placement: String.raw`\begin{tikzpicture}
  \tikzset{mark/.pic={\draw[red] (0,0) circle [radius=2pt];}}
  \path (0,0) -- (2,0) pic[pos=.5,rotate=30] {mark};
\end{tikzpicture}`,
  pic_template_editing: String.raw`\begin{tikzpicture}
  \tikzset{bar/.pic={\draw[line width=.4pt,blue] (0,0) -- (1,0);}}
  \pic at (0,0) {bar};
  \pic at (0,1) {bar};
\end{tikzpicture}`,
  foreach_options_core: String.raw`\begin{tikzpicture}
  \foreach \x [count=\i from 1, evaluate=\x as \y using \x*2] in {1,2}
    \draw (\i,0) -- (\y,0);
\end{tikzpicture}`,
  unknown_statement: String.raw`\begin{tikzpicture}
  \foo bar;
\end{tikzpicture}`,
  pgfmath_expression: String.raw`\begin{tikzpicture}
  \foreach \x [evaluate=\x as \y using (\x<2 ? \x+1 : \x*2)] in {1,2}
    \node at (\x,0) {\y};
\end{tikzpicture}`,
  pgfmath_seed_commands: String.raw`\begin{tikzpicture}
  \pgfmathsetseed{7};
  \pgfmathsetmacro{\n}{random(1,9)};
  \node at (0,0) {\n};
\end{tikzpicture}`,
  pgfmath_random_functions: String.raw`\begin{tikzpicture}
  \pgfmathsetseed{5};
  \foreach \x [evaluate=\x as \r using random(1,5)] in {1,2}
    \node at (\x,0) {\r};
\end{tikzpicture}`,
  option_styles: String.raw`\begin{tikzpicture}
  \draw[red,fill=blue,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`,
  shading_styles: String.raw`\begin{tikzpicture}
  \shade[top color=red,bottom color=blue] (0,0) rectangle (1,1);
\end{tikzpicture}`,
  pattern_styles: String.raw`\begin{tikzpicture}
  \draw[pattern=grid,pattern color=red] (0,0) rectangle (1,1);
  \draw[pattern={Lines[angle=45,distance=4pt]},pattern color=blue] (2,0) rectangle (3,1);
\end{tikzpicture}`,
  shadow_styles: String.raw`\begin{tikzpicture}
  \draw[drop shadow,fill=white] (0,0) rectangle (1,1);
\end{tikzpicture}`,
  path_clipping: String.raw`\begin{tikzpicture}
  \clip (0,0) rectangle (1,1);
  \fill[red] (-1,-1) rectangle (2,2);
\end{tikzpicture}`,
  use_as_bounding_box: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (0,0) rectangle (1,1);
  \fill[red] (-1,-1) rectangle (3,3);
\end{tikzpicture}`,
  backgrounds_library: String.raw`\begin{tikzpicture}[framed]
  \begin{scope}[on background layer={draw=yellow}]
    \draw (-0.2,-0.2) rectangle (1.2,0.2);
  \end{scope}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`,
  arrow_tips: String.raw`\begin{tikzpicture}[>=Stealth]
  \draw[arrows={-Latex[open,length=10pt]}] (0,0) -- (1,0);
\end{tikzpicture}`,
  curve_operator: String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
\end{tikzpicture}`,
  cycle_polygon: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`,
  rectangle_shape: String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`,
  rounded_rectangle_shape: String.raw`\begin{tikzpicture}
  \node[rounded rectangle,draw] at (0,0) {R};
\end{tikzpicture}`,
  chamfered_rectangle_shape: String.raw`\begin{tikzpicture}
  \node[chamfered rectangle,draw] at (0,0) {C};
\end{tikzpicture}`,
  cross_out_shape: String.raw`\begin{tikzpicture}
  \node[cross out,draw] at (0,0) {X};
\end{tikzpicture}`,
  strike_out_shape: String.raw`\begin{tikzpicture}
  \node[strike out,draw] at (0,0) {S};
\end{tikzpicture}`,
  circle_shape: String.raw`\begin{tikzpicture}
  \draw (0,0) circle [radius=1cm];
\end{tikzpicture}`,
  magnifying_glass_shape: String.raw`\begin{tikzpicture}
  \node[magnifying glass,draw] at (0,0) {M};
\end{tikzpicture}`,
  circle_split_shape: String.raw`\begin{tikzpicture}
  \node[circle split,draw] at (0,0) {A\nodepart{lower}B};
\end{tikzpicture}`,
  circle_solidus_shape: String.raw`\begin{tikzpicture}
  \node[circle solidus,draw] at (0,0) {A\nodepart{lower}B};
\end{tikzpicture}`,
  ellipse_split_shape: String.raw`\begin{tikzpicture}
  \node[ellipse split,draw] at (0,0) {A\nodepart{lower}B};
\end{tikzpicture}`,
  diamond_split_shape: String.raw`\begin{tikzpicture}
  \node[diamond split,draw] at (0,0) {A\nodepart{lower}B};
\end{tikzpicture}`,
  rectangle_split_shape: String.raw`\begin{tikzpicture}
  \node[rectangle split,rectangle split parts=3,draw] at (0,0) {A\nodepart{two}B\nodepart{three}C};
\end{tikzpicture}`,
  ellipse_shape: String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm,y radius=0.5cm];
\end{tikzpicture}`,
  diamond_shape: String.raw`\begin{tikzpicture}
  \node[diamond,draw] at (0,0) {D};
\end{tikzpicture}`,
  trapezium_shape: String.raw`\begin{tikzpicture}
  \node[trapezium,draw,trapezium left angle=75,trapezium right angle=45] at (0,0) {T};
\end{tikzpicture}`,
  semicircle_shape: String.raw`\begin{tikzpicture}
  \node[semicircle,draw] at (0,0) {S};
\end{tikzpicture}`,
  isosceles_triangle_shape: String.raw`\begin{tikzpicture}
  \node[isosceles triangle,draw,isosceles triangle apex angle=50] at (0,0) {I};
\end{tikzpicture}`,
  kite_shape: String.raw`\begin{tikzpicture}
  \node[kite,draw,kite upper vertex angle=120,kite lower vertex angle=70] at (0,0) {K};
\end{tikzpicture}`,
  dart_shape: String.raw`\begin{tikzpicture}
  \node[dart,draw,dart tip angle=45,dart tail angle=135] at (0,0) {D};
\end{tikzpicture}`,
  circular_sector_shape: String.raw`\begin{tikzpicture}
  \node[circular sector,draw,circular sector angle=70] at (0,0) {C};
\end{tikzpicture}`,
  cylinder_shape: String.raw`\begin{tikzpicture}
  \node[cylinder,draw,aspect=.6] at (0,0) {Y};
\end{tikzpicture}`,
  regular_polygon_shape: String.raw`\begin{tikzpicture}
  \node[regular polygon,regular polygon sides=6,draw] at (0,0) {R};
\end{tikzpicture}`,
  star_shape: String.raw`\begin{tikzpicture}
  \node[star,star points=5,star point ratio=1.65,draw] at (0,0) {S};
\end{tikzpicture}`,
  cloud_shape: String.raw`\begin{tikzpicture}
  \node[cloud,cloud puffs=11,draw] at (0,0) {C};
\end{tikzpicture}`,
  starburst_shape: String.raw`\begin{tikzpicture}
  \node[starburst,starburst points=13,starburst point height=4pt,draw] at (0,0) {B};
\end{tikzpicture}`,
  signal_shape: String.raw`\begin{tikzpicture}
  \node[signal,signal to=east and west,signal from=north and south,draw] at (0,0) {G};
\end{tikzpicture}`,
  tape_shape: String.raw`\begin{tikzpicture}
  \node[tape,tape bend top=out and in,tape bend bottom=in and out,draw] at (0,0) {T};
\end{tikzpicture}`,
  rectangle_callout_shape: String.raw`\begin{tikzpicture}
  \node[rectangle callout,callout relative pointer={(1cm,-6mm)},draw] at (0,0) {R};
\end{tikzpicture}`,
  ellipse_callout_shape: String.raw`\begin{tikzpicture}
  \node[ellipse callout,callout relative pointer={(1cm,-6mm)},callout pointer arc=20,draw] at (0,0) {E};
\end{tikzpicture}`,
  cloud_callout_shape: String.raw`\begin{tikzpicture}
  \node[cloud callout,cloud puffs=11,callout relative pointer={(315:2cm)},callout pointer segments=3,draw] at (0,0) {C};
\end{tikzpicture}`,
  single_arrow_shape: String.raw`\begin{tikzpicture}
  \node[single arrow,single arrow tip angle=60,single arrow head extend=4pt,draw] at (0,0) {A};
\end{tikzpicture}`,
  double_arrow_shape: String.raw`\begin{tikzpicture}
  \node[double arrow,double arrow tip angle=60,double arrow head indent=2pt,draw] at (0,0) {D};
\end{tikzpicture}`,
  coordinate_operation: String.raw`\begin{tikzpicture}
  \path coordinate (p1) at (1,0);
  \draw (0,0) -- (p1);
\end{tikzpicture}`,
  graph_operation: String.raw`\begin{tikzpicture}
  \graph [nodes={draw,circle}] { a -> b -> {c, d} };
\end{tikzpicture}`,
  plot_operation: String.raw`\begin{tikzpicture}
  \draw plot coordinates {(0,0) (1,1) (2,0)};
  \draw[domain=0:2,samples=5] plot (\x,{exp(\x/2)});
\end{tikzpicture}`,
  to_operation: String.raw`\begin{tikzpicture}
  \draw (0,0) to (1,1);
\end{tikzpicture}`,
  edge_operation: String.raw`\begin{tikzpicture}
  \path (0,0) edge[->,dotted] (1,1);
\end{tikzpicture}`,
  tree_child_operation: String.raw`\begin{tikzpicture}
  \path (0,0) node {root}
    child { node {left} }
    child { node {right} };
\end{tikzpicture}`,
  tree_edge_from_parent: String.raw`\begin{tikzpicture}
  \path node (r) {root}
    child { node (c) {leaf} edge from parent node[left] {L} };
\end{tikzpicture}`,
  tree_layout_keys: String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=8mm,sibling distance=12mm]
    node {root}
    child { node {a} }
    child { node {b} };
\end{tikzpicture}`,
  tree_level_styles: String.raw`\begin{tikzpicture}
  \path[level/.style={sibling distance=#1mm}, level 2/.style={sibling distance=20pt}]
    node {root}
    child { node {a} child { node {a1} } child { node {a2} } }
    child { node {b} child { node {b1} } };
\end{tikzpicture}`,
  tree_every_child_styles: String.raw`\begin{tikzpicture}
  \path[every child/.style={draw}, every child node/.style={fill=yellow}]
    node {root}
    child { node {left} }
    child { node {right} };
\end{tikzpicture}`,
  tree_anchor_keys: String.raw`\begin{tikzpicture}
  \path[growth parent anchor=south,parent anchor=south,child anchor=north]
    node[draw] {root}
    child { node[draw] {leaf} };
\end{tikzpicture}`,
  tree_missing_child: String.raw`\begin{tikzpicture}
  \path node {root}
    child[missing] {}
    child { node {visible} };
\end{tikzpicture}`,
  tree_auto_naming: String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} }
    child { node {right} };
\end{tikzpicture}`,
  tree_deferred_hooks: String.raw`\begin{tikzpicture}
  \path[growth function={\pgfmathsetmacro{\x}{#1}}, edge from parent path={(\tikzparentnode) -- (\tikzchildnode)}, edge from parent macro=\myhook]
    node {root}
    child { node {leaf} };
\end{tikzpicture}`,
  svg_operation: String.raw`\begin{tikzpicture}
  \draw (0,0) svg {h 10 v 10 h -10};
\end{tikzpicture}`,
  let_operation: String.raw`\begin{tikzpicture}
  \path let \p1 = (1,1) in (0,0) -- (\p1);
\end{tikzpicture}`,
  decorate_operation: String.raw`\begin{tikzpicture}
  \draw decorate[decoration=zigzag] {(0,0) -- (2,0)};
\end{tikzpicture}`,
  decorate_option: String.raw`\begin{tikzpicture}
  \draw[decorate,decoration=snake] (0,0) -- (2,0);
\end{tikzpicture}`,
  decoration_pathmorphing: String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={coil,segment length=10pt,amplitude=2pt}] (0,0) -- (2,0);
\end{tikzpicture}`,
  decoration_pathreplacing: String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={ticks,segment length=6pt,amplitude=2pt}] (0,0) -- (2,0);
\end{tikzpicture}`,
  decoration_fractals: String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={Koch snowflake}] (0,0) -- (2,0);
\end{tikzpicture}`,
  decoration_shape_marks: String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={crosses,segment length=6pt,shape size=3pt}] (0,0) -- (2,0);
\end{tikzpicture}`,
  decoration_footprints: String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={footprints,stride length=12pt,foot length=4pt}] (0,0) -- (2,0);
\end{tikzpicture}`,
  decoration_shape_backgrounds: String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={shape backgrounds,shape=rectangle,shape sep=8pt,shape width=4pt,shape height=3pt}] (0,0) -- (2,0);
\end{tikzpicture}`,
  ellipse_keyword: String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm,y radius=0.5cm];
\end{tikzpicture}`,
  arc_keyword: String.raw`\begin{tikzpicture}
  \draw (0,0) arc [start angle=0,end angle=90,radius=1cm];
\end{tikzpicture}`,
  grid_keyword: String.raw`\begin{tikzpicture}
  \draw (0,0) grid (2,2);
\end{tikzpicture}`,
  node_text: String.raw`\begin{tikzpicture}
  \node at (1,1) {Hello};
\end{tikzpicture}`,
  matrix_basic: String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=4mm,column sep=6mm] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`,
  fit_basic: String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (1,1) {};
  \node[draw,fit=(a) (b)] {};
\end{tikzpicture}`
};
