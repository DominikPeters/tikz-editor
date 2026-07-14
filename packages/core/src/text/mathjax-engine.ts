import { DEFAULT_TEXT_FONT_SIZE } from "../semantic/style/resolve.js";
import {
  KnuthPlassVisitor,
  TEX_INTERWORD_SHRINK_EM,
  TEX_INTERWORD_SPACE_EM,
  TEX_INTERWORD_STRETCH_EM,
  getKnuthPlassReportsFromOutputJax,
  installKnuthPlassVisitor,
  registerKnuthPlassReportsOnOutputJax,
  setKnuthPlassOptionsOnOutputJax,
  type KnuthPlassLayoutMode,
  type WrappedTextGap
} from "./knuth-plass/index.js";
import { preloadEnglishHyphenator } from "./knuth-plass/paragraph/hyphenate.js";
import type { ParagraphLayoutReport } from "./knuth-plass/index.js";
import {
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
  luaLatexDefaultTextFontProfile,
} from "./tex/index.js";
import type {
  ResolvedTexFont,
  SimpleTexFontState,
  TexMetricProvider,
  TexTextFontProfile,
  TexShapedItem,
} from "./tex/index.js";
import {
  texVListX,
  texVListY,
  type TexVListX,
  type TexVListY,
} from "./tex/coordinates.js";
import {
  registerTexVListLayoutsOnOutputJax,
} from "./tex/vlist/index.js";
import {
  remapParagraphLayoutReportSourceMap,
  remapTexVListLayoutSourceMap,
} from "./tex/source-map-report.js";
import type {
  PositionedTexVListItem,
  TexRenderItem,
  TexVListLayout,
} from "./tex/vlist/index.js";
import type {
  NodeTextEngine,
  NodeTextGraphicsResolver,
  NodeTextColorResolver,
  NodeTextMeasureRequest,
  NodeTextMetrics,
  NodeTextParagraphAlignment,
  NodeTextRenderPayload,
  NodeTextValidationIssue
} from "./types.js";
import type { TextSourceMap } from "./source-map.js";

type MathJaxAdaptor = {
  firstChild(node: unknown): unknown;
  getAttribute(node: unknown, name: string): string | null;
  innerHTML(node: unknown): string;
};

type MathJaxRuntime = {
  tex2svg(tex: string, options: { display: boolean }): unknown;
  tex2svgPromise?: (tex: string, options: { display: boolean }) => Promise<unknown>;
  outputJax?: unknown;
  startup?: {
    adaptor?: MathJaxAdaptor;
    output?: unknown;
    document?: { outputJax?: unknown } | null;
    promise?: Promise<unknown>;
  };
};

type MathJaxStartup = NonNullable<MathJaxRuntime["startup"]>;

type MathJaxEntrypoint = {
  init(config: Record<string, unknown>): Promise<MathJaxRuntime>;
};

type CachedRenderEntry = {
  payload: NodeTextRenderPayload;
  baseWidthPt: number;
  baseHeightPt: number;
  baseLineYPt: number;
  midLineYPt: number;
  paragraphId: string | null;
  renderSourceText: string;
};

type TextFontOptions = {
  fontStyle: "normal" | "italic";
  fontWeight: "normal" | "bold";
  fontFamily: "serif" | "sans" | "monospace";
};

type MathJaxTextMode = "text" | "math";
type MaybePromise<T> = T | Promise<T>;

type MeasuredRenderRequest = {
  sourceText: string;
  textWidthPt: number | null;
  font: TextFontOptions;
  mode: MathJaxTextMode;
  alignment: NodeTextParagraphAlignment | null;
};

export type MathJaxFont =
  | "mathjax-newcm"
  | "mathjax-asana"
  | "mathjax-bonum"
  | "mathjax-dejavu"
  | "mathjax-fira"
  | "mathjax-modern"
  | "mathjax-pagella"
  | "mathjax-schola"
  | "mathjax-stix2"
  | "mathjax-termes"
  | "mathjax-tex";

const DEFAULT_FONT: MathJaxFont = "mathjax-newcm";
const MIDLINE_FROM_BASELINE_RATIO = 0.215;
const TEX_TEXT_BASE_FONT_SIZE = 10;
const MATHJAX_PARAGRAPH_PT_PER_WIDTH_UNIT = 10;
const MATHJAX_PARAGRAPH_WIDTH_UNIT_STEP = 0.001;
const SINGLE_LINE_WIDTH_EPSILON_PT = 1e-4;
const TEX_NATURAL_TEXT_LAYOUT_WIDTH_PT = 16384;
const LATEX_NORMAL_BASELINESKIP_EM = 1.2;
const LATEX_NORMAL_STRUT_HEIGHT_EM = 0.85;
const BROWSER_STARTUP_COMPONENT_URL = "https://cdn.jsdelivr.net/npm/mathjax@4/startup.js";
const BROWSER_STARTUP_COMPONENT_ID = "tikz-editor-mathjax-startup";
const SCRIPT_LOADED_MARKER = "__tikzMathJaxLoaded";
const SCRIPT_ERROR_MARKER = "__tikzMathJaxLoadError";

let sharedEnginePromise: Promise<NodeTextEngine> | null = null;
let browserRuntimePromise: Promise<MathJaxRuntime> | null = null;
let moduleWorkerRuntimePromise: Promise<MathJaxRuntime> | null = null;
let activeBrowserFont: MathJaxFont = DEFAULT_FONT;

type WorkerFontLoader = (name: string) => Promise<unknown>;
let workerFontLoader: WorkerFontLoader | null = null;
const EXPLICIT_LINE_BREAK_TOKEN_PATTERN = /\\\\(?:\[[^\]]*\])?/;
const EXPLICIT_LINE_BREAK_CANONICAL_PATTERN = /[ \t\r\n]*(\\\\(?:\[[^\]]*\])?)[ \t\r\n]*/g;
const EXPLICIT_LINE_BREAK_WITH_LEADING_PATTERN = /[ \t\r\n]*\\\\(?:\[([^\]]*)\])?[ \t\r\n]*/g;

/**
 * Register a font loader for the worker runtime. Must be called before the first
 * render so that mathjax.asyncLoad can route bare-specifier font imports through
 * Vite-bundled lazy chunks instead of failing with a module resolution error.
 */
export function setWorkerFontLoader(loader: WorkerFontLoader): void {
  workerFontLoader = loader;
}

export async function createMathJaxNodeTextEngine(options?: { font?: MathJaxFont }): Promise<NodeTextEngine> {
  const font = options?.font ?? DEFAULT_FONT;
  if (hasBrowserDomGlobals() && font !== activeBrowserFont) {
    activeBrowserFont = font;
    sharedEnginePromise = null;
    browserRuntimePromise = null;
    resetBrowserMathJax();
  }
  sharedEnginePromise ??= initializeEngine(font);
  try {
    return await sharedEnginePromise;
  } catch (error) {
    sharedEnginePromise = null;
    throw error;
  }
}

export function getActiveMathJaxOutputJax(): unknown {
  const browserRuntime = (globalThis as { MathJax?: MathJaxRuntime }).MathJax;
  return (
    browserRuntime?.outputJax ??
    browserRuntime?.startup?.output ??
    browserRuntime?.startup?.document?.outputJax ??
    null
  );
}

async function initializeEngine(font: MathJaxFont): Promise<NodeTextEngine> {
  const hyphenatorPreload = preloadEnglishHyphenator();
  const runtime = hasBrowserDomGlobals()
    ? await initializeBrowserRuntime(font)
    : hasWorkerRuntimeGlobals()
      ? await initializeWorkerRuntime()
      : await initializeNodeRuntime();
  await preloadMathJaxWarmupExpressions(runtime);
  await hyphenatorPreload;

  const cache = new Map<string, CachedRenderEntry>();
  const simpleTexLayoutCache = new Map<string, SimpleTexSharedLayout>();
  const exactSingleLineWidthCache = new Map<string, number>();
  const validationCache = new Map<string, NodeTextValidationIssue | null>();
  const pendingAsyncRenders = new Set<Promise<void>>();
  const finalizedPendingCacheKeys = new Set<string>();
  const asyncRenderQueue = { current: Promise.resolve() };

  return {
    validate(text: string): NodeTextValidationIssue | null {
      if (validationCache.has(text)) {
        return validationCache.get(text) ?? null;
      }

      const prepared = normalizeMathJaxTextInput(text, {
        fontStyle: "normal",
        fontWeight: "normal",
        fontFamily: "serif"
      });
      const defaultMeasureKey = measurementKey("text", prepared.text, null, prepared.font, null, null);
      const simpleTexEntry = buildSimpleTexTextCacheEntry({
        runtime,
        cacheKey: defaultMeasureKey,
        layoutCacheKey: defaultMeasureKey,
        layoutCache: simpleTexLayoutCache,
        sourceText: prepared.text,
        textWidthPt: null,
        font: prepared.font,
        alignment: null,
        requestedAlignment: null,
        eligible: prepared.simpleTexEligible,
        mode: "text"
      });
      if (simpleTexEntry) {
        cache.set(defaultMeasureKey, simpleTexEntry);
        validationCache.set(text, null);
        return null;
      }

      try {
        if (!cache.has(defaultMeasureKey)) {
          const entry = buildMeasuredCacheEntry({
            runtime,
            exactSingleLineWidthCache,
            cacheKey: defaultMeasureKey,
            sourceText: prepared.text,
            textWidthPt: null,
            font: prepared.font,
            mode: "text",
            alignment: null
          });
          if (entry) {
            setCappedMapValue(cache, defaultMeasureKey, entry, RENDER_CACHE_LIMIT);
          }
        }
        setCappedMapValue(validationCache, text, null, VALIDATION_CACHE_LIMIT);
        return null;
      } catch (error) {
        if (isMathJaxAsyncRetryError(error)) {
          queueAsyncCachePopulate(
            runtime,
            cache,
            pendingAsyncRenders,
            finalizedPendingCacheKeys,
            asyncRenderQueue,
            {
              cacheKey: defaultMeasureKey,
              sourceText: prepared.text,
              textWidthPt: null,
              font: prepared.font,
              mode: "text",
              alignment: null
            }
          );
          setCappedMapValue(validationCache, text, null, VALIDATION_CACHE_LIMIT);
          return null;
        }
        const issue = {
          code: "invalid-node-tex",
          message: sanitizeErrorMessage(error)
        };
        setCappedMapValue(validationCache, text, issue, VALIDATION_CACHE_LIMIT);
        return issue;
      }
    },
    measure(request: NodeTextMeasureRequest): NodeTextMetrics | null {
      const scale = computeFontScale(request.fontSizePt);
      const normalizedWidth = request.textWidthPt == null ? null : request.textWidthPt / scale;
      const mode = request.mode ?? "text";
      const prepared = normalizeMathJaxTextInput(request.text, {
        fontStyle: request.fontStyle,
        fontWeight: request.fontWeight,
        fontFamily: request.fontFamily
      });
      const alignment = resolveParagraphAlignment(request.textWidthPt, request.alignment);
      const requiresParagraphGeometry =
        normalizedWidth != null || hasExplicitMultilineBreaks(prepared.text);
      const graphicsCacheKey = request.graphicsResolver?.cacheKey ?? null;
      const resolverCacheKey = [graphicsCacheKey, request.colorResolver?.cacheKey ?? null]
        .filter((value): value is string => value !== null)
        .join("|") || null;
      const layoutCacheKey = measurementKey(mode, prepared.text, normalizedWidth, prepared.font, alignment, resolverCacheKey);
      // Native entries embed source offsets projected through the request's
      // source map, so they are cached per source location; the MathJax
      // fallback is position-independent and keeps the shared key.
      const sourceMapAnchor = request.sourceMap ? simpleTexSourceMapAnchor(request.sourceMap) : null;
      const texCacheKey = sourceMapAnchor == null ? layoutCacheKey : `${layoutCacheKey}|sm:${sourceMapAnchor}`;
      const cacheKey = layoutCacheKey;

      let entry: CachedRenderEntry | null = getCappedMapValue(cache, texCacheKey) ?? null;
      if (!entry && texCacheKey !== layoutCacheKey) {
        const sharedEntry = getCappedMapValue(cache, layoutCacheKey) ?? null;
        if (sharedEntry && !isSimpleTexCacheEntry(sharedEntry)) {
          entry = sharedEntry;
        }
      }
      if (!entry) {
        entry = buildSimpleTexTextCacheEntry({
          runtime,
          cacheKey: texCacheKey,
          layoutCacheKey,
          layoutCache: simpleTexLayoutCache,
          sourceText: prepared.text,
          textWidthPt: normalizedWidth,
          font: prepared.font,
          alignment,
          requestedAlignment: request.alignment ?? null,
          eligible: prepared.simpleTexEligible,
          mode,
          sourceMap: request.sourceMap,
          graphicsResolver: request.graphicsResolver,
          colorResolver: request.colorResolver
        });
        if (entry) {
          setCappedMapValue(cache, texCacheKey, entry, RENDER_CACHE_LIMIT);
          validationCache.set(request.text, null);
        }
      }

      if (!entry) {
        try {
          entry = buildMeasuredCacheEntry({
            runtime,
            exactSingleLineWidthCache,
            cacheKey,
            sourceText: prepared.text,
            textWidthPt: normalizedWidth,
            font: prepared.font,
            mode,
            alignment
          });
          if (!entry) {
            return null;
          }
          setCappedMapValue(cache, cacheKey, entry, RENDER_CACHE_LIMIT);
          setCappedMapValue(validationCache, request.text, null, VALIDATION_CACHE_LIMIT);
        } catch (error) {
          if (isMathJaxAsyncRetryError(error)) {
            queueAsyncCachePopulate(
              runtime,
              cache,
              pendingAsyncRenders,
              finalizedPendingCacheKeys,
              asyncRenderQueue,
              {
                cacheKey,
                sourceText: prepared.text,
                textWidthPt: normalizedWidth,
                font: prepared.font,
                mode,
                alignment
              }
            );
            setCappedMapValue(validationCache, request.text, null, VALIDATION_CACHE_LIMIT);
          }
          if (requiresParagraphGeometry) {
            throw error;
          }
          return null;
        }
      }

      if (requiresParagraphGeometry && entry.paragraphId == null) {
        throw new Error("Multiline MathJax measurement did not produce paragraph geometry.");
      }

      return {
        cacheKey: entry.payload.cacheKey,
        width: entry.baseWidthPt * scale,
        height: entry.baseHeightPt * scale,
        baselineY: entry.baseLineYPt * scale,
        midLineY: entry.midLineYPt * scale,
        paragraphId: entry.paragraphId,
        renderSourceText: entry.renderSourceText
      };
    },
    renderFromCache(cacheKey: string): NodeTextRenderPayload | null {
      return getCappedMapValue(cache, cacheKey)?.payload ?? null;
    },
    async flushPending(): Promise<readonly string[]> {
      if (pendingAsyncRenders.size > 0) {
        do {
          const batch = [...pendingAsyncRenders];
          await Promise.allSettled(batch);
        } while (pendingAsyncRenders.size > 0);
      }
      if (finalizedPendingCacheKeys.size === 0) {
        return [];
      }
      const changedKeys = [...finalizedPendingCacheKeys].sort();
      finalizedPendingCacheKeys.clear();
      return changedKeys;
    }
  };
}

