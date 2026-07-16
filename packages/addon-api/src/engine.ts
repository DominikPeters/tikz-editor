import type {
  AddonDiagnostic,
  OptionEntry,
  OptionListAst,
  PgfMathResult,
  ScenePathCommand,
  Span,
  WorldBounds,
  WorldPoint
} from "./data.js";
import type { AddonManifest } from "./manifest.js";

/**
 * Opaque views of host values. Add-ons receive these from host context
 * factories and hand them back unchanged; their internals are host-private
 * and may change between host versions without an API bump.
 */
export type HostStatement = {
  readonly kind: string;
  readonly id: string;
  readonly span: Span;
};

export type HostSceneElement = {
  readonly id: string;
  readonly layer: string;
};

export type HostResolvedStyle = { readonly [key: string]: unknown };

export type HostClipRef = { readonly clipId: string };

/**
 * Generic AST statement for a claimed environment. The host builds this
 * (spans, generically parsed options, host-parsed body) before asking the
 * add-on to parse; the add-on's `payload` stores whatever the host cannot
 * represent, as plain structured-clone-compatible data.
 */
export type AddonEnvironmentStatement = {
  kind: "AddonEnvironment";
  id: string;
  span: Span;
  addonId: string;
  envName: string;
  options?: OptionListAst;
  /** Raw slice boundaries of the environment body (between \begin{...} and \end{...}). */
  bodySpan: Span;
  /** Host-parsed interior statements. Claimed nested commands appear as AddonCommandStatement. */
  body?: HostStatement[];
  raw: string;
  payload?: unknown;
};

/** Generic AST statement for a claimed command. */
export type AddonCommandStatement = {
  kind: "AddonCommand";
  id: string;
  span: Span;
  addonId: string;
  /** Command name with leading backslash, e.g. "\\addplot". */
  commandName: string;
  /** Raw slice after the command name (arguments, up to but excluding a terminating ";"). */
  argsSpan: Span;
  raw: string;
  payload?: unknown;
};

export type AddonStatement = AddonEnvironmentStatement | AddonCommandStatement;

export type AddonParseResult =
  | { kind: "success"; payload?: unknown }
  | { kind: "partial"; payload?: unknown; reason?: string }
  | { kind: "unsupported"; reason?: string }
  | { kind: "error"; message: string };

export type AddonEvalResult =
  | { kind: "success"; elements: HostSceneElement[] }
  | { kind: "partial"; elements: HostSceneElement[]; reason?: string }
  | { kind: "unsupported"; reason?: string }
  | { kind: "error"; message: string };

/** Injected parse services. Never retain a context beyond the call it was passed to. */
export type HostParseContext = {
  /** Full document source. */
  source: string;
  slice(span: Span): string;
  /** Generic TikZ option-list parsing; `from` anchors spans to absolute offsets. */
  parseOptionList(raw: string, from?: number): OptionListAst;
  /** Re-invoke the host statement parser on a source span (e.g. an environment body). */
  parseTikzStatements(span: Span): HostStatement[];
  /** Span of a balanced {...} group starting at `from` (which must point at "{"), braces included. */
  readBalancedGroup(from: number): Span | null;
  pushDiagnostic(diagnostic: AddonDiagnostic): void;
};

export type AddonNodeGeometry = {
  center: WorldPoint;
  halfWidth: number;
  halfHeight: number;
  shape?: "rectangle" | "circle";
  radius?: number;
};

export type AddonPathSpec = {
  commands: ScenePathCommand[];
  style?: HostResolvedStyle;
  /** Stamp elements with a nested statement's source id (e.g. a claimed \addplot inside an axis). */
  sourceId?: string;
  clip?: HostClipRef;
};

export type AddonCircleSpec = {
  center: WorldPoint;
  radius: number;
  style?: HostResolvedStyle;
  sourceId?: string;
  clip?: HostClipRef;
};

export type AddonEllipseSpec = {
  center: WorldPoint;
  radiusX: number;
  radiusY: number;
  style?: HostResolvedStyle;
  sourceId?: string;
  clip?: HostClipRef;
};

