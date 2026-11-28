import type { OptionListAst } from "../options/types.js";

export type Span = { from: number; to: number };

export type AdornmentOwnerGeometry = {
  shape:
    | "rectangle"
    | "rounded rectangle"
    | "chamfered rectangle"
    | "cross out"
    | "strike out"
    | "circle"
    | "magnifying glass"
    | "circle split"
    | "circle solidus"
    | "ellipse split"
    | "diamond split"
    | "rectangle split"
    | "ellipse"
    | "diamond"
    | "trapezium"
    | "semicircle"
    | "regular polygon"
    | "star"
    | "isosceles triangle"
    | "kite"
    | "dart"
    | "circular sector"
    | "cylinder"
    | "cloud"
    | "starburst"
    | "signal"
    | "tape"
    | "rectangle callout"
    | "ellipse callout"
    | "cloud callout"
    | "single arrow"
    | "double arrow"
    | "coordinate";
  center: { x: number; y: number };
  anchorTransform?: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  };
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
  anchorPolygon?: Array<{ x: number; y: number }>;
};

export type TikzFigure = {
  kind: "Figure";
  span: Span;
  options?: OptionListAst;
  body: Statement[];
};

export type TikzFigureInventoryItem = {
  id: string;
  span: Span;
  beginSpan: Span;
  endSpan: Span;
  optionsSpan?: Span;
  startLine: number;
  endLine: number;
};

export type Statement = (
  | PathStatement
  | ScopeStatement
  | ForeachStatement
  | MacroDefinitionStatement
  | MacroAliasStatement
  | MacroCommandDefinitionStatement
  | PgfMathStatement
  | TikzSetStatement
  | TikzStyleStatement
  | PgfkeysStatement
  | TikzLibraryStatement
  | ColorletStatement
  | DefineColorStatement
  | OverlayGroupStatement
  | OverlayDeclarationStatement
  | AxisStatement
  | PgfplotsSetStatement
  | PgfplotsLibraryStatement
  | PgfplotsTableReadStatement
  | PgfLayerStatement
  | UnknownStatement
) & OverlayGroupMember;

/** A Beamer overlay specification, `<2->`: `span` with its angle brackets, `contentSpan` and `raw` without. */
export type OverlaySpecAst = {
  span: Span;
  contentSpan: Span;
  raw: string;
};

export type OverlayGroupCommand = "only" | "uncover" | "visible" | "invisible" | "alt" | "temporal" | "onslide";

/**
 * The head of a Beamer overlay command around statements, `\only<2->{…}`.
 *
 * Its braces delimit an argument, not a TeX group, so the statements inside
 * are siblings of this one in the enclosing body and name it in their
 * `overlayGroups`. `span` covers the command and its specification;
 * `groupSpan` the whole command with its bodies.
 */
export type OverlayGroupStatement = {
  kind: "OverlayGroup";
  id: string;
  span: Span;
  groupSpan: Span;
  command: OverlayGroupCommand;
  /** `\onslide*` (as `\only`) and `\onslide+` (as `\visible`). */
  modifier?: "*" | "+";
  spec: OverlaySpecAst;
  /** The content of each brace body, in order. */
  branches: Span[];
};

/** Which body of which overlay command a statement was written in. */
export type OverlayGroupMembership = { groupId: string; branch: number };

export type OverlayGroupMember = {
  /** The overlay commands this statement is directly inside, outermost first. */
  overlayGroups?: OverlayGroupMembership[];
};

/**
 * `\onslide<spec>` without a brace body, or `\pause`: holds for what follows
 * to the end of the enclosing scope or picture.
 */
export type OverlayDeclarationStatement = {
  kind: "OverlayDeclaration";
  id: string;
  span: Span;
  command: "onslide" | "pause";
  modifier?: "*" | "+";
  spec?: OverlaySpecAst;
  /** `\pause[n]`. */
  countRaw?: string;
  countSpan?: Span;
};