async function initializeNodeRuntime(): Promise<MathJaxRuntime> {
  const moduleId = "mathjax";
  const module = (await import(/* @vite-ignore */ moduleId)) as { default?: MathJaxEntrypoint };
  const entrypoint = module.default;
  if (!entrypoint || typeof entrypoint.init !== "function") {
    throw new Error("MathJax entrypoint is unavailable.");
  }
  return entrypoint.init(createMathJaxConfig());
}

async function initializeWorkerRuntime(): Promise<MathJaxRuntime> {
  moduleWorkerRuntimePromise ??= initializeWorkerRuntimeOnce();
  try {
    return await moduleWorkerRuntimePromise;
  } catch (error) {
    moduleWorkerRuntimePromise = null;
    throw error;
  }
}

async function initializeWorkerRuntimeOnce(): Promise<MathJaxRuntime> {
  const [
    { mathjax },
    { TeX },
    { SVG },
    { liteAdaptor },
    { RegisterHTMLHandler }
  ] = await Promise.all([
    import("@mathjax/src/js/mathjax.js"),
    import("@mathjax/src/js/input/tex.js"),
    import("@mathjax/src/js/output/svg.js"),
    import("@mathjax/src/js/adaptors/liteAdaptor.js"),
    import("@mathjax/src/js/handlers/html.js"),
    import("@mathjax/src/js/util/asyncLoad/esm.js"),
    import("@mathjax/src/js/input/tex/base/BaseConfiguration.js"),
    import("@mathjax/src/js/input/tex/ams/AmsConfiguration.js"),
    import("@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js"),
    import("@mathjax/src/js/input/tex/color/ColorConfiguration.js"),
    import("@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js"),
  ]);

  // Override mathjax.asyncLoad (set by asyncLoad/esm.js) so that bare-specifier
  // font imports are routed through the registered workerFontLoader (Vite lazy
  // chunks) rather than a raw import() that fails without an import map.
  // Falls back silently for any specifier not handled by the loader.
  const mjx = mathjax as { asyncLoad?: (name: string) => Promise<unknown> };
  if (typeof mjx.asyncLoad === "function") {
    const origAsyncLoad = mjx.asyncLoad;
    mjx.asyncLoad = async (name: string) => {
      if (workerFontLoader) {
        try {
          return await workerFontLoader(name);
        } catch {
          // Font subset not in the loader map; fall through to silent failure.
        }
      }
      try {
        return await origAsyncLoad(name);
      } catch {
        console.warn(`[tikz-editor] MathJax could not load dynamic font subset: ${name}`);
        return {};
      }
    };
  }

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const tex = new TeX({
    packages: ["base", "ams", "newcommand", "color", "textmacros"],
    formatError: (_jax: unknown, err: Error) => {
      throw err;
    }
  });
  const svg = new SVG({
    fontCache: "none",
    linebreaks: {
      inline: false,
      LinebreakVisitor: KnuthPlassVisitor
    }
  });
  const document = mathjax.document("", {
    InputJax: tex,
    OutputJax: svg
  });

  const tex2svg = (input: string, options: { display: boolean }): unknown => {
    return document.convert(input, {
      display: options.display
    });
  };

  const runtime: MathJaxRuntime = {
    tex2svg,
    tex2svgPromise: (input, options) => Promise.resolve(tex2svg(input, options)),
    outputJax: svg,
    startup: {
      output: svg,
      adaptor: {
        firstChild(node: unknown): unknown {
          return adaptor.firstChild(node as never);
        },
        getAttribute(node: unknown, name: string): string | null {
          const value: unknown = adaptor.getAttribute(node as never, name);
          return typeof value === "string" ? value : value == null ? null : "";
        },
        innerHTML(node: unknown): string {
          return adaptor.innerHTML(node as never);
        }
      }
    }
  };

  const warmup = tex2svg("\\mbox{0}", { display: false });
  if (!runtime.startup?.adaptor?.firstChild(warmup)) {
    throw new Error("MathJax worker runtime did not produce SVG output.");
  }
  return runtime;
}

async function initializeBrowserRuntime(font: MathJaxFont): Promise<MathJaxRuntime> {
  browserRuntimePromise ??= initializeBrowserRuntimeOnce(font);
  try {
    return await browserRuntimePromise;
  } catch (error) {
    browserRuntimePromise = null;
    throw error;
  }
}

async function initializeBrowserRuntimeOnce(font: MathJaxFont): Promise<MathJaxRuntime> {
  const preloadedRuntime = await readBrowserRuntime(150);
  if (preloadedRuntime) {
    return preloadedRuntime;
  }

  configureBrowserMathJaxGlobal(font);
  await ensureBrowserStartupComponentLoaded();

  const runtime = await readBrowserRuntime(5000);
  if (!runtime) {
    const observed = (globalThis as { MathJax?: unknown }).MathJax;
    throw new Error(`MathJax browser runtime is unavailable. ${formatMathJaxShape(observed)}`);
  }
  return runtime;
}

function hasBrowserDomGlobals(): boolean {
  const candidate = globalThis as { window?: unknown; document?: unknown };
  return candidate.window != null && candidate.document != null;
}

function hasWorkerImportScripts(): boolean {
  const candidate = globalThis as { importScripts?: unknown };
  return typeof candidate.importScripts === "function";
}

function hasWorkerRuntimeGlobals(): boolean {
  if (hasWorkerImportScripts()) {
    return true;
  }
  const candidate = globalThis as { window?: unknown; document?: unknown; self?: unknown };
  return candidate.window == null && candidate.document == null && candidate.self === globalThis;
}

function createMathJaxConfig(): Record<string, unknown> {
  const config = {
    loader: {
      load: ["input/tex", "output/svg", "[tex]/color", "[tex]/html"]
    },
    tex: {
      macros: {
        textsc: ["\\style{font-variant-caps: small-caps}{#1}", 1]
      },
      packages: {
        "[+]": ["color", "html"],
        "[-]": ["noundefined"]
      },
      formatError: (_jax: unknown, err: Error) => {
        throw err;
      }
    },
    svg: {
      fontCache: "none",
      linebreaks: {
        inline: false
      }
    },
    startup: {
      typeset: false
    }
  };
  installKnuthPlassVisitor(config, ["svg"]);
  return config;
}

async function readBrowserRuntime(timeoutMs: number): Promise<MathJaxRuntime | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    const candidate = (globalThis as { MathJax?: unknown }).MathJax;
    const runtime = await coerceBrowserRuntime(candidate);
    if (runtime) {
      return runtime;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await waitForNextTurn();
  }
}

async function coerceBrowserRuntime(candidate: unknown): Promise<MathJaxRuntime | null> {
  if (!isRecord(candidate)) {
    return null;
  }

  if (typeof candidate.tex2svg !== "function") {
    return null;
  }

  const startup = isRecord(candidate.startup) ? startupFromRecord(candidate.startup) : null;
  if (startup?.promise && isPromiseLike(startup.promise)) {
    await startup.promise;
  }

  return {
    tex2svg: candidate.tex2svg as MathJaxRuntime["tex2svg"],
    tex2svgPromise:
      typeof candidate.tex2svgPromise === "function" ? (candidate.tex2svgPromise as MathJaxRuntime["tex2svgPromise"]) : undefined,
    outputJax: startup?.output ?? startup?.document?.outputJax,
    startup: startup ?? undefined
  };
}

function configureBrowserMathJaxGlobal(font: MathJaxFont): void {
  const globals = globalThis as { MathJax?: Record<string, unknown> };
  const existing = isRecord(globals.MathJax) ? globals.MathJax : {};
  const existingLoader = isRecord(existing.loader) ? existing.loader : {};
  const existingTex = isRecord(existing.tex) ? existing.tex : {};
  const existingSvg = isRecord(existing.svg) ? existing.svg : {};
  const existingOutput = isRecord(existing.output) ? existing.output : {};
  const existingStartup = isRecord(existing.startup) ? existing.startup : {};
  const existingTexMacros = isRecord(existingTex.macros) ? existingTex.macros : {};
  const existingTexPackages = isRecord(existingTex.packages) ? existingTex.packages : {};
  const existingSvgLinebreaks = isRecord(existingSvg.linebreaks) ? existingSvg.linebreaks : {};

  const loaderLoad = uniqueStrings([...toStringArray(existingLoader.load), "input/tex", "output/svg", "[tex]/color", "[tex]/html"]);
  const enabledPackages = uniqueStrings([...toStringArray(existingTexPackages["[+]"]), "color", "html"]);
  const disabledPackages = uniqueStrings([...toStringArray(existingTexPackages["[-]"]), "noundefined"]);

  const config = {
    ...existing,
    output: {
      ...existingOutput,
      font
    },
    loader: {
      ...existingLoader,
      load: loaderLoad
    },
    tex: {
      ...existingTex,
      macros: {
        ...existingTexMacros,
        textsc: ["\\style{font-family: serif; font-variant-caps: small-caps}{#1}", 1]
      },
      packages: {
        ...existingTexPackages,
        "[+]": enabledPackages,
        "[-]": disabledPackages
      },
      formatError: (_jax: unknown, err: Error) => {
        throw err;
      }
    },
    svg: {
      ...existingSvg,
      fontCache: "none",
      linebreaks: {
        ...existingSvgLinebreaks,
        inline: false
      }
    },
    startup: {
      ...existingStartup,
      typeset: false
    }
  };
  installKnuthPlassVisitor(config, ["svg"]);
  globals.MathJax = config;
}

