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

export type Statement =
  | PathStatement
  | ScopeStatement
  | ForeachStatement
  | MacroDefinitionStatement
  | MacroAliasStatement
  | MacroCommandDefinitionStatement
  | TikzSetStatement
  | TikzStyleStatement
  | PgfkeysStatement
  | TikzLibraryStatement
  | ColorletStatement
  | DefineColorStatement
  | UnknownStatement;

export type PathStatement = {
  kind: "Path";
  id: string;
  span: Span;
  command: PathCommand;
  options?: OptionListAst;
  items: PathItem[];
};

export type ScopeStatement = {
  kind: "Scope";
  id: string;
  span: Span;
  options?: OptionListAst;
  body: Statement[];
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
};

export type MacroDefinitionStatement = {
  kind: "MacroDefinition";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\def";
  nameRaw: string;
  nameSpan?: Span;
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
};

export type UnknownPathItem = {
  kind: "UnknownPathItem";
  id: string;
  span: Span;
  raw: string;
};

export type CoordinateForm = "cartesian" | "xyz" | "polar" | "named" | "calc" | "explicit" | "unknown";

export type RelativeCoordinatePrefix = "+" | "++";