export type PathStatement = {
  kind: "Path";
  id: string;
  span: Span;
  command: PathCommand;
  /** `\node<2->`: the path exists only on these steps. */
  overlay?: OverlaySpecAst;
  /** A specification where PGF does not read one: after the options of a command other than `\\path`. */
  misplacedOverlay?: Span;
  options?: OptionListAst;
  items: PathItem[];
};

export type ScopeStatement = {
  kind: "Scope";
  id: string;
  span: Span;
  options?: OptionListAst;
  body: Statement[];
  /**
   * A PGF environment read as a scope (`{pgfonlayer}{name}`, `{pgfscope}`, ...):
   * a group around picture statements, without TikZ options. Absent for
   * `\begin{scope}`.
   */
  environment?: PgfScopeEnvironment;
};

/** PGF's environments that group picture statements (grammar `PgfEnvironmentStatement`). */
export type PgfEnvironmentName =
  | "pgfonlayer"
  | "pgfscope"
  | "pgfinterruptboundingbox"
  | "pgftransparencygroup"
  | "pgflowlevelscope"
  | "pgfviewboxscope";

export type PgfScopeEnvironment = {
  name: PgfEnvironmentName;
  /** `\begin{pgfonlayer}...\end{pgfonlayer}`, plain TeX `\pgfonlayer...\endpgfonlayer`, ConTeXt `\startpgfonlayer...\stoppgfonlayer`. */
  form: "latex" | "plain" | "context";
  /** The begin delimiter with its arguments. */
  beginSpan: Span;
  /** Each argument read, in order: its text without the delimiters, and its span with them. */
  arguments: PgfEnvironmentArgument[];
  /** The end delimiter; absent when the environment is unterminated. */
  endSpan?: Span;
  /** The environment the end delimiter names, when it differs from the one begun. */
  endName?: PgfEnvironmentName;
  terminated: boolean;
  /** `pgfonlayer`: the layer name, trimmed. */
  layer?: string;
};

export type PgfEnvironmentArgument = {
  delimiter: "{" | "[";
  raw: string;
  span: Span;
};

/** `\pgfdeclarelayer{name}` or `\pgfsetlayers{list}` (pgfcorelayers). */
export type PgfLayerStatement = {
  kind: "PgfLayer";
  id: string;
  span: Span;
  command: "declare" | "set";
  /** The argument's text without braces. */
  argumentRaw: string;
  argumentSpan?: Span;
  /** The layer names: one for a declaration, the list in order for `\pgfsetlayers`. */
  names: string[];
};

export type ForeachStatement = {
  kind: "Foreach";
  id: string;
  span: Span;
  options?: OptionListAst;
  optionsSpan?: Span;
  headerSpan?: Span;
  headerRaw?: string;
  variablesRaw?: string;
  listRaw?: string;
  prefixRaw: string;
  bodyRaw: string;
  bodySpan?: Span;
  /**
   * pgfplots' loops inside an axis: `\pgfplotsforeachungrouped` (a `\foreach`
   * without groups) and `\pgfplotsinvokeforeach{list}{body}`, whose body uses
   * `#1` (its `variablesRaw` is `#1`).
   */
  pgfplots?: "ungrouped" | "invoke";
};

export type MacroDefinitionStatement = {
  kind: "MacroDefinition";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\def";
  nameRaw: string;
  nameSpan?: Span;
  /** Highest `#n` of the parameter text (`\def\a#1#2{...}`); absent when there is none. */
  parameterCount?: number;
  /** `\expandafter\def\expandafter\name\expandafter{\other}`: the value is `\other`'s first expansion. */
  expandValue?: boolean;
  valueRaw: string;
  valueSpan?: Span;
};

export type MacroAliasStatement = {
  kind: "MacroAlias";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\let";
  nameRaw: string;
  nameSpan?: Span;
  targetRaw: string;
  targetSpan?: Span;
};