function resetBrowserMathJax(): void {
  const documentRef = getBrowserDocument();
  if (documentRef && typeof documentRef.getElementById === "function") {
    const script = documentRef.getElementById(BROWSER_STARTUP_COMPONENT_ID);
    if (isRecord(script) && typeof (script as { remove?: () => void }).remove === "function") {
      (script as { remove: () => void }).remove();
    }
  }
  delete (globalThis as { MathJax?: unknown }).MathJax;
}

async function ensureBrowserStartupComponentLoaded(): Promise<void> {
  const documentRef = getBrowserDocument();
  if (!documentRef) {
    throw new Error("Browser document is unavailable while loading MathJax startup component.");
  }

  const existingScript =
    typeof documentRef.getElementById === "function"
      ? toScriptRecord(documentRef.getElementById(BROWSER_STARTUP_COMPONENT_ID))
      : null;

  if (existingScript) {
    await waitForScriptLoad(existingScript);
    return;
  }

  if (typeof documentRef.createElement !== "function") {
    throw new Error("Browser document.createElement is unavailable for MathJax startup component.");
  }
  const createdScript = toScriptRecord(documentRef.createElement("script"));
  if (!createdScript) {
    throw new Error("Unable to create MathJax startup script element.");
  }

  setScriptStringField(createdScript, "id", BROWSER_STARTUP_COMPONENT_ID);
  setScriptStringField(createdScript, "src", BROWSER_STARTUP_COMPONENT_URL);
  setScriptBooleanField(createdScript, "async", true);
  setScriptBooleanField(createdScript, "defer", true);
  if (typeof createdScript.setAttribute === "function") {
    createdScript.setAttribute("data-tikz-editor-mathjax", "startup");
  }

  const headRef = documentRef.head;
  if (!isRecord(headRef) || typeof headRef.appendChild !== "function") {
    throw new Error("Browser document.head is unavailable for MathJax startup component.");
  }

  const loadPromise = waitForScriptLoad(createdScript);
  headRef.appendChild(createdScript);
  await loadPromise;
}

function getBrowserDocument(): BrowserDocumentLike | null {
  const candidate = (globalThis as { document?: unknown }).document;
  if (!isRecord(candidate)) {
    return null;
  }
  return candidate;
}

function toScriptRecord(value: unknown): ScriptRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  return value;
}

async function waitForScriptLoad(script: ScriptRecord): Promise<void> {
  const maybeLoaded = script[SCRIPT_LOADED_MARKER];
  if (maybeLoaded === true) {
    return;
  }

  const existingError = script[SCRIPT_ERROR_MARKER];
  if (existingError instanceof Error) {
    throw existingError;
  }

  await new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      script[SCRIPT_LOADED_MARKER] = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      const error = new Error(`Unable to load MathJax startup component from ${BROWSER_STARTUP_COMPONENT_URL}.`);
      script[SCRIPT_ERROR_MARKER] = error;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      if (typeof script.removeEventListener === "function") {
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
      }
      const currentOnLoad = script.onload;
      if (currentOnLoad === onLoad) {
        script.onload = null;
      }
      const currentOnError = script.onerror;
      if (currentOnError === onError) {
        script.onerror = null;
      }
    };

    if (typeof script.addEventListener === "function") {
      script.addEventListener("load", onLoad, { once: true });
      script.addEventListener("error", onError, { once: true });
      return;
    }

    script.onload = onLoad;
    script.onerror = onError;
  });
}

function setScriptStringField(script: ScriptRecord, field: "id" | "src", value: string): void {
  script[field] = value;
}

function setScriptBooleanField(script: ScriptRecord, field: "async" | "defer", value: boolean): void {
  script[field] = value;
}

function isMathJaxAdaptor(value: unknown): value is MathJaxAdaptor {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.firstChild === "function" &&
    typeof value.getAttribute === "function" &&
    typeof value.innerHTML === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

function mapMaybePromise<T, R>(
  value: MaybePromise<T>,
  map: (resolved: T) => MaybePromise<R>
): MaybePromise<R> {
  return isPromiseLike(value) ? value.then((resolved) => map(resolved)) : map(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function waitForNextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function formatMathJaxShape(value: unknown): string {
  if (!isRecord(value)) {
    return "globalThis.MathJax is missing.";
  }

  const rootKeys = summarizeKeys(value);
  const startup = isRecord(value.startup) ? value.startup : null;
  const startupKeys = startup ? summarizeKeys(startup) : "(missing)";
  const hasTex2svg = typeof value.tex2svg === "function";
  const hasStartupPromise = startup ? isPromiseLike(startup.promise) : false;
  const hasAdaptor = startup ? isMathJaxAdaptor(startup.adaptor) : false;

  return (
    `MathJax keys: ${rootKeys}; ` +
    `startup keys: ${startupKeys}; ` +
    `tex2svg: ${hasTex2svg}; startup.promise: ${hasStartupPromise}; startup.adaptor: ${hasAdaptor}.`
  );
}

function summarizeKeys(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return "(none)";
  }
  return `[${keys.slice(0, 12).join(", ")}${keys.length > 12 ? ", ..." : ""}]`;
}

function startupFromRecord(value: Record<string, unknown>): MathJaxStartup {
  return {
    adaptor: isMathJaxAdaptor(value.adaptor) ? value.adaptor : undefined,
    document: isRecord(value.document) ? (value.document) : null,
    output: isRecord(value.output) ? value.output : undefined,
    promise: isPromiseLike(value.promise) ? (value.promise) : undefined
  };
}

async function preloadMathJaxWarmupExpressions(runtime: MathJaxRuntime): Promise<void> {
  if (typeof runtime.tex2svgPromise !== "function") {
    return;
  }

  const warmupExpressions = [
    "\\mbox{\\textsf{0}}",
    "\\mbox{\\texttt{0}}",
    "\\mbox{\\textrm{0}}",
    "\\mbox{\\textbf{0}}",
    "\\mbox{\\textit{0}}",
    "\\mbox{$\\mathstrut a$}"
  ];

  for (const expression of warmupExpressions) {
    try {
      await runtime.tex2svgPromise(expression, { display: false });
    } catch {
      // Fall back silently; measure/validate will still guard individual failures.
    }
  }
}

function isMathJaxAsyncRetryError(error: unknown): boolean {
  const message = sanitizeErrorMessage(error).toLowerCase();
  return (
    message.includes("mathjax retry") ||
    (message.includes("asynchronous action is required") && message.includes("promise-based"))
  );
}

function setCappedMapValue<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) {
      break;
    }
    map.delete(oldest.value);
  }
}

/**
 * Reads a capped map entry and refreshes its recency so eviction targets
 * genuinely stale entries. Without this, drag frames — which insert a fresh
 * position-anchored entry per frame for the dragged label — would age out
 * entries that the live scene still renders from.
 */
function getCappedMapValue<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key);
    map.set(key, value);
  }
  return value;
}

function queueAsyncCachePopulate(
  runtime: MathJaxRuntime,
  cache: Map<string, CachedRenderEntry>,
  pendingAsyncRenders: Set<Promise<void>>,
  finalizedPendingCacheKeys: Set<string>,
  asyncRenderQueue: { current: Promise<void> },
  params: {
    cacheKey: string;
    sourceText: string;
    textWidthPt: number | null;
    font: TextFontOptions;
    mode: "text" | "math";
    alignment: NodeTextParagraphAlignment | null;
  }
): void {
  if (typeof runtime.tex2svgPromise !== "function") {
    return;
  }

  const task = asyncRenderQueue.current
    .catch(() => {
      // Keep the queue alive after best-effort async render failures.
    })
    .then(async () => {
      if (cache.has(params.cacheKey)) {
        return;
      }
      const node = await renderMeasuredNodeWithPromise(runtime, params);
      if (cache.has(params.cacheKey)) {
        return;
      }
      const entry = buildCacheEntryWithMetadata(
        params.cacheKey,
        node,
        runtime.startup?.adaptor ?? null,
        params.sourceText,
        null
      );
      if (entry) {
        setCappedMapValue(cache, params.cacheKey, entry, RENDER_CACHE_LIMIT);
        finalizedPendingCacheKeys.add(params.cacheKey);
      }
    })
    .catch(() => {
      // Retry remains best-effort and should not surface parser diagnostics.
    });
  asyncRenderQueue.current = task.then(
    () => {},
    () => {}
  );
  pendingAsyncRenders.add(task);
  void task.finally(() => {
    pendingAsyncRenders.delete(task);
  });
}

function buildCacheEntryWithMetadata(
  cacheKey: string,
  containerNode: unknown,
  adaptor: MathJaxAdaptor | null,
  renderSourceText: string,
  paragraphId: string | null
): CachedRenderEntry | null {
  const extracted = extractSvgPayload(containerNode, adaptor);
  if (!extracted) {
    return null;
  }

  const viewBox = parseViewBox(extracted.viewBoxRaw);
  if (!viewBox) {
    return null;
  }

  const body = extracted.body;
  const resolvedParagraphId = paragraphId ?? extractParagraphIdFromSvgBody(body);
  const baseWidthPt = (viewBox.width / 1000) * DEFAULT_TEXT_FONT_SIZE;
  const baseHeightPt = (viewBox.height / 1000) * DEFAULT_TEXT_FONT_SIZE;
  const ascentUnits = Math.max(0, -viewBox.y);
  const descentUnits = Math.max(0, viewBox.height - ascentUnits);
  const baseLineYPt = -(((ascentUnits - descentUnits) / 2) / 1000) * DEFAULT_TEXT_FONT_SIZE;
  const midLineYPt = baseLineYPt + DEFAULT_TEXT_FONT_SIZE * MIDLINE_FROM_BASELINE_RATIO;

  return {
    payload: {
      cacheKey,
      viewBox,
      body
    },
    baseWidthPt,
    baseHeightPt,
    baseLineYPt,
    midLineYPt,
    paragraphId: resolvedParagraphId,
    renderSourceText
  };
}

/**
 * Position-independent part of a simple-TeX render: the expensive layout and
 * shrink results with offsets relative to the layout input text. Shared across
 * nodes with identical text; the per-node source-map remap happens on top.
 */
type SimpleTexSharedLayout = {
  report: ParagraphLayoutReport;
  vlistLayout: TexVListLayout;
  contentWidthPt: number;
  renderFont: ResolvedTexFont;
};

function buildSimpleTexSharedLayout(params: {
  layoutCacheKey: string;
  layoutCache: Map<string, SimpleTexSharedLayout>;
  sourceText: string;
  textWidthPt: number | null;
  font: TextFontOptions;
  alignment: NodeTextParagraphAlignment | null;
  graphicsResolver?: NodeTextGraphicsResolver;
  colorResolver?: NodeTextColorResolver;
}): SimpleTexSharedLayout | null {
  const cached = getCappedMapValue(params.layoutCache, params.layoutCacheKey);
  if (cached) {
    return cached;
  }
  const isNaturalWidthLayout = params.textWidthPt == null;
  const layoutWidthPt = params.textWidthPt ?? TEX_NATURAL_TEXT_LAYOUT_WIDTH_PT;
  const metricProvider = computerModernTexMetricProvider;
  const textFontProfile = texTextFontProfileForNodeFont(params.font);
  const renderFont = textFontProfile.resolveTextFont(
    textFontProfile.defaultFontState,
    TEX_TEXT_BASE_FONT_SIZE,
    metricProvider
  );
  const paragraphId = `tex:${stableHashString(params.layoutCacheKey)}`;
  let layout: ReturnType<typeof layoutSimpleTexParagraph>;
  try {
    layout = layoutSimpleTexParagraph(params.sourceText, {
      paragraphId,
      width: layoutWidthPt,
      alignment: params.alignment ?? "ragged-right",
      font: renderFont,
      metricProvider,
      textFontProfile,
      tikzTextWidthNode: true,
      mathBoxProvider: createTexDerivedInlineMathBoxProvider({
        baseAtPt: TEX_TEXT_BASE_FONT_SIZE,
      }),
      ...(params.graphicsResolver ? { graphicsResolver: params.graphicsResolver } : {}),
      ...(params.colorResolver ? { colorResolver: params.colorResolver } : {}),
    });
  } catch {
    return null;
  }
  if (!layout.supported || !layout.report || !layout.vlistLayout) {
    return null;
  }
  const contentWidthPt = isNaturalWidthLayout
    ? texParagraphNaturalContentWidth(layout.report)
    : layoutWidthPt;
  const report = isNaturalWidthLayout
    ? shrinkTexParagraphReportToWidth(
        layout.report,
        contentWidthPt,
        hasExplicitMultilineBreaks(params.sourceText) ? "fixed-lines" : undefined
      )
    : layout.report;
  const vlistLayout = isNaturalWidthLayout
    ? shrinkTexVListLayoutToWidth(layout.vlistLayout, contentWidthPt, report)
    : layout.vlistLayout;
  const shared: SimpleTexSharedLayout = { report, vlistLayout, contentWidthPt, renderFont };
  setCappedMapValue(params.layoutCache, params.layoutCacheKey, shared, SIMPLE_TEX_LAYOUT_CACHE_LIMIT);
  return shared;
}