export type AddonTextOptions = {
  anchor?: string;
  rotate?: number;
  sourceId?: string;
  clip?: HostClipRef;
  style?: HostResolvedStyle;
  textMode?: "text" | "math";
};

export type AddonTextMetrics = {
  width: number;
  height: number;
  baseline: number;
};

export type AddonChildFrameOptions = {
  /** Style option entries applied as the child frame's base style delta. */
  styleEntries?: OptionEntry[];
  clip?: HostClipRef;
};

/** Spec for a canvas edit handle created during evaluation. */
export type AddonEditHandleSpec = {
  /** Add-on-defined role, e.g. "axis-corner", "data-point". */
  role: string;
  world: WorldPoint;
  /** Plain structured-clone-compatible data the engine needs to plan a drag. */
  data?: unknown;
  /** Stamp the handle with a nested statement's source id; defaults to the claimed statement. */
  sourceId?: string;
};

/** The host's view of an add-on handle, passed back when planning a drag. */
export type AddonHandleView = {
  id: string;
  addonId: string;
  role: string;
  world: WorldPoint;
  data?: unknown;
  sourceId: string;
  sourceSpan: Span;
};

export type AddonSourcePatch = {
  span: Span;
  replacement: string;
};

/** Set (value string) or remove (value null) a key in an option list. */
export type AddonOptionMutation = {
  key: string;
  value: string | null;
};

export type AddonEditResult =
  | {
      kind: "success";
      patches: AddonSourcePatch[];
      /** Source ids whose geometry the edit affects; drives the incremental fast path. */
      changedSourceIds?: string[];
      selectedSourceIds?: string[];
    }
  | { kind: "unsupported"; reason?: string }
  | { kind: "error"; message: string };

/** Injected edit services. Patch spans refer to the current document source. */
export type HostEditContext = {
  source: string;
  slice(span: Span): string;
  parseOptionList(raw: string, from?: number): OptionListAst;
  /** Current parse of the claimed statement carrying this edit, if it can be located. */
  findStatement(sourceId: string): AddonStatement | null;
  /**
   * Build a patch that applies option-list mutations to a claimed statement,
   * inserting a fresh option list when the statement has none.
   */
  rewriteOptionList(statement: AddonStatement, mutations: AddonOptionMutation[]): AddonSourcePatch | null;
};

/**
 * Injected evaluation services. Implementations record dependency edges for
 * every named-coordinate/geometry read and write, which is what keeps the
 * host's incremental re-render correct for add-on statements. `evaluate`
 * must be pure and deterministic over (statement, context).
 */
export type HostEvalContext = {
  defaultStyle(): HostResolvedStyle;
  /**
   * Resolve the TikZ subset of an option list against a base style. Entries
   * the host does not understand come back in `unhandled` — typically the
   * add-on's own keys.
   */
  resolveStyle(
    entries: OptionEntry[],
    base?: HostResolvedStyle
  ): { style: HostResolvedStyle; unhandled: OptionEntry[] };

  /** Evaluate a raw TikZ coordinate ("(1,2)", "(node.north)", "(axis cs:3,4)"). */
  evaluateCoordinate(raw: string): WorldPoint | null;
  writeNamedCoordinate(name: string, point: WorldPoint): void;
  registerNodeGeometry(name: string, geometry: AddonNodeGeometry): void;
  /** Register a "<name> cs:" coordinate system usable by later statements in the picture. */
  registerCoordinateSystem(name: string, resolve: (args: string) => WorldPoint | null): void;
  extendPictureBounds(bounds: WorldBounds): void;
  makeClipPath(commands: ScenePathCommand[]): HostClipRef;

  makePath(spec: AddonPathSpec): HostSceneElement;
  makeCircle(spec: AddonCircleSpec): HostSceneElement;
  makeEllipse(spec: AddonEllipseSpec): HostSceneElement;
  /** Lay out text via the host TeX text engine, reading back measured dimensions. */
  layoutText(
    text: string,
    at: WorldPoint,
    options?: AddonTextOptions
  ): { element: HostSceneElement; metrics: AddonTextMetrics | null };

  pgfmath(expr: string): PgfMathResult;
  /** Expand a \foreach-style list ("1,...,5", "a,b,c") into raw item strings. */
  expandForeachList(listRaw: string): string[];

  /** Re-evaluate host-parsed TikZ statements (e.g. an environment body) as ordinary TikZ. */
  evaluateTikzStatements(statements: HostStatement[], frame?: AddonChildFrameOptions): HostSceneElement[];

  /** Create a canvas edit handle for the claimed statement. */
  createHandle(spec: AddonEditHandleSpec): void;
  /** Mint an element id under the claimed statement's source id. */
  makeElementId(suffix: string): string;
  pushDiagnostic(diagnostic: AddonDiagnostic): void;
  markFeature(featureId: `addon:${string}`, status: "supported" | "unsupported"): void;
  /** Plain-data result of the add-on's preamble scanner for this document, if registered. */
  preambleConfig: unknown;
};