export type MacroCommandDefinitionStatement = {
  kind: "MacroCommandDefinition";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\newcommand" | "\\renewcommand" | "\\providecommand" | "\\DeclareRobustCommand" | "\\DeclareMathOperator";
  nameRaw: string;
  nameSpan?: Span;
  arity: number;
  aritySpan?: Span;
  optionalDefaultRaw?: string;
  optionalDefaultSpan?: Span;
  bodyRaw: string;
  bodySpan?: Span;
  starred: boolean;
};

export type PgfMathStatement = {
  kind: "PgfMath";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\pgfmathsetmacro" | "\\pgfmathtruncatemacro" | "\\pgfmathparse" | "\\pgfmathsetseed";
  argsRaw: string[];
  argsSpan: Span[];
};

export type TikzSetStatement = {
  kind: "TikzSet";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\tikzset";
  payloadRaw: string;
  payloadSpan?: Span;
  optionList: OptionListAst;
};

export type TikzStyleStatement = {
  kind: "TikzStyle";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\tikzstyle";
  styleNameRaw: string;
  styleNameSpan?: Span;
  definitionKind: "style" | "append";
  payloadRaw: string;
  payloadSpan?: Span;
  optionList: OptionListAst;
};

export type PgfkeysStatement = {
  kind: "Pgfkeys";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\pgfkeys";
  payloadRaw: string;
  payloadSpan?: Span;
  optionList: OptionListAst;
};

export type TikzLibraryStatement = {
  kind: "TikzLibrary";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\usetikzlibrary";
  librariesRaw: string;
  librariesSpan?: Span;
  libraries: string[];
};

export type ColorletStatement = {
  kind: "Colorlet";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\colorlet";
  nameRaw: string;
  nameSpan?: Span;
  valueRaw: string;
  valueSpan?: Span;
};

export type DefineColorStatement = {
  kind: "DefineColor";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\definecolor";
  nameRaw: string;
  nameSpan?: Span;
  modelRaw: string;
  modelSpan?: Span;
  specificationRaw: string;
  specificationSpan?: Span;
};

export type PathCommand =
  | "path"
  | "graph"
  | "draw"
  | "fill"
  | "filldraw"
  | "pattern"
  | "clip"
  | "shade"
  | "shadedraw"
  | "useasboundingbox"
  | "node"
  | "coordinate";

export type PathItem =
  | CoordinateItem
  | NodeItem
  | PathForeachItem
  | PathCommentItem
  | PathOptionItem
  | PathKeywordItem
  | GraphOperationItem
  | PlotOperationItem
  | PicOperationItem
  | ToOperationItem
  | EdgeOperationItem
  | ChildOperationItem
  | EdgeFromParentOperationItem
  | SvgOperationItem
  | LetOperationItem
  | DecorateOperationItem
  | CoordinateOperationItem
  | UnknownPathItem;

export type CoordinateItem = {
  kind: "Coordinate";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  relativePrefix?: RelativeCoordinatePrefix;
  x: string;
  y: string;
  z?: string;
  raw: string;
  form: CoordinateForm;
};

export type NodeItem = {
  kind: "Node";
  id: string;
  span: Span;
  raw: string;
  templateRaw: string;
  name?: string;
  aliases?: string[];
  optionsSpan?: Span;
  options?: OptionListAst;
  foreachClauses?: NodeForeachClause[];
  atSpan?: Span;
  atRaw?: string;
  atRelativePrefix?: RelativeCoordinatePrefix;
  textSource: "group" | "option";
  textSpan: Span;
  text: string;
  /** Same-length masked text for structural parsing during a canvas text edit. */
  structuralText?: string;
  adornment?: {
    kind: "label" | "pin";
    ownerNodeId: string;
    ownerSourceId: string;
    adornmentIndex: number;
    optionSpan: Span;
    valueSpan: Span;
    textSpan: Span;
    angleRaw: string;
    angleSpan?: Span;
    distancePt: number;
    defaultDistancePt: number;
    distanceExplicit: boolean;
    pinEdgeRaw: string | null;
    ownerGeometry?: AdornmentOwnerGeometry;
  };
};