function buildSimpleTexTextCacheEntry(params: {
  runtime: MathJaxRuntime;
  cacheKey: string;
  layoutCacheKey: string;
  layoutCache: Map<string, SimpleTexSharedLayout>;
  sourceText: string;
  textWidthPt: number | null;
  font: TextFontOptions;
  alignment: NodeTextParagraphAlignment | null;
  requestedAlignment: NodeTextParagraphAlignment | null;
  eligible: boolean;
  mode: "text" | "math";
  sourceMap?: TextSourceMap;
  graphicsResolver?: NodeTextGraphicsResolver;
  colorResolver?: NodeTextColorResolver;
}): CachedRenderEntry | null {
  if (!isSimpleTexTextEligible(params)) {
    return null;
  }
  const isNaturalWidthLayout = params.textWidthPt == null;
  const metricProvider = computerModernTexMetricProvider;
  const shared = buildSimpleTexSharedLayout(params);
  if (!shared) {
    return null;
  }
  const { contentWidthPt, renderFont } = shared;
  // The remap projects layout-relative offsets to the node's own source
  // positions, so the remapped report/vlist (and the paragraph id) must be
  // per node — sharing them across identical labels at different source
  // locations would bake the first node's offsets into every copy.
  const paragraphId = `tex:${stableHashString(params.cacheKey)}`;
  const report = {
    ...remapParagraphLayoutReportSourceMap(shared.report, params.sourceMap),
    paragraphId,
  };
  const remappedVList = remapTexVListLayoutSourceMap(shared.vlistLayout, params.sourceMap);
  const vlistLayout = {
    ...remappedVList,
    reports: remappedVList.reports.map((vlistReport) =>
      "paragraphId" in vlistReport && vlistReport.paragraphId === shared.report.paragraphId
        ? report
        : vlistReport
    ),
  };
  const outputJax = getRuntimeOutputJax(params.runtime);
  registerKnuthPlassReportsOnOutputJax(outputJax, [report]);
  registerTexVListLayoutsOnOutputJax(outputJax, [{
    paragraphId,
    layout: vlistLayout,
  }]);

  const baselineMetrics = texNormalBaselineMetrics(renderFont);
  const lineHeightPt = baselineMetrics.baselineskip;
  const singleNaturalLine =
    isNaturalWidthLayout &&
    !hasExplicitMultilineBreaks(params.sourceText) &&
    report.lines.length === 1
      ? report.lines[0]
      : undefined;
  const firstLineTop = texVListPlacedLineTop(
    vlistLayout,
    report.lines[0]?.lineIndex ?? 0
  );
  const firstLineAscent = vlistLayout.baseline.kind === "explicit"
    ? vlistLayout.baseline.y - firstLineTop
    : baselineMetrics.strutHeight;
  const measuredFirstLineAscent = singleNaturalLine?.ascent ?? firstLineAscent;
  const heightPt = singleNaturalLine
    ? Math.max(0, singleNaturalLine.ascent + singleNaturalLine.descent)
    : Math.max(
        lineHeightPt,
        vlistLayout.metrics.height + vlistLayout.metrics.depth
      );
  const widthPt = contentWidthPt;
  const body = renderSimpleTexSvgBody(report, {
    lineHeightPt,
    firstLineAscent: measuredFirstLineAscent,
    vlistLayout,
    metricProvider,
    requestedAlignment: params.requestedAlignment,
  });

  return {
    payload: {
      cacheKey: params.cacheKey,
      viewBox: {
        x: 0,
        y: 0,
        width: widthPt,
        height: heightPt,
      },
      body,
    },
    baseWidthPt: widthPt,
    baseHeightPt: heightPt,
    baseLineYPt: heightPt / 2 - measuredFirstLineAscent,
    midLineYPt: 0,
    paragraphId,
    renderSourceText: params.sourceText,
  };
}

function isSimpleTexTextEligible(params: {
  sourceText: string;
  textWidthPt: number | null;
  font: TextFontOptions;
  alignment: NodeTextParagraphAlignment | null;
  requestedAlignment?: NodeTextParagraphAlignment | null;
  eligible?: boolean;
  mode?: "text" | "math";
}): boolean {
  // Profiling escape hatch: forces the MathJax fallback so benchmarks can
  // compare it against the native simple-TeX path (see scripts/bench-text-engine.mts).
  if ((globalThis as { __TIKZ_EDITOR_FORCE_MATHJAX_TEXT__?: boolean }).__TIKZ_EDITOR_FORCE_MATHJAX_TEXT__ === true) {
    return false;
  }
  if (params.eligible === false) {
    return false;
  }
  if (params.mode !== "text") {
    return false;
  }
  if (params.textWidthPt != null && !(Number.isFinite(params.textWidthPt) && params.textWidthPt > 0)) {
    return false;
  }
  const wordCount = params.sourceText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) {
    return false;
  }
  return (
    params.alignment == null ||
    params.alignment === "ragged-right" ||
    params.alignment === "ragged-left" ||
    params.alignment === "center" ||
    params.alignment === "justified"
  );
}

function texTextFontProfileForNodeFont(font: TextFontOptions): TexTextFontProfile {
  const defaultFontState: SimpleTexFontState = {
    family: font.fontFamily === "sans" ? "sans" : "normal",
    series: font.fontWeight === "bold" ? "bold" : "medium",
    shape: font.fontStyle === "italic" ? "italic" : "upright",
  };
  return {
    ...luaLatexDefaultTextFontProfile,
    defaultFontState,
  };
}

function texParagraphNaturalContentWidth(report: ParagraphLayoutReport): number {
  let width = 0;
  for (const line of report.lines) {
    const lineRight = Math.max(
      line.xEnd,
      ...line.segments.map((segment) => segment.x + segment.width)
    );
    width = Math.max(width, lineRight - Math.min(0, line.xStart));
  }
  return Math.max(SINGLE_LINE_WIDTH_EPSILON_PT, width);
}

function shrinkTexParagraphReportToWidth(
  report: ParagraphLayoutReport,
  width: number,
  layoutMode?: KnuthPlassLayoutMode
): ParagraphLayoutReport {
  return {
    ...report,
    width,
    layoutMode: layoutMode ?? report.layoutMode,
    lines: report.lines.map((line) => ({
      ...line,
      targetWidth: Math.min(line.targetWidth, width)
    }))
  };
}

function shrinkTexVListLayoutToWidth(
  layout: TexVListLayout,
  width: number,
  report: ParagraphLayoutReport
): TexVListLayout {
  return {
    ...layout,
    metrics: {
      ...layout.metrics,
      width
    },
    reports: layout.reports.map((candidate) =>
      "paragraphId" in candidate && candidate.paragraphId === report.paragraphId ? report : candidate
    )
  };
}

function renderSimpleTexSvgBody(
  report: ParagraphLayoutReport,
  options: {
    lineHeightPt: number;
    firstLineAscent: number;
    vlistLayout?: TexVListLayout;
    metricProvider: TexMetricProvider;
    requestedAlignment: NodeTextParagraphAlignment | null;
  }
): string {
  const alignAttr = options.requestedAlignment == null
    ? ""
    : ` data-align="${escapeXmlAttribute(mathJaxAlignAttributeValue(options.requestedAlignment))}"`;
  const pieces: string[] = [
    `<g data-paragraph-id="${escapeXmlAttribute(report.paragraphId)}"${alignAttr} fill="currentColor">`,
  ];
  if (options.vlistLayout) {
    pieces.push(renderTexVListSvgContent(report, {
      ...options,
      vlistLayout: options.vlistLayout,
    }));
    pieces.push("</g>");
    return pieces.join("");
  }
  const renderedLines = new Set<number>();
  for (const line of report.lines) {
    pieces.push(renderTexReportLineSvg(report, line, options, renderedLines));
  }
  pieces.push("</g>");
  return pieces.join("");
}

function renderTexVListSvgContent(
  report: ParagraphLayoutReport,
  options: {
    lineHeightPt: number;
    firstLineAscent: number;
    vlistLayout: TexVListLayout;
    metricProvider: TexMetricProvider;
  }
): string {
  const renderedLines = new Set<number>();
  const lineByIndex = new Map(report.lines.map((line) => [line.lineIndex, line]));
  const linePlacementByIndex = new Map(
    options.vlistLayout.linePlacements.map((placement) => [placement.lineIndex, placement])
  );
  const paragraphLineIndicesByPath = new Map(
    options.vlistLayout.paragraphPlacements.map((placement) => [
      texVListPathKey(placement.vlistPath),
      placement.lineIndices,
    ])
  );
  const renderOptions = {
    ...options,
    lineByIndex,
    linePlacementByIndex,
    paragraphLineIndicesByPath,
    originX: texVListX(0),
    originY: texVListY(0),
  };
  const pieces = renderTexVListItemsSvgContent(
    options.vlistLayout.items,
    report,
    renderOptions,
    renderedLines
  );
  for (const line of report.lines) {
    if (!renderedLines.has(line.lineIndex)) {
      throw new Error(
        `TeX vlist layout for paragraph '${report.paragraphId}' did not place line ${line.lineIndex}.`
      );
    }
  }
  return pieces.join("");
}

type TexVListRenderOptions = {
  lineHeightPt: number;
  firstLineAscent: number;
  metricProvider: TexMetricProvider;
  linePlacementByIndex: ReadonlyMap<number, TexVListLayout["linePlacements"][number]>;
  lineByIndex: ReadonlyMap<number, ParagraphLayoutReport["lines"][number]>;
  paragraphLineIndicesByPath: ReadonlyMap<string, readonly number[]>;
  originX: TexVListX;
  originY: TexVListY;
};

function renderTexVListItemsSvgContent(
  items: readonly PositionedTexVListItem[],
  report: ParagraphLayoutReport,
  options: TexVListRenderOptions,
  renderedLines: Set<number>
): string[] {
  const pieces: string[] = [];
  for (const item of items) {
    if (item.item.kind === "paragraph") {
      const pathKey = texVListPathKey(item.path);
      const assignedLineIndices = options.paragraphLineIndicesByPath.get(pathKey);
      if (!assignedLineIndices) {
        throw new Error(
          `TeX vlist layout for paragraph '${report.paragraphId}' is missing placement for path ${pathKey}.`
        );
      }
      for (const lineIndex of assignedLineIndices) {
        const line = options.lineByIndex.get(lineIndex);
        if (!line) {
          throw new Error(
            `TeX vlist layout for paragraph '${report.paragraphId}' references missing line ${lineIndex}.`
          );
        }
        if (!renderedLines.has(line.lineIndex)) {
          pieces.push(renderTexReportLineSvg(report, line, {
            ...options,
            skipListLabelSegments: true,
          }, renderedLines));
        }
      }
      continue;
    }
    if (item.item.kind === "placeholder") {
      pieces.push(renderTexPlaceholderSvgMetadata(item, report.width, options, options.metricProvider));
      continue;
    }
    if (item.item.kind === "rule") {
      pieces.push(renderTexRuleSvgContent(item, options));
      continue;
    }
    if (item.item.kind === "display-math") {
      pieces.push(renderTexDisplayMathSvgContent(item, options));
      continue;
    }
    if (item.item.kind === "hbox" || item.item.kind === "penalty") {
      pieces.push(renderTexVListLeafBoxSvgMetadata(item, options.metricProvider, options));
      continue;
    }
    if (item.item.kind === "vbox") {
      pieces.push(renderTexVBoxSvgMetadata(item, report.width, {
        ...options,
        close: false,
      }));
      if (item.children?.length) {
        pieces.push(...renderTexVListItemsSvgContent(
          item.children,
          report,
          {
            ...options,
            originX: item.x,
            originY: texVListY(item.y),
          },
          renderedLines
        ));
      }
      pieces.push("</g>");
    }
  }
  return pieces;
}