export type AddonCompletionData = {
  /** Option keys completed inside claimed environments/commands. */
  optionKeys?: string[];
  /** Value completions per option key. */
  valueMap?: Record<string, string[]>;
  /** Keys whose numeric values support source-panel scrubbing, by scrub class. */
  scrubKeys?: {
    length?: string[];
    angle?: string[];
    numeric?: string[];
    nonNegative?: string[];
  };
};

/**
 * The engine entry of an add-on: pure logic, worker-safe (no DOM, no React,
 * no module-level mutable state). Loaded in every context that evaluates
 * documents, including a future compute worker.
 */
export type AddonEngine = {
  manifest: AddonManifest;
  parseEnvironment?(statement: AddonEnvironmentStatement, context: HostParseContext): AddonParseResult;
  parseCommand?(statement: AddonCommandStatement, context: HostParseContext): AddonParseResult;
  evaluate(statement: AddonStatement, context: HostEvalContext): AddonEvalResult;
  /**
   * Translate a handle drag into a plain-data edit description, or null when
   * the drag is not applicable. Pure: derives everything from the handle's
   * `data` and the new world position. The host wraps the result in an
   * addonEdit action and routes it to `applyEdit`.
   */
  planHandleDrag?(handle: AddonHandleView, newWorld: WorldPoint): unknown;
  /** Apply a plain-data edit (from planHandleDrag or an inspector write) as source patches. */
  applyEdit?(edit: unknown, context: HostEditContext): AddonEditResult;
  /**
   * Pure scan over the full document source for preamble-level configuration
   * (e.g. \pgfplotsset outside figures). The plain-data result is handed to
   * every subsequent evaluate call as `context.preambleConfig`.
   */
  scanPreamble?(source: string): unknown;
  completion?: AddonCompletionData;
};

/**
 * Inspector properties an add-on can contribute for a selected claimed
 * statement. These map onto the host's existing property renderers; property
 * ids must be namespaced `addon:<addonId>:<property>`. `buildEdit` turns a
 * new value into a plain-data edit routed to the engine's `applyEdit`.
 */
export type AddonInspectorProperty =
  | {
      kind: "number";
      id: `addon:${string}`;
      label: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
      buildEdit(newValue: number): unknown;
    }
  | {
      kind: "text";
      id: `addon:${string}`;
      label: string;
      value: string;
      buildEdit(newValue: string): unknown;
    }
  | {
      kind: "dropdown";
      id: `addon:${string}`;
      label: string;
      value: string;
      options: Array<{ value: string; label: string }>;
      buildEdit(newValue: string): unknown;
    }
  | {
      kind: "checkbox";
      id: `addon:${string}`;
      label: string;
      value: boolean;
      buildEdit(newValue: boolean): unknown;
    };

export type AddonInspectorSection = {
  id: string;
  title: string;
  properties: AddonInspectorProperty[];
};

/**
 * The ui entry of an add-on: main-thread-only contributions, loaded lazily.
 * Unlike engine payloads, these objects may carry functions — they never
 * cross a worker or snapshot boundary.
 */
export type AddonUi = {
  manifest: AddonManifest;
  /** Inspector sections for a selected claimed statement. */
  inspector?(statement: AddonStatement): AddonInspectorSection[];
};

/** A statically registered add-on: engine plus optional ui entry. */
export type AddonRegistration = {
  engine: AddonEngine;
  ui?: AddonUi;
};