export type NodeForeachClause = {
  kind: "NodeForeachClause";
  id: string;
  span: Span;
  raw: string;
  headerRaw: string;
  variablesRaw?: string;
  listRaw?: string;
  optionsSpan?: Span;
  options?: OptionListAst;
};

export type ChildForeachClause = {
  kind: "ChildForeachClause";
  id: string;
  span: Span;
  raw: string;
  headerRaw: string;
  variablesRaw?: string;
  listRaw?: string;
  optionsSpan?: Span;
  options?: OptionListAst;
};

export type PathOptionItem = {
  kind: "PathOption";
  id: string;
  span: Span;
  raw: string;
  options: OptionListAst;
};

export type PathCommentItem = {
  kind: "PathComment";
  id: string;
  span: Span;
  raw: string;
};

export type PathKeywordItem = {
  kind: "PathKeyword";
  id: string;
  span: Span;
  keyword: string;
};

export type PlotOperationMode = "coordinates" | "expression" | "function" | "file" | "unknown";

export type GraphConnectorOperator = "--" | "->" | "<-" | "<->" | "-!-";

export type GraphSpecNode = {
  span: Span;
  raw: string;
};

export type GraphSpecConnector = {
  operator: GraphConnectorOperator;
  span: Span;
  optionsSpan?: Span;
  optionsRaw?: string;
};

export type GraphSpecChain = {
  span: Span;
  raw: string;
  nodes: GraphSpecNode[];
  connectors: GraphSpecConnector[];
};

export type GraphSpecSegment = {
  span: Span;
  raw: string;
  chain: GraphSpecChain;
};

export type GraphSpec = {
  span: Span;
  raw: string;
  segments: GraphSpecSegment[];
};

export type GraphOperationItem = {
  kind: "GraphOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  specSpan: Span;
  specRaw: string;
  spec?: GraphSpec;
  raw: string;
};

export type PlotOperationItem = {
  kind: "PlotOperation";
  id: string;
  span: Span;
  raw: string;
  optionsSpan?: Span;
  options?: OptionListAst;
  mode: PlotOperationMode;
  dataSpan?: Span;
  dataRaw?: string;
};

export type PathForeachItem = {
  kind: "PathForeach";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "foreach" | "\\foreach";
  headerRaw: string;
  variablesRaw?: string;
  listRaw?: string;
  optionsSpan?: Span;
  options?: OptionListAst;
  bodyRaw: string;
};

export type PicForeachClause = {
  kind: "PicForeachClause";
  id: string;
  span: Span;
  raw: string;
  headerRaw: string;
  variablesRaw?: string;
  listRaw?: string;
  optionsSpan?: Span;
  options?: OptionListAst;
};

export type PicOperationItem = {
  kind: "PicOperation";
  id: string;
  span: Span;
  raw: string;
  templateRaw: string;
  optionsSpan?: Span;
  options?: OptionListAst;
  foreachClauses?: PicForeachClause[];
  name?: string;
  nameSpan?: Span;
  atSpan?: Span;
  atRaw?: string;
  atRelativePrefix?: RelativeCoordinatePrefix;
  typeSource: "group" | "option";
  typeSpan?: Span;
  typeRaw: string;
};

export type ToOperationItem = {
  kind: "ToOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  nodes?: NodeItem[];
  pics?: PicOperationItem[];
  target?: ToOperationTarget;
  raw: string;
};

export type EdgeOperationItem = {
  kind: "EdgeOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  nodes?: NodeItem[];
  pics?: PicOperationItem[];
  target?: ToOperationTarget;
  raw: string;
};

export type ChildOperationItem = {
  kind: "ChildOperation";
  id: string;
  span: Span;
  raw: string;
  templateRaw: string;
  optionsSpan?: Span;
  options?: OptionListAst;
  foreachClauses?: ChildForeachClause[];
  bodySpan?: Span;
  bodyRaw: string;
  body: PathItem[];
};