function texVListPathKey(path: readonly number[]): string {
  return path.join(".");
}

function renderTexReportLineSvg(
  report: ParagraphLayoutReport,
  line: ParagraphLayoutReport["lines"][number],
  options: {
    lineHeightPt: number;
    firstLineAscent: number;
    linePlacementByIndex?: ReadonlyMap<number, TexVListLayout["linePlacements"][number]>;
    metricProvider: TexMetricProvider;
    skipListLabelSegments?: boolean;
    originX?: TexVListX;
    originY?: TexVListY;
  },
  renderedLines: Set<number>
): string {
  renderedLines.add(line.lineIndex);
  const font = options.metricProvider.resolveFont({ atPt: TEX_TEXT_BASE_FONT_SIZE });
  const lineTop = texReportLineTop(report.paragraphId, line.lineIndex, options);
  const lineLeft = Number.isFinite(line.xStart) ? line.xStart : 0;
  const lineXOffset = texReportLineXOffset(line, lineLeft, options);
  const baseline = lineTop + line.ascent;
  const lineBoxHeight = options.linePlacementByIndex?.get(line.lineIndex)?.height ?? options.lineHeightPt;
  const lineLeadingAttr = line.break?.lineLeading
    ? ` data-lineleading="${escapeXmlAttribute(line.break.lineLeading)}"`
    : "";
  const pieces = [
    `<g data-mjx-linebox="true" data-line-index="${line.lineIndex}"${lineLeadingAttr} transform="translate(${formatPt(texVListSvgTranslateX(texVListX(lineXOffset + lineLeft), options.originX))} ${formatPt(texVListSvgTranslateY(lineTop, options.originY))})">`,
    `<rect x="${formatPt(-lineXOffset - lineLeft)}" y="0" width="${formatPt(report.width)}" height="${formatPt(lineBoxHeight)}" fill="transparent" />`,
  ];
  for (const segment of line.segments) {
    if (options.skipListLabelSegments && segment.role === "list-label") {
      continue;
    }
    if (segment.kind === "math") {
      if (segment.mathSvgBody) {
        pieces.push(renderTexInlineMathSvg(
          segment.mathSvgBody,
          segment.x - lineLeft,
          baseline - lineTop
        ));
      }
      continue;
    }
    if (segment.kind !== "text" && segment.kind !== "space") {
      continue;
    }
    const text = segment.text ?? "";
    if (!text) {
      continue;
    }
    const segmentFont = segment.fontId
      ? options.metricProvider.resolveFont({
        fontId: segment.fontId,
        atPt: segment.fontAtPt ?? TEX_TEXT_BASE_FONT_SIZE,
      })
      : font;
    let segmentMarkup: string;
    if (typeof segment.glyphCode === "number") {
      segmentMarkup = renderTexGlyphCode(
        segment.glyphCode,
        segmentFont,
        segment.x - lineLeft,
        baseline - lineTop,
        typeof segment.sourceStartRaw === "number" && typeof segment.sourceEndRaw === "number"
          ? { start: segment.sourceStartRaw, end: segment.sourceEndRaw }
          : undefined
      );
    } else {
      segmentMarkup = renderTexGlyphRun(
        text,
        segmentFont,
        segment.x - lineLeft,
        baseline - lineTop,
        options.metricProvider,
        typeof segment.sourceStartRaw === "number" && typeof segment.sourceEndRaw === "number"
          ? { start: segment.sourceStartRaw, end: segment.sourceEndRaw }
          : undefined
      );
    }
    if (segment.literal) {
      const literalSpanAttrs =
        typeof segment.sourceStartRaw === "number" && typeof segment.sourceEndRaw === "number"
          ? ` data-source-start="${segment.sourceStartRaw}" data-source-end="${segment.sourceEndRaw}"`
          : "";
      segmentMarkup =
        `<g data-tex-literal="${escapeXmlAttribute(segment.literal.reason)}"${literalSpanAttrs}>` +
        segmentMarkup +
        "</g>";
    }
    if (segment.color) {
      segmentMarkup = `<g fill="${escapeXmlAttribute(segment.color)}">${segmentMarkup}</g>`;
    }
    pieces.push(segmentMarkup);
  }
  pieces.push("</g>");
  return pieces.join("");
}

function texReportLineXOffset(
  line: ParagraphLayoutReport["lines"][number],
  lineLeft: number,
  options: {
    readonly linePlacementByIndex?: ReadonlyMap<number, TexVListLayout["linePlacements"][number]>;
  }
): number {
  if (line.segments.some((segment) => segment.role === "list-label")) {
    return 0;
  }
  const placement = options.linePlacementByIndex?.get(line.lineIndex);
  if (!placement) {
    return 0;
  }
  return Math.max(0, placement.x - lineLeft);
}

function renderTexInlineMathSvg(body: string, x: number, baseline: number): string {
  return `<g data-tex-inline-math="true" transform="translate(${formatPt(x)} ${formatPt(baseline)}) scale(${formatPt(TEX_TEXT_BASE_FONT_SIZE / 1000)})">${body}</g>`;
}

function texReportLineTop(
  paragraphId: string,
  lineIndex: number,
  options: {
    readonly lineHeightPt?: number;
    readonly linePlacementByIndex?: ReadonlyMap<number, TexVListLayout["linePlacements"][number]>;
  }
): TexVListY {
  if (options.linePlacementByIndex) {
    const placement = options.linePlacementByIndex.get(lineIndex);
    if (!placement) {
      throw new Error(
        `TeX vlist layout for paragraph '${paragraphId}' is missing line placement ${lineIndex}.`
      );
    }
    return texVListY(placement.y);
  }
  return texVListY(lineIndex * (options.lineHeightPt ?? 0));
}

function texVListPlacedLineTop(layout: TexVListLayout, lineIndex: number): TexVListY {
  const placement = layout.linePlacements.find((entry) => entry.lineIndex === lineIndex);
  if (!placement) {
    throw new Error(`TeX vlist layout is missing line placement ${lineIndex}.`);
  }
  return texVListY(placement.y);
}

export function renderSimpleTexParagraphDebugSvgBody(params: {
  readonly text: string;
  readonly width: number;
  readonly alignment?: NodeTextParagraphAlignment | null;
}): string | null {
  const metricProvider = computerModernTexMetricProvider;
  const renderFont = luaLatexDefaultTextFontProfile.resolveTextFont(
    luaLatexDefaultTextFontProfile.defaultFontState,
    TEX_TEXT_BASE_FONT_SIZE,
    metricProvider
  );
  const layout = layoutSimpleTexParagraph(params.text, {
    paragraphId: "tex:debug-placeholder",
    width: params.width,
    alignment: params.alignment ?? "ragged-right",
    font: renderFont,
    metricProvider,
    textFontProfile: luaLatexDefaultTextFontProfile,
    tikzTextWidthNode: true,
    fallbackPolicy: "placeholder",
    mathBoxProvider: createTexDerivedInlineMathBoxProvider({
      baseAtPt: TEX_TEXT_BASE_FONT_SIZE,
    }),
  });
  if (!layout.supported || !layout.report || !layout.vlistLayout) {
    return null;
  }

  const baselineMetrics = texNormalBaselineMetrics(renderFont);
  const firstLineTop = texVListPlacedLineTop(
    layout.vlistLayout,
    layout.report.lines[0]?.lineIndex ?? 0
  );
  const firstLineAscent = layout.vlistLayout.baseline.kind === "explicit"
    ? layout.vlistLayout.baseline.y - firstLineTop
    : baselineMetrics.strutHeight;
  return renderSimpleTexSvgBody(layout.report, {
    lineHeightPt: baselineMetrics.baselineskip,
    firstLineAscent,
    vlistLayout: layout.vlistLayout,
    metricProvider,
    requestedAlignment: params.alignment ?? null,
  });
}

export function renderTexVListSvgMetadata(
  items: readonly PositionedTexVListItem[],
  width: number
): string {
  return renderTexVListSvgMetadataItems(items, width, {
    originX: texVListX(0),
    originY: texVListY(0),
  });
}

type TexVListSvgOrigin = {
  readonly originX?: TexVListX;
  readonly originY?: TexVListY;
};

function texVListSvgTranslateX(position: TexVListX, origin?: TexVListX): number {
  return position - (origin ?? texVListX(0));
}

function texVListSvgTranslateY(position: TexVListY, origin?: TexVListY): number {
  return position - (origin ?? texVListY(0));
}

function renderTexVListSvgMetadataItems(
  items: readonly PositionedTexVListItem[],
  width: number,
  origin: TexVListSvgOrigin
): string {
  const pieces: string[] = [];
  for (const item of items) {
    if (item.item.kind === "placeholder") {
      pieces.push(renderTexPlaceholderSvgMetadata(item, width, origin));
      continue;
    }
    if (item.item.kind === "hbox" || item.item.kind === "penalty" || item.item.kind === "rule") {
      pieces.push(renderTexVListLeafBoxSvgMetadata(item, undefined, origin));
      continue;
    }
    if (item.item.kind === "display-math") {
      pieces.push(renderTexDisplayMathSvgContent(item, origin));
      continue;
    }
    if (item.item.kind !== "vbox") {
      continue;
    }
    pieces.push(renderTexVBoxSvgMetadata(item, width, { ...origin, close: false }));
    if (item.children?.length) {
      pieces.push(renderTexVListSvgMetadataItems(
        item.children,
        width,
        { originX: item.x, originY: texVListY(item.y) }
      ));
    }
    pieces.push("</g>");
  }
  return pieces.join("");
}

function renderTexVBoxSvgMetadata(
  item: PositionedTexVListItem,
  width: number,
  options: TexVListSvgOrigin & { readonly close?: boolean } = {}
): string {
  if (item.item.kind !== "vbox") {
    return "";
  }
  const boxWidth = Math.max(width, item.metrics.width);
  const boxHeight = item.metrics.height + item.metrics.depth;
  const pieces = [
    `<g transform="translate(${formatPt(texVListSvgTranslateX(item.x, options.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), options.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(boxWidth)}" height="${formatPt(boxHeight)}" fill="none" />`,
  ];
  if (options.close ?? true) {
    pieces.push("</g>");
  }
  return pieces.join("");
}

function renderTexPlaceholderSvgMetadata(
  item: PositionedTexVListItem,
  width: number,
  origin: TexVListSvgOrigin = {},
  metricProvider?: TexMetricProvider
): string {
  if (item.item.kind !== "placeholder") {
    return "";
  }
  const boxHeight = item.metrics.height + item.metrics.depth;
  const boxWidth = Math.max(width, item.metrics.width);
  const pieces = [
    `<g transform="translate(${formatPt(texVListSvgTranslateX(item.x, origin.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), origin.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(boxWidth)}" height="${formatPt(boxHeight)}" fill="none" />`,
  ];
  const literalText = item.item.literalText;
  if (literalText && metricProvider) {
    pieces.push(renderTexPlaceholderLiteralSvg(
      literalText,
      item.item.sourceSpan,
      item.metrics.height,
      metricProvider
    ));
  }
  pieces.push(`</g>`);
  return pieces.join("");
}

function renderTexPlaceholderLiteralSvg(
  literalText: string,
  sourceSpan: { readonly start: number; readonly end: number },
  baseline: number,
  metricProvider: TexMetricProvider
): string {
  const font = luaLatexDefaultTextFontProfile.resolveTextFont(
    { family: "typewriter", series: "medium", shape: "upright" },
    TEX_TEXT_BASE_FONT_SIZE,
    metricProvider
  );
  // The literal face is monospaced, so a single shaped character gives the
  // advance used for word spacing.
  const spaceAdvance = metricProvider.shapeText("x", font).width;
  const pieces = [
    `<g data-tex-literal="display-math-unsupported" data-source-start="${sourceSpan.start}" data-source-end="${sourceSpan.end}">`,
  ];
  let cursor = 0;
  const pattern = /([ \n]+)|([^ \n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(literalText)) !== null) {
    if (match[1] !== undefined) {
      cursor += spaceAdvance * match[1].length;
      continue;
    }
    pieces.push(renderTexGlyphRun(match[0], font, cursor, baseline, metricProvider));
    cursor += metricProvider.shapeText(match[0], font).width;
  }
  pieces.push("</g>");
  return pieces.join("");
}

function renderTexVListLeafBoxSvgMetadata(
  item: PositionedTexVListItem,
  metricProvider?: TexMetricProvider,
  origin: TexVListSvgOrigin = {}
): string {
  if (item.item.kind !== "hbox" && item.item.kind !== "penalty" && item.item.kind !== "rule") {
    return "";
  }
  const boxHeight = item.metrics.height + item.metrics.depth;
  return [
    `<g transform="translate(${formatPt(texVListSvgTranslateX(item.x, origin.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), origin.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(item.metrics.width)}" height="${formatPt(boxHeight)}" fill="none" />`,
    ...(item.item.kind === "hbox" && metricProvider
      ? item.item.box.renderItems.map((renderItem) =>
          renderTexHBoxRenderItemSvg(renderItem, metricProvider)
        )
      : []),
    `</g>`,
  ].join("");
}

function renderTexDisplayMathSvgContent(
  item: PositionedTexVListItem,
  origin: TexVListSvgOrigin = {}
): string {
  if (item.item.kind !== "display-math") {
    return "";
  }
  const boxHeight = item.metrics.height + item.metrics.depth;
  return [
    `<g data-tex-display-math="true" data-source-start="${item.item.sourceSpan.start}" data-source-end="${item.item.sourceSpan.end}" transform="translate(${formatPt(texVListSvgTranslateX(item.x, origin.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), origin.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(item.metrics.width)}" height="${formatPt(boxHeight)}" fill="none" />`,
    renderTexInlineMathSvg(item.item.box.svgBody ?? "", 0, item.metrics.height),
    `</g>`,
  ].join("");
}

function renderTexHBoxRenderItemSvg(
  item: TexRenderItem,
  metricProvider: TexMetricProvider
): string {
  if (item.kind === "tex-math-svg") {
    return renderTexInlineMathSvg(item.svgBody, item.x, item.baseline);
  }
  const font = metricProvider.resolveFont({
    fontId: item.fontId,
    atPt: item.atPt,
  });
  const body = item.kind === "tex-glyph"
    ? renderTexGlyphCode(item.code, font, item.x, item.baseline)
    : renderTexGlyphRun(
    item.text,
    font,
    item.x,
    item.baseline,
    metricProvider
    );
  return item.color ? `<g fill="${escapeXmlAttribute(item.color)}">${body}</g>` : body;
}

function renderTexRuleSvgContent(
  item: PositionedTexVListItem,
  origin: TexVListSvgOrigin = {}
): string {
  if (item.item.kind !== "rule") {
    return "";
  }
  const boxHeight = item.metrics.height + item.metrics.depth;
  return [
    `<g transform="translate(${formatPt(texVListSvgTranslateX(item.x, origin.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), origin.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(item.metrics.width)}" height="${formatPt(boxHeight)}" fill="currentColor" />`,
    `</g>`,
  ].join("");
}

function texNormalBaselineMetrics(font: ResolvedTexFont): {
  readonly baselineskip: number;
  readonly strutHeight: number;
} {
  return {
    baselineskip: font.atPt * LATEX_NORMAL_BASELINESKIP_EM,
    strutHeight: font.atPt * LATEX_NORMAL_STRUT_HEIGHT_EM,
  };
}

function renderTexGlyphRun(
  text: string,
  font: ResolvedTexFont,
  x: number,
  baseline: number,
  metricProvider: TexMetricProvider,
  sourceSpan?: { readonly start: number; readonly end: number }
): string {
  const shaped = metricProvider.shapeText(
    text,
    font,
    sourceSpan ? { sourceStart: sourceSpan.start } : undefined
  );
  const pieces: string[] = [];
  let cursor = x;
  for (const item of shaped.items) {
    if (item.kind === "kern") {
      cursor += item.width;
      continue;
    }
    const glyphItem = sourceSpan && text.length === 1
      ? { ...item, sourceStart: sourceSpan.start, sourceEnd: sourceSpan.end }
      : item;
    pieces.push(renderTexGlyphPath(
      glyphItem,
      font,
      cursor,
      baseline,
      Boolean(sourceSpan)
    ));
    cursor += item.width;
  }
  return pieces.join("");
}

function renderTexGlyphCode(
  code: number,
  font: ResolvedTexFont,
  x: number,
  baseline: number,
  sourceSpan?: { readonly start: number; readonly end: number }
): string {
  return renderTexGlyphPath({
    kind: "glyph",
    fontId: font.id,
    code,
    sourceStart: sourceSpan?.start ?? 0,
    sourceEnd: sourceSpan?.end ?? 0,
    width: 0,
    height: 0,
    depth: 0,
    italicCorrection: 0,
    components: [code],
  }, font, x, baseline, Boolean(sourceSpan));
}

function renderTexGlyphPath(
  item: Extract<TexShapedItem, { kind: "glyph" }>,
  font: ResolvedTexFont,
  x: number,
  baseline: number,
  sourceBacked = false
): string {
  if (item.code === 32) {
    return "";
  }
  const d = font.data.glyphs?.[String(item.code)] ?? "";
  if (!d) {
    return "";
  }
  const scale = font.atPt / 10;
  const scaleSuffix = Math.abs(scale - 1) > 1e-6 ? ` scale(${formatPt(scale)})` : "";
  const sourceAttrs = sourceBacked
    ? ` data-source-start="${item.sourceStart}" data-source-end="${item.sourceEnd}"`
    : "";
  return `<path data-tex-font="${escapeXmlAttribute(font.id)}" data-tex-glyph="${item.code}"${sourceAttrs} d="${escapeXmlAttribute(d)}" transform="translate(${formatPt(x)} ${formatPt(baseline)})${scaleSuffix}" />`;
}

function mathJaxAlignAttributeValue(alignment: NodeTextParagraphAlignment): string {
  switch (alignment) {
    case "ragged-left":
      return "right";
    case "center":
      return "center";
    case "justified":
      return "justify";
    case "ragged-right":
    default:
      return "left";
  }
}

function getRuntimeOutputJax(runtime: MathJaxRuntime): unknown {
  return runtime.outputJax ?? runtime.startup?.output ?? runtime.startup?.document?.outputJax ?? getActiveMathJaxOutputJax();
}

function stableHashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;");
}

function prepareMeasuredRender(params: MeasuredRenderRequest) {
  const explicitMultiline = hasExplicitMultilineBreaks(params.sourceText);
  return {
    ...params,
    explicitMultiline,
    layoutMode: resolveKnuthPlassLayoutMode(params.textWidthPt, explicitMultiline),
    wrappedTextGaps:
      params.mode === "text" ? collectWrappedTextGaps(params.sourceText, params.alignment) : []
  };
}

function buildMeasuredCacheEntry(params: MeasuredRenderRequest & {
  runtime: MathJaxRuntime;
  exactSingleLineWidthCache: Map<string, number>;
  cacheKey: string;
}): CachedRenderEntry | null {
  const { runtime, exactSingleLineWidthCache, cacheKey, sourceText, textWidthPt, font, mode, alignment } = params;
  const plan = prepareMeasuredRender({ sourceText, textWidthPt, font, mode, alignment });
  const adaptor = runtime.startup?.adaptor ?? null;

  const measuredWidth =
    textWidthPt ??
    (plan.explicitMultiline
      ? measureFixedLinesParagraphWidth(sourceText, (line) =>
          measureExactSingleLineWidth(runtime, exactSingleLineWidthCache, line, font, mode)
        ) as number | null
      : measureNaturalWidth(runtime, sourceText, font, mode) as number);
  if (measuredWidth == null || !Number.isFinite(measuredWidth) || measuredWidth <= 0) {
    return null;
  }
  const resolvedWidth = measuredWidth;
  if (textWidthPt == null && !plan.explicitMultiline) {
    return buildExactSingleLineCacheEntry({
      runtime,
      cacheKey,
      sourceText,
      measuredWidthPt: resolvedWidth,
      font,
      mode,
      alignment
    });
  }
  const tex = buildWrappedTeX(sourceText, resolvedWidth, font, alignment, mode);
  applyKnuthPlassRuntimeOptions(runtime, alignment, plan.layoutMode, plan.wrappedTextGaps);
  const node = runtime.tex2svg(tex, { display: false });
  const entry = buildCacheEntryWithMetadata(cacheKey, node, adaptor, sourceText, null);
  if (plan.explicitMultiline && entry?.paragraphId == null) {
    throw new Error("Multiline MathJax render did not produce a paragraph report.");
  }
  return entry;
}

function measureNaturalWidth(
  runtime: MathJaxRuntime,
  sourceText: string,
  font: TextFontOptions,
  mode: MathJaxTextMode,
  asyncRender = false
): MaybePromise<number> {
  const adaptor = runtime.startup?.adaptor ?? null;
  const naturalTex = buildWrappedTeX(sourceText, null, font, null, mode);
  const rendered = asyncRender
    ? runtime.tex2svgPromise!(naturalTex, { display: false })
    : runtime.tex2svg(naturalTex, { display: false });
  return mapMaybePromise(rendered, (node) => {
    const entry = buildCacheEntryWithMetadata("__measure__", node, adaptor, sourceText, null);
    return entry?.baseWidthPt ?? Number.NaN;
  });
}

function measureFixedLinesParagraphWidth(
  sourceText: string,
  measureLine: (line: string) => MaybePromise<number>
): MaybePromise<number | null> {
  const lines = splitExplicitMultilineSource(sourceText);
  let maxWidth: MaybePromise<number> = 0;
  for (const line of lines) {
    maxWidth = mapMaybePromise(maxWidth, (currentMax) =>
      mapMaybePromise(measureLine(line), (width) =>
        Number.isFinite(width) ? Math.max(currentMax, width) : currentMax
      )
    );
  }
  return mapMaybePromise(maxWidth, (resolvedMax) => resolvedMax > 0 ? resolvedMax : null);
}

function measureParagraphRunWidth(report: ParagraphLayoutReport | null): number | null {
  if (!report) {
    return null;
  }
  let totalWidthUnits = 0;
  let sawFiniteRun = false;
  for (const run of report.runs) {
    const width = Number(run.width);
    if (!Number.isFinite(width) || width < 0) {
      continue;
    }
    totalWidthUnits += width;
    sawFiniteRun = true;
  }
  if (sawFiniteRun && totalWidthUnits > 0) {
    return strictUpperParagraphWidthPt(totalWidthUnits);
  }

  let fallbackWidthUnits = 0;
  let sawFiniteLine = false;
  for (const line of report.lines) {
    const naturalWidth = Number(line.naturalWidth);
    if (!Number.isFinite(naturalWidth) || naturalWidth < 0) {
      continue;
    }
    fallbackWidthUnits = Math.max(fallbackWidthUnits, naturalWidth);
    sawFiniteLine = true;
  }
  return sawFiniteLine && fallbackWidthUnits > 0 ? strictUpperParagraphWidthPt(fallbackWidthUnits) : null;
}