export type EdgeFromParentOperationItem = {
  kind: "EdgeFromParentOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  nodes?: NodeItem[];
  alias: "edge from parent" | "edge to parent";
  raw: string;
};

export type SvgOperationItem = {
  kind: "SvgOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  dataSpan?: Span;
  dataRaw: string;
};

export type LetOperationItem = {
  kind: "LetOperation";
  id: string;
  span: Span;
  raw: string;
};

export type CoordinateOperationItem = {
  kind: "CoordinateOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  name?: string;
  nameSpan?: Span;
  placementSpan?: Span;
  raw: string;
};

export type DecorateOperationItem = {
  kind: "DecorateOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  subpathSpan: Span;
  subpathRaw: string;
  raw: string;
};

export type ToOperationTarget =
  | {
      kind: "coordinate";
      raw: string;
      relativePrefix?: RelativeCoordinatePrefix;
      span?: Span;
    }
  | {
      kind: "cycle";
      span?: Span;
    };

export type UnknownStatement = {
  kind: "UnknownStatement";
  id: string;
  span: Span;
  raw: string;
  /** Set when the statement is an environment without a rule of its own, `\begin{x}…\end{x}`. */
  environment?: UnknownEnvironmentInfo;
};

/**
 * An environment the editor reads as one unit and skips: its name, its
 * `\begin{x}` and (when it has one) its `\end{x}`, and the source between them.
 * An unterminated environment runs to the end of the body around it.
 */
export type UnknownEnvironmentInfo = {
  name: string;
  beginSpan: Span;
  bodySpan: Span;
  endSpan?: Span;
  terminated: boolean;
};

export type UnknownPathItem = {
  kind: "UnknownPathItem";
  id: string;
  span: Span;
  raw: string;
};

export type CoordinateForm = "cartesian" | "xyz" | "polar" | "named" | "calc" | "explicit" | "unknown";

export type RelativeCoordinatePrefix = "+" | "++";

// ---------------------------------------------------------------------------
// pgfplots (design/pgfplots.md, section 4.1). Parsed only; an axis is not yet
// evaluated.

/** The axis environments with a grammar rule. `groupplot` and `polaraxis` will join them. */
export type AxisEnvironmentName = "axis" | "semilogxaxis" | "semilogyaxis" | "loglogaxis";

/**
 * `\begin{axis}[options] … \end{axis}` (or a log-scaled variant) in a picture
 * or scope. A container like a scope: its body holds ordinary statements,
 * which keep their own ids, and the axis commands, whose ids are the axis's
 * (`axis:N:plot:M`).
 */
export type AxisStatement = {
  kind: "Axis";
  /** `axis:N`. */
  id: string;
  /** From `\begin` to the end of `\end{…}`, or to the end of the body read when unterminated. */
  span: Span;
  environment: AxisEnvironmentName;
  /** `\begin{axis}`. */
  beginSpan: Span;
  /** `\end{axis}`; absent when the environment is unterminated. */
  endSpan?: Span;
  /** The name in `\end{…}`, when it is a different axis environment from the one begun. */
  endEnvironment?: AxisEnvironmentName;
  terminated: boolean;
  /** The option list after `\begin{axis}`, with its brackets. */
  optionsSpan?: Span;
  options?: OptionListAst;
  /** Between the option list (or `\begin{axis}`) and `\end{axis}`. */
  bodySpan: Span;
  body: AxisBodyItem[];
};

/** What an axis body holds, in source order. */
export type AxisBodyItem = Statement | AxisCommand;

/** The commands only an axis body has. */
export type AxisCommand =
  | AddPlotStatement
  | AddLegendEntryStatement
  | AddLegendImageStatement
  | LegendStatement
  | PgfplotsExtraStatement;

export type AxisCommandKind = AxisCommand["kind"];

/**
 * `\addplot[options] <input> <trailing path>;`, `\addplot+[…]` and `\addplot3[…]`.
 */
export type AddPlotStatement = {
  kind: "AddPlot";
  /** `axis:N:plot:M`: M counts the `\addplot` commands of the axis, from 0. */
  id: string;
  axisId: string;
  plotIndex: number;
  span: Span;
  /** `\addplot` or `\addplot3`. */
  commandSpan: Span;
  dimension: 2 | 3;
  /** `\addplot+`: the options are appended to the cycle list's, not replacing them. */
  increment: boolean;
  incrementSpan?: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  /**
   * Further option lists right after the first (`\addplot[red][domain=0:1]`):
   * TeX applies them after the first, as if they were one list (behaviour V0).
   */
  extraOptions?: Array<{ span: Span; options: OptionListAst }>;
  /** The older `\addplot[style] plot[options] <input>`: the `plot` keyword and its own options. */
  legacyPlot?: { keywordSpan: Span; optionsSpan?: Span; options?: OptionListAst };
  input: PlotInput;
  /**
   * Path operations after the input (`\closedcycle`, `-- (1,0)`,
   * `node[pos=1]{…}`), mapped as a `\path` with its own statement id. Its
   * coordinates may use `axis cs:`, which the coordinate parser keeps raw.
   */
  trailingPath?: PathStatement;
  /** Whether the closing `;` is there. A missing one is diagnosed. */
  terminated: boolean;
};

export type PlotInput =
  | PlotCoordinatesInput
  | PlotExpressionInput
  | PlotParametricInput
  | PlotTableInput
  | PlotOtherInput;

export type PlotInputKind = PlotInput["kind"];

/** `coordinates {(x,y) (x,y) +- (ex,ey) [meta] …}`. */
export type PlotCoordinatesInput = {
  kind: "coordinates";
  span: Span;
  keywordSpan: Span;
  /** The braces' content. */
  bodySpan: Span;
  bodyRaw: string;
  points: PlotCoordinatePoint[];
  /** Text the reader could not read as points, errors or meta. */
  unparsed: PlotSourceText[];
  /** Whether the closing brace is there. */
  terminated: boolean;
};

export type PlotSourceText = { raw: string; span: Span };

/**
 * One point of a coordinate list, with exact spans so an edit can rewrite
 * one coordinate. Components are kept as written: numbers, expressions
 * (`{sin(0.5)}`, `\h*8`) or symbolic text.
 */
export type PlotCoordinatePoint = {
  /** 0-based position in the list. */
  index: number;
  /** From `(` to the end of the last error or meta part. */
  span: Span;
  /** The parenthesised coordinate, `(x,y)`. */
  coordinateSpan: Span;
  /** The components between the commas, trimmed; an outer `{…}` stays. */
  components: PlotSourceText[];
  errors: PlotCoordinateError[];
  /** `[meta]`: the bracket content. */
  meta?: PlotSourceText & { bracketSpan: Span };
  /** An empty line comes before this point: a jump in the plot (`empty line=jump`, compat 1.4+). */
  afterEmptyLine: boolean;
};

/** `+- (ex,ey)` (symmetric), `+= (ex,ey)` (upper) or `-= (ex,ey)` (lower). */
export type PlotCoordinateError = {
  kind: "+-" | "+=" | "-=";
  span: Span;
  operatorSpan: Span;
  coordinateSpan: Span;
  components: PlotSourceText[];
};

/** `{math expression}` or `expression {math expression}`. */
export type PlotExpressionInput = {
  kind: "expression";
  span: Span;
  keywordSpan?: Span;
  expression: string;
  expressionSpan: Span;
};

/** `({x expr},{y expr})` or `({x},{y},{z})`. */
export type PlotParametricInput = {
  kind: "parametric";
  span: Span;
  components: PlotSourceText[];
};