function measureExactSingleLineWidth(
  runtime: MathJaxRuntime,
  exactSingleLineWidthCache: Map<string, number>,
  sourceText: string,
  font: TextFontOptions,
  mode: "text" | "math"
): number {
  const cacheKey = exactSingleLineWidthMeasurementKey(mode, sourceText, font);
  const cached = exactSingleLineWidthCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const measuredWidthPt = measureNaturalWidth(runtime, sourceText, font, mode) as number;
  if (!(Number.isFinite(measuredWidthPt) && measuredWidthPt > 0)) {
    setCappedMapValue(exactSingleLineWidthCache, cacheKey, Number.NaN, EXACT_WIDTH_CACHE_LIMIT);
    return Number.NaN;
  }
  const entry = buildExactSingleLineCacheEntry({
    runtime,
    cacheKey: "__measure__",
    sourceText,
    measuredWidthPt,
    font,
    mode,
    alignment: null
  });
  const report = resolveParagraphReportById(runtime, entry?.paragraphId ?? null);
  const paragraphWidthPt = Number(report?.width) * MATHJAX_PARAGRAPH_PT_PER_WIDTH_UNIT;
  const width = Number.isFinite(paragraphWidthPt) && paragraphWidthPt > 0 ? paragraphWidthPt : entry?.baseWidthPt ?? measuredWidthPt;
  setCappedMapValue(exactSingleLineWidthCache, cacheKey, width, EXACT_WIDTH_CACHE_LIMIT);
  return width;
}

function exactSingleLineWidthMeasurementKey(
  mode: "text" | "math",
  sourceText: string,
  font: TextFontOptions
): string {
  return `${mode}|${font.fontStyle}|${font.fontWeight}|${font.fontFamily}|${sourceText}`;
}

async function measureExactSingleLineWidthWithPromise(
  runtime: MathJaxRuntime,
  sourceText: string,
  font: TextFontOptions,
  mode: MathJaxTextMode
): Promise<number> {
  const measuredWidthPt = await measureNaturalWidth(runtime, sourceText, font, mode, true);
  if (!(Number.isFinite(measuredWidthPt) && measuredWidthPt > 0)) {
    return Number.NaN;
  }
  const tex = buildWrappedTeX(sourceText, measuredWidthPt, font, null, mode);
  applyKnuthPlassRuntimeOptions(runtime, null, "fixed-lines");
  const initialNode = await runtime.tex2svgPromise!(tex, { display: false });
  const adaptor = runtime.startup?.adaptor ?? null;
  const initialEntry = buildCacheEntryWithMetadata("__measure__", initialNode, adaptor, sourceText, null);
  const exactWidthPt = await waitForParagraphRunWidth(runtime, initialEntry?.paragraphId ?? null);
  return exactWidthPt ?? measuredWidthPt;
}

function strictUpperParagraphWidthPt(widthUnits: number): number {
  const quantizedFloor =
    Math.floor(widthUnits / MATHJAX_PARAGRAPH_WIDTH_UNIT_STEP + 1e-9) * MATHJAX_PARAGRAPH_WIDTH_UNIT_STEP;
  return (quantizedFloor + MATHJAX_PARAGRAPH_WIDTH_UNIT_STEP) * MATHJAX_PARAGRAPH_PT_PER_WIDTH_UNIT;
}

async function waitForParagraphRunWidth(
  runtime: MathJaxRuntime,
  paragraphId: string | null,
  attempts = 5
): Promise<number | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const width = measureParagraphRunWidth(resolveParagraphReportById(runtime, paragraphId));
    if (Number.isFinite(width) && width != null && width > 0) {
      return width;
    }
    await waitForNextTurn();
  }
  return null;
}

function renderMeasuredNodeWithPromise(
  runtime: MathJaxRuntime,
  params: MeasuredRenderRequest
): Promise<unknown> {
  const plan = prepareMeasuredRender(params);

  const runMeasuredRender = (resolvedWidthPt: number): Promise<unknown> => {
    const tex = buildWrappedTeX(
      params.sourceText,
      resolvedWidthPt,
      params.font,
      params.alignment,
      params.mode
    );
    applyKnuthPlassRuntimeOptions(runtime, params.alignment, plan.layoutMode, plan.wrappedTextGaps);
    return runtime.tex2svgPromise!(tex, { display: false }).then((node) => {
      if (plan.explicitMultiline) {
        const entry = buildCacheEntryWithMetadata(
          "__measure__",
          node,
          runtime.startup?.adaptor ?? null,
          params.sourceText,
          null
        );
        if (entry?.paragraphId == null) {
          throw new Error("Multiline MathJax render did not produce a paragraph report.");
        }
      }
      return node;
    });
  };

  const measuredWidth =
    params.textWidthPt ??
    (plan.explicitMultiline
      ? measureFixedLinesParagraphWidth(params.sourceText, (line) =>
          measureExactSingleLineWidthWithPromise(runtime, line, params.font, params.mode)
        )
      : measureNaturalWidth(runtime, params.sourceText, params.font, params.mode, true));

  return Promise.resolve(measuredWidth).then((measuredWidthPt) => {
    if (measuredWidthPt == null || !Number.isFinite(measuredWidthPt) || measuredWidthPt <= 0) {
      throw new Error("Unable to measure paragraph width.");
    }
    const resolvedWidthPt = measuredWidthPt;
    if (params.textWidthPt != null || plan.explicitMultiline) {
      return runMeasuredRender(resolvedWidthPt);
    }
    return renderExactSingleLineNodeWithPromise(runtime, runMeasuredRender, params.sourceText, resolvedWidthPt);
  });
}

function resolveParagraphReportById(runtime: MathJaxRuntime, paragraphId: string | null): ParagraphLayoutReport | null {
  if (!paragraphId) {
    return null;
  }
  const outputJax =
    runtime.outputJax ??
    runtime.startup?.output ??
    runtime.startup?.document?.outputJax ??
    getActiveMathJaxOutputJax();
  const reports = getKnuthPlassReportsFromOutputJax(outputJax);
  return reports.find((report) => report.paragraphId === paragraphId) ?? null;
}

function buildExactSingleLineCacheEntry(params: {
  runtime: MathJaxRuntime;
  cacheKey: string;
  sourceText: string;
  measuredWidthPt: number;
  font: TextFontOptions;
  mode: "text" | "math";
  alignment: NodeTextParagraphAlignment | null;
}): CachedRenderEntry | null {
  const { runtime, cacheKey, sourceText, measuredWidthPt, font, mode, alignment } = params;
  const adaptor = runtime.startup?.adaptor ?? null;
  const renderWithWidth = (widthPt: number) => {
    const tex = buildWrappedTeX(sourceText, widthPt, font, alignment, mode);
    applyKnuthPlassRuntimeOptions(runtime, alignment, "fixed-lines");
    return runtime.tex2svg(tex, { display: false });
  };

  let currentWidthPt = measuredWidthPt;
  let currentEntry: CachedRenderEntry | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const node = renderWithWidth(currentWidthPt);
    currentEntry = buildCacheEntryWithMetadata(cacheKey, node, adaptor, sourceText, null);
    const report = resolveParagraphReportById(runtime, currentEntry?.paragraphId ?? null);
    const measuredExactWidthPt = measureParagraphRunWidth(report);
    if (
      currentEntry?.paragraphId != null &&
      measuredExactWidthPt == null &&
      typeof runtime.tex2svgPromise === "function"
    ) {
      throw new Error("MathJax Retry: exact paragraph width requires promise-based rendering.");
    }
    const exactWidthPt =
      Number.isFinite(measuredExactWidthPt) && measuredExactWidthPt != null && measuredExactWidthPt > 0
        ? measuredExactWidthPt
        : null;
    if (
      !currentEntry ||
      exactWidthPt == null ||
      (report?.lines.length ?? 0) <= 1 && exactWidthPt <= currentWidthPt + SINGLE_LINE_WIDTH_EPSILON_PT
    ) {
      return currentEntry;
    }
    const nextWidthPt =
      report && report.lines.length > 1 && exactWidthPt <= currentWidthPt + SINGLE_LINE_WIDTH_EPSILON_PT
        ? strictUpperParagraphWidthPt(Number(report.width))
        : exactWidthPt;
    if (!(Number.isFinite(nextWidthPt) && nextWidthPt > currentWidthPt + SINGLE_LINE_WIDTH_EPSILON_PT)) {
      return currentEntry;
    }
    currentWidthPt = nextWidthPt;
  }
  return currentEntry;
}

async function renderExactSingleLineNodeWithPromise(
  runtime: MathJaxRuntime,
  runMeasuredRender: (resolvedWidthPt: number) => Promise<unknown>,
  sourceText: string,
  measuredWidthPt: number
): Promise<unknown> {
  const adaptor = runtime.startup?.adaptor ?? null;
  let currentWidthPt = measuredWidthPt;
  let currentNode: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    currentNode = await runMeasuredRender(currentWidthPt);
    const entry = buildCacheEntryWithMetadata("__measure__", currentNode, adaptor, sourceText, null);
    const reportWidthPt = await waitForParagraphRunWidth(runtime, entry?.paragraphId ?? null);
    const report = resolveParagraphReportById(runtime, entry?.paragraphId ?? null);
    const exactWidthPt =
      Number.isFinite(reportWidthPt) && reportWidthPt != null && reportWidthPt > 0 ? reportWidthPt : null;
    if (
      exactWidthPt == null ||
      ((report?.lines.length ?? 0) <= 1 && exactWidthPt <= currentWidthPt + SINGLE_LINE_WIDTH_EPSILON_PT)
    ) {
      return currentNode;
    }
    const nextWidthPt =
      report && report.lines.length > 1 && exactWidthPt <= currentWidthPt + SINGLE_LINE_WIDTH_EPSILON_PT
        ? strictUpperParagraphWidthPt(Number(report.width))
        : exactWidthPt;
    if (!(Number.isFinite(nextWidthPt) && nextWidthPt > currentWidthPt + SINGLE_LINE_WIDTH_EPSILON_PT)) {
      return currentNode;
    }
    currentWidthPt = nextWidthPt;
  }
  return currentNode;
}

function extractParagraphIdFromSvgBody(body: string): string | null {
  const match = body.match(/data-paragraph-id="([^"]+)"/);
  return match?.[1] ?? null;
}

function hasExplicitMultilineBreaks(text: string): boolean {
  return EXPLICIT_LINE_BREAK_TOKEN_PATTERN.test(text);
}

function splitExplicitMultilineSource(text: string): string[] {
  return splitExplicitMultilineSegments(text).lines;
}

function splitExplicitMultilineSegments(
  text: string
): { lines: string[]; breakLeadings: Array<string | null> } {
  const lines: string[] = [];
  const breakLeadings: Array<string | null> = [];
  let cursor = 0;

  EXPLICIT_LINE_BREAK_WITH_LEADING_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPLICIT_LINE_BREAK_WITH_LEADING_PATTERN.exec(text)) !== null) {
    lines.push(text.slice(cursor, match.index));
    const rawLeading = typeof match[1] === "string" ? match[1].trim() : "";
    breakLeadings.push(rawLeading.length > 0 ? rawLeading : null);
    cursor = match.index + match[0].length;
  }

  lines.push(text.slice(cursor));
  return { lines, breakLeadings };
}

function extractSvgPayload(
  containerNode: unknown,
  adaptor: MathJaxAdaptor | null
): { viewBoxRaw: string | null; body: string } | null {
  if (adaptor) {
    const svgNode = adaptor.firstChild(containerNode);
    if (!svgNode) {
      return null;
    }
    return {
      viewBoxRaw: adaptor.getAttribute(svgNode, "viewBox"),
      body: adaptor.innerHTML(svgNode)
    };
  }

  const svgNode = findSvgElement(containerNode);
  if (!svgNode) {
    return null;
  }

  return {
    viewBoxRaw: readAttr(svgNode, "viewBox"),
    body: readInnerHtml(svgNode)
  };
}

function findSvgElement(value: unknown): unknown {
  if (!isRecord(value)) {
    return null;
  }

  const tagName = typeof value.tagName === "string" ? value.tagName.toLowerCase() : "";
  if (tagName === "svg") {
    return value;
  }

  const querySelector = value.querySelector;
  if (typeof querySelector === "function") {
    const nested: unknown = querySelector.call(value, "svg");
    return nested ?? null;
  }

  return null;
}

function readAttr(node: unknown, name: string): string | null {
  if (!isRecord(node) || typeof node.getAttribute !== "function") {
    return null;
  }
  const value: unknown = node.getAttribute.call(node, name);
  return typeof value === "string" ? value : value == null ? null : "";
}

function readInnerHtml(node: unknown): string {
  if (!isRecord(node)) {
    return "";
  }
  const value = node.innerHTML;
  if (typeof value === "string") {
    return value;
  }
  return "";
}