/** `table [options] {inline rows or file name}`, `table [options] \macro`, with the legacy `from`. */
export type PlotTableInput = {
  kind: "table";
  span: Span;
  keywordSpan: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  fromSpan?: Span;
  source: PlotTableSource;
};

export type PlotTableSource =
  /** Rows in braces: `raw` and `span` are the braces' content, whitespace and newlines kept. See `readInlineTable`. */
  | { kind: "inline"; raw: string; span: Span; braceSpan: Span; terminated: boolean }
  /** `{file.dat}`: a file name, trimmed. */
  | { kind: "file"; name: string; span: Span; braceSpan: Span }
  /** `\loadedtable` or `{\loadedtable}`: a table read by `\pgfplotstableread`. */
  | { kind: "macro"; name: string; span: Span; braceSpan?: Span };

/**
 * An input named by words the editor only records: `gnuplot`, `function`,
 * `shell`, `file`, `graphics`, `fill between`, or anything else.
 */
export type PlotOtherInput = {
  kind: "other";
  span: Span;
  /** The words, space-normalized: `gnuplot`, `fill between`. */
  name: string;
  nameSpan: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  /** The brace argument's content. */
  argumentRaw?: string;
  argumentSpan?: Span;
  raw: string;
};

/** `\addlegendentry[options]{text}` or `\addlegendentryexpanded`, with no `;` needed. */
export type AddLegendEntryStatement = {
  kind: "AddLegendEntry";
  /** `axis:N:legend-entry:M`. */
  id: string;
  axisId: string;
  span: Span;
  expanded: boolean;
  optionsSpan?: Span;
  options?: OptionListAst;
  text: string;
  textSpan: Span;
};

/** `\addlegendimage{options}`. */
export type AddLegendImageStatement = {
  kind: "AddLegendImage";
  /** `axis:N:legend-image:M`. */
  id: string;
  axisId: string;
  span: Span;
  payloadSpan: Span;
  options: OptionListAst;
};

/** `\legend{a,b,c}` or `\legend{a\\b\\}`. */
export type LegendStatement = {
  kind: "Legend";
  /** `axis:N:legend:M`. */
  id: string;
  axisId: string;
  span: Span;
  listRaw: string;
  listSpan: Span;
  /** `,` (a `\foreach` list, dots allowed) or `\\` (each entry terminated). */
  delimiter: "," | "\\\\";
  entries: PlotSourceText[];
};

/** `\pgfplotsextra{low-level commands}`. */
export type PgfplotsExtraStatement = {
  kind: "PgfplotsExtra";
  /** `axis:N:extra:M`. */
  id: string;
  axisId: string;
  span: Span;
  bodyRaw: string;
  bodySpan: Span;
};

/** `\pgfplotsset{…}` in a picture, an axis, or the preamble. */
export type PgfplotsSetStatement = {
  kind: "PgfplotsSet";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\pgfplotsset";
  /** With its braces. */
  payloadRaw: string;
  payloadSpan?: Span;
  optionList: OptionListAst;
  /** `compat=…`, the last one when there are several. */
  compat?: PlotSourceText;
};

/**
 * `\pgfplotstableread[options]{data}\macro`: reads a table (a file name, or
 * inline rows when the argument holds a row separator) into `\macro` for
 * `\addplot table {\macro}` (manual: pgfplotstable, `\pgfplotstableread`).
 */
export type PgfplotsTableReadStatement = {
  kind: "PgfplotsTableRead";
  id: string;
  span: Span;
  raw: string;
  optionsSpan?: Span;
  options?: OptionListAst;
  /** The braces' content, whitespace and newlines kept. */
  dataRaw: string;
  dataSpan: Span;
  macroName: string;
  macroSpan: Span;
};

/** `\usepgfplotslibrary{a,b}`. */
export type PgfplotsLibraryStatement = {
  kind: "PgfplotsLibrary";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\usepgfplotslibrary";
  librariesRaw: string;
  librariesSpan?: Span;
  libraries: string[];
};