type ScriptRecord = {
  id?: string;
  src?: string;
  async?: boolean;
  defer?: boolean;
  onload?: (() => void) | null;
  onerror?: (() => void) | null;
  setAttribute?: (name: string, value: string) => void;
  addEventListener?: (name: string, listener: () => void, options?: { once?: boolean }) => void;
  removeEventListener?: (name: string, listener: () => void) => void;
  [SCRIPT_LOADED_MARKER]?: boolean;
  [SCRIPT_ERROR_MARKER]?: unknown;
  [key: string]: unknown;
};

type BrowserDocumentLike = {
  getElementById?: (id: string) => unknown;
  createElement?: (tag: string) => unknown;
  head?: { appendChild?: (node: unknown) => unknown } | null;
};

function measurementKey(
  mode: "text" | "math",
  text: string,
  textWidthPt: number | null,
  font: TextFontOptions,
  alignment: NodeTextParagraphAlignment | null,
  graphicsCacheKey: string | null
): string {
  return JSON.stringify({
    mode,
    text,
    textWidthPt: textWidthPt == null ? null : formatPt(textWidthPt),
    alignment,
    graphicsCacheKey,
    fontStyle: font.fontStyle,
    fontWeight: font.fontWeight,
    fontFamily: font.fontFamily
  });
}

/**
 * Discriminates cache entries per source location: the same label text mapped
 * from a different document position (or after upstream edits shifted it)
 * needs its own remapped geometry, while the expensive layout stays shared
 * via the layout cache.
 */
function simpleTexSourceMapAnchor(sourceMap: TextSourceMap): string {
  return stableHashString(JSON.stringify([sourceMap.charOrigins, sourceMap.boundaryOrigins]));
}

function isSimpleTexCacheEntry(entry: CachedRenderEntry): boolean {
  return entry.paragraphId?.startsWith("tex:") ?? false;
}

function resolveParagraphAlignment(
  textWidthPt: number | null,
  alignment: NodeTextParagraphAlignment | undefined
): NodeTextParagraphAlignment | null {
  if (textWidthPt == null) {
    return alignment ?? null;
  }
  return alignment ?? "ragged-right";
}

function resolveKnuthPlassLayoutMode(
  textWidthPt: number | null,
  explicitMultiline: boolean
): KnuthPlassLayoutMode {
  if (textWidthPt == null) {
    return "fixed-lines";
  }
  return explicitMultiline ? "wrapped-explicit" : "wrap";
}

function applyKnuthPlassRuntimeOptions(
  runtime: MathJaxRuntime,
  alignment: NodeTextParagraphAlignment | null,
  layoutMode: KnuthPlassLayoutMode,
  wrappedTextGaps: WrappedTextGap[] = []
): void {
  const outputJax = runtime.outputJax ?? runtime.startup?.output ?? runtime.startup?.document?.outputJax;
  if (outputJax && typeof outputJax === "object") {
    setKnuthPlassOptionsOnOutputJax(outputJax, {
      layoutMode,
      wrappedTextGaps,
      ...(alignment ? { alignment } : {})
    });
    return;
  }

  // Best-effort fallback for runtimes that do not expose the active output jax.
  KnuthPlassVisitor.configure({
    layoutMode,
    wrappedTextGaps,
    ...(alignment ? { alignment } : {})
  });
}

const WRAPPED_TEXT_SPACE_WIDTH_EM = TEX_INTERWORD_SPACE_EM;
const WRAPPED_TEXT_SENTENCE_SPACE_WIDTH_EM = 0.5;
const TEX_SENTENCE_EXTRA_SPACE_EM = 1 / 9;
const SPACEFACTOR_NEUTRAL_CHARS = new Set(['"', "'", ")", "]", "}"]);
// Render entries are keyed per source location (see simpleTexSourceMapAnchor),
// so a document costs one entry per label INSTANCE rather than per distinct
// text; the cap must comfortably exceed the label count of large documents or
// svg emit reports missing-mathjax-text-render for evicted entries.
const RENDER_CACHE_LIMIT = 2048;
// Shared layouts are keyed per distinct text (deduplicated across instances)
// and hold full report/vlist trees, so a tighter cap suffices.
const SIMPLE_TEX_LAYOUT_CACHE_LIMIT = 512;
const EXACT_WIDTH_CACHE_LIMIT = 512;
const VALIDATION_CACHE_LIMIT = 512;
const SPACEFACTOR_OPENING_CHARS = new Set(["(", "[", "{"]);
const SPACEFACTOR_BY_CHAR = new Map<string, number>([
  [".", 3000],
  ["?", 3000],
  ["!", 3000],
  [":", 2000],
  [";", 1500],
  [",", 1250],
]);

function formatEm(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function isAsciiLetter(char: string): boolean {
  return /^[A-Za-z]$/.test(char);
}

function encodedGapCommand(widthEm: number): string {
  return `\\hspace{${formatEm(widthEm)}em}`;
}

function texSpaceFactorAfterChar(char: string, previousSpaceFactor: number): number {
  if (SPACEFACTOR_NEUTRAL_CHARS.has(char)) {
    return previousSpaceFactor;
  }
  if (SPACEFACTOR_OPENING_CHARS.has(char)) {
    return 1000;
  }
  const punctuationSpaceFactor = SPACEFACTOR_BY_CHAR.get(char);
  if (punctuationSpaceFactor != null) {
    return previousSpaceFactor < 1000 && punctuationSpaceFactor > 1000 ? 1000 : punctuationSpaceFactor;
  }
  if (/[A-Z]/.test(char)) {
    return 999;
  }
  if (/[a-z0-9]/.test(char)) {
    return 1000;
  }
  return 1000;
}

function computeWrappedTextGap(
  spaceFactor: number,
  alignment: NodeTextParagraphAlignment | null
): Omit<WrappedTextGap, "sourceStart"> {
  if (alignment === "justified") {
    const sentenceSpace = spaceFactor >= 2000;
    const stretchScale = Math.max(spaceFactor, 1000) / 1000;
    const shrinkScale = spaceFactor > 0 ? 1000 / Math.max(spaceFactor, 1000) : 1;
    return {
      widthEm: WRAPPED_TEXT_SPACE_WIDTH_EM + (sentenceSpace ? TEX_SENTENCE_EXTRA_SPACE_EM : 0),
      stretchEm: TEX_INTERWORD_STRETCH_EM * stretchScale,
      shrinkEm: TEX_INTERWORD_SHRINK_EM * shrinkScale,
      spaceFactor,
    };
  }

  return {
    widthEm: spaceFactor >= 2000 ? WRAPPED_TEXT_SENTENCE_SPACE_WIDTH_EM : WRAPPED_TEXT_SPACE_WIDTH_EM,
    stretchEm: 0,
    shrinkEm: 0,
    spaceFactor,
  };
}

type WrappedTextSpacingToken =
  | { kind: "text"; value: string }
  | { kind: "gap"; gap: WrappedTextGap };

function tokenizeWrappedTextSpacing(
  text: string,
  alignment: NodeTextParagraphAlignment | null
): WrappedTextSpacingToken[] {
  const tokens: WrappedTextSpacingToken[] = [];
  let index = 0;
  let textStart = 0;
  let inMath = false;
  let spaceFactor = 1000;

  while (index < text.length) {
    const char = text[index];

    if (char === "$") {
      const escaped = index > 0 && text[index - 1] === "\\";
      if (!escaped) {
        inMath = !inMath;
        spaceFactor = 1000;
      }
      index += 1;
      continue;
    }

    if (char === "\\") {
      const next = text[index + 1] ?? "";
      if (next === "\\") {
        index += 2;
        continue;
      }
      if (isAsciiLetter(next)) {
        let end = index + 2;
        while (end < text.length && isAsciiLetter(text[end])) {
          end += 1;
        }
        if (!inMath && text[end] === " ") {
          end += 1;
        }
        spaceFactor = 1000;
        index = end;
        continue;
      }
      spaceFactor = 1000;
      index += Math.min(2, text.length - index);
      continue;
    }

    if (!inMath && /\s/.test(char)) {
      const start = index;
      while (index < text.length && /\s/.test(text[index])) {
        index += 1;
      }
      if (start > textStart) {
        tokens.push({ kind: "text", value: text.slice(textStart, start) });
      }
      tokens.push({
        kind: "gap",
        gap: {
          sourceStart: start,
          ...computeWrappedTextGap(spaceFactor, alignment),
        },
      });
      textStart = index;
      spaceFactor = 1000;
      continue;
    }

    if (!inMath) {
      spaceFactor = texSpaceFactorAfterChar(char, spaceFactor);
    }
    index += 1;
  }

  if (textStart < text.length) {
    tokens.push({ kind: "text", value: text.slice(textStart) });
  }
  return tokens;
}

function collectWrappedTextGaps(
  text: string,
  alignment: NodeTextParagraphAlignment | null
): WrappedTextGap[] {
  return tokenizeWrappedTextSpacing(text, alignment)
    .filter((token): token is Extract<WrappedTextSpacingToken, { kind: "gap" }> => token.kind === "gap")
    .map((token) => token.gap);
}

function encodeWrappedTextSpaces(text: string, alignment: NodeTextParagraphAlignment | null): string {
  return tokenizeWrappedTextSpacing(text, alignment)
    .map((token) => (token.kind === "text" ? token.value : encodedGapCommand(token.gap.widthEm)))
    .join("");
}

function buildWrappedTeX(
  text: string,
  textWidthPt: number | null,
  font: TextFontOptions,
  alignment: NodeTextParagraphAlignment | null,
  mode: "text" | "math" = "text"
): string {
  let styledText =
    mode === "text" && textWidthPt != null ? encodeWrappedTextSpaces(text, alignment) : text;
  if (mode === "text" && font.fontFamily === "sans") {
    styledText = `\\textsf{${styledText}}`;
  } else if (mode === "text" && font.fontFamily === "monospace") {
    styledText = `\\texttt{${styledText}}`;
  }
  if (mode === "text" && font.fontWeight === "bold") {
    styledText = `\\textbf{${styledText}}`;
  }
  if (mode === "text" && font.fontStyle === "italic") {
    styledText = `\\textit{${styledText}}`;
  }
  if (mode === "math") {
    if (textWidthPt == null) {
      return styledText;
    }
    return `\\parbox{${formatPt(textWidthPt)}pt}{$${styledText}$}`;
  }
  if (textWidthPt == null) {
    return `\\mbox{${styledText}}`;
  }
  return `\\parbox[t]{${formatPt(textWidthPt)}pt}{${styledText}}`;
}

function normalizeMathJaxTextInput(
  text: string,
  font: TextFontOptions
): { text: string; font: TextFontOptions; simpleTexEligible: boolean } {
  const resolvedFont: TextFontOptions = { ...font };
  let resolvedText = text;
  resolvedText = resolvedText.replace(EXPLICIT_LINE_BREAK_CANONICAL_PATTERN, "$1");
  resolvedText = resolvedText.replace(/\r\n?/g, "\n").replace(/\n/g, " ");

  return {
    text: resolvedText,
    font: resolvedFont,
    simpleTexEligible: true
  };
}

function formatPt(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function computeFontScale(fontSizePt: number): number {
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
    return 1;
  }
  return fontSizePt / DEFAULT_TEXT_FONT_SIZE;
}

function parseViewBox(raw: string | null): NodeTextRenderPayload["viewBox"] | null {
  if (!raw) {
    return null;
  }
  const parts = raw
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return {
    x: parts[0],
    y: parts[1],
    width: parts[2],
    height: parts[3]
  };
}

function sanitizeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  if (message === "[object Object]" && isRecord(error)) {
    if (typeof error.message === "string" && error.message.trim().length > 0) {
      message = error.message;
    } else if (typeof error.msg === "string" && error.msg.trim().length > 0) {
      message = error.msg;
    } else if (typeof error.reason === "string" && error.reason.trim().length > 0) {
      message = error.reason;
    } else {
      try {
        const serialized = JSON.stringify(error);
        if (typeof serialized === "string" && serialized !== "{}") {
          message = serialized;
        }
      } catch {
        message = "";
      }
    }
  }
  return message.replace(/\s+/g, " ").trim() || "Invalid TeX in node text.";
}
