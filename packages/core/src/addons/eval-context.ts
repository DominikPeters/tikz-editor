import type {
  AddonChildFrameOptions,
  AddonDiagnostic,
  AddonNodeGeometry,
  AddonStatement as ApiAddonStatement,
  HostClipRef,
  HostEvalContext,
  HostResolvedStyle,
  HostSceneElement,
  HostStatement,
  ScenePathCommand as ApiScenePathCommand,
  WorldPoint as ApiWorldPoint
} from "@tikz-editor/addon-api";

import type { AddonCommandStatement, AddonEnvironmentStatement, Statement } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import { worldBounds, worldPoint } from "../coords/points.js";
import type { WorldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import { expandForeachList } from "../foreach/list.js";
import {
  currentFrame,
  registerAddonCoordinateSystem,
  writeNamedCoordinate,
  writeNamedNodeGeometry,
  type SemanticContext
} from "../semantic/context.js";
import { evaluateRawCoordinate } from "../semantic/coords/evaluate.js";
import { makeTextElement } from "../semantic/nodes/elements.js";
import { resolveNodeLayout } from "../semantic/nodes/layout.js";
import { evaluatePgfMathExpression } from "../semantic/pgfmath/evaluator.js";
import { resolveContextDelta } from "../semantic/style/resolve.js";
import { styleDiagnosticCode } from "../semantic/style/diagnostics.js";
import { cloneStyleChain } from "../semantic/style-chain.js";
import type {
  FeatureUsage,
  ResolvedStyle,
  SceneClipPath,
  SceneElement,
  ScenePathCommand,
  SourceRef
} from "../semantic/types.js";

export type AddonStatement = AddonEnvironmentStatement | AddonCommandStatement;

export class AddonEvalBudgetExceededError extends Error {
  constructor(addonId: string, limit: number) {
    super(`Add-on "${addonId}" exceeded the evaluation budget of ${limit} scene elements`);
    this.name = "AddonEvalBudgetExceededError";
  }
}

export type AddonNestedFrameOptions = {
  styleEntries: OptionEntry[];
  clip: SceneClipPath | null;
};

export type CreateHostEvalContextInput = {
  context: SemanticContext;
  statement: AddonStatement;
  addonId: string;
  diagnostics: Diagnostic[];
  featureUsage: FeatureUsage;
  maxElements: number;
  evaluateNested: (statements: Statement[], frame: AddonNestedFrameOptions) => SceneElement[];
};

export type HostEvalContextHandle = {
  hostContext: HostEvalContext;
  /** Elements minted by this context's factories; used to validate engine results. */
  mintedElements: WeakSet<object>;
  toCoreElements(elements: HostSceneElement[]): SceneElement[];
};

const DEFAULT_ANCHOR_OFFSETS: Record<string, { x: number; y: number }> = {
  center: { x: 0, y: 0 },
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: -1, y: 0 },
  west: { x: 1, y: 0 },
  "north east": { x: -1, y: -1 },
  "north west": { x: 1, y: -1 },
  "south east": { x: -1, y: 1 },
  "south west": { x: 1, y: 1 },
  base: { x: 0, y: 0 }
};

export function createHostEvalContext(input: CreateHostEvalContextInput): HostEvalContextHandle {
  const { context, statement, addonId, diagnostics, featureUsage } = input;
  const frame = () => currentFrame(context);
  const mintedElements = new WeakSet<object>();
  const clipPathsById = new Map<string, SceneClipPath>();
  let elementCounter = 0;
  let clipCounter = 0;

  const sourceRefFor = (sourceId: string | undefined): SourceRef => ({
    sourceId: sourceId ?? statement.id,
    sourceSpan: statement.span,
    sourceFingerprint: context.sourceFingerprint
  });

  const consumeElementBudget = (): void => {
    elementCounter += 1;
    if (elementCounter > input.maxElements) {
      throw new AddonEvalBudgetExceededError(addonId, input.maxElements);
    }
  };

  const nextElementId = (suffix: string): string => `addon:${statement.id}:${suffix}`;

  const toWorld = (point: ApiWorldPoint): WorldPoint => worldPoint(pt(point.x), pt(point.y));

  const toCoreCommands = (commands: ApiScenePathCommand[]): ScenePathCommand[] =>
    commands.map((command): ScenePathCommand => {
      switch (command.kind) {
        case "M":
          return { kind: "M", to: toWorld(command.to) };
        case "L":
          return { kind: "L", to: toWorld(command.to) };
        case "C":
          return { kind: "C", c1: toWorld(command.c1), c2: toWorld(command.c2), to: toWorld(command.to) };
        case "A":
          return {
            kind: "A",
            rx: command.rx,
            ry: command.ry,
            xAxisRotation: command.xAxisRotation,
            largeArc: command.largeArc,
            sweep: command.sweep,
            to: toWorld(command.to)
          };
        case "Z":
          return { kind: "Z" };
      }
    });

  const resolveClipChain = (clip: HostClipRef | undefined): SceneClipPath[] => {
    const inherited = [...frame().clipChain];
    if (!clip) {
      return inherited;
    }
    const clipPath = clipPathsById.get(clip.clipId);
    if (!clipPath) {
      pushAddonDiagnostic({
        severity: "warning",
        message: `Add-on "${addonId}" referenced an unknown clip path`,
        span: statement.span,
        code: "addon-unknown-clip"
      });
      return inherited;
    }
    return [...inherited, clipPath];
  };

  const toCoreStyle = (style: HostResolvedStyle | undefined): ResolvedStyle =>
    (style as unknown as ResolvedStyle | undefined) ?? frame().style;

  const pushAddonDiagnostic = (diagnostic: AddonDiagnostic): void => {
    diagnostics.push({
      severity: diagnostic.severity,
      message: diagnostic.message,
      span: diagnostic.span,
      code: diagnostic.code
    });
  };

  const mint = <T extends SceneElement>(element: T): T => {
    consumeElementBudget();
    mintedElements.add(element);
    return element;
  };

  const baseElementFields = (suffix: string, sourceId: string | undefined, clip: HostClipRef | undefined) => {
    const id = nextElementId(suffix);
    return {
      id,
      runtimeId: id,
      layer: frame().layer,
      sourceRef: sourceRefFor(sourceId),
      styleChain: cloneStyleChain(frame().styleChain),
      clipChain: resolveClipChain(clip)
    };
  };

  const hostContext: HostEvalContext = {
    defaultStyle: () => frame().style,

    resolveStyle: (entries, base) => {
      const coreEntries = entries as unknown as OptionEntry[];
      const optionList: OptionListAst = {
        span: statement.span,
        raw: coreEntries.map((entry) => entry.raw).join(", "),
        entries: coreEntries
      };
      const delta = resolveContextDelta(
        base ? (base as unknown as ResolvedStyle) : frame().style,
        frame().transform,
        [
          {
            kind: "command",
            sourceRef: {
              sourceId: statement.id,
              sourceSpan: statement.span,
              sourceKind: "addon-statement",
              label: addonId
            },
            rawOptions: [optionList]
          }
        ],
        frame().customStyles,
        (raw) => evaluateRawCoordinate(raw, context).world,
        frame().styleChain
      );
      const unhandledKeys = new Set<string>();
      for (const diagnostic of delta.diagnostics) {
        const code = styleDiagnosticCode(diagnostic);
        if (code.startsWith("unsupported-option-key:")) {
          unhandledKeys.add(code.slice("unsupported-option-key:".length));
        } else if (code.startsWith("unsupported-option-flag:")) {
          unhandledKeys.add(code.slice("unsupported-option-flag:".length));
        }
      }
      const unhandled = coreEntries.filter((entry) =>
        entry.kind === "unknown" ? true : unhandledKeys.has(entry.key)
      );
      return {
        style: delta.style,
        unhandled
      };
    },

    evaluateCoordinate: (raw) => {
      const trimmed = raw.trim();
      const wrapped = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed : `(${trimmed})`;
      const evaluated = evaluateRawCoordinate(wrapped, context);
      return evaluated.world ? { x: evaluated.world.x, y: evaluated.world.y } : null;
    },

    writeNamedCoordinate: (name, point) => {
      writeNamedCoordinate(context, name, toWorld(point));
    },

    registerNodeGeometry: (name, geometry: AddonNodeGeometry) => {
      const isCircle = geometry.shape === "circle";
      const radius = Math.max(0, geometry.radius ?? Math.max(geometry.halfWidth, geometry.halfHeight));
      const halfWidth = isCircle ? radius : Math.max(0, geometry.halfWidth);
      const halfHeight = isCircle ? radius : Math.max(0, geometry.halfHeight);
      const center = toWorld(geometry.center);
      writeNamedNodeGeometry(context, name, {
        sourceId: statement.id,
        shape: isCircle ? "circle" : "rectangle",
        center,
        anchorHalfWidth: halfWidth,
        anchorHalfHeight: halfHeight,
        anchorRadius: radius
      });
      // Named nodes expose their basic anchors as eagerly written named
      // coordinates (see semantic/nodes/anchors.ts); mirror that here so
      // "(name.east)" works for add-on-registered geometry.
      const diagonal = isCircle ? Math.SQRT1_2 : 1;
      const anchorOffsets: Record<string, { x: number; y: number }> = {
        center: { x: 0, y: 0 },
        north: { x: 0, y: halfHeight },
        south: { x: 0, y: -halfHeight },
        east: { x: halfWidth, y: 0 },
        west: { x: -halfWidth, y: 0 },
        "north east": { x: halfWidth * diagonal, y: halfHeight * diagonal },
        "north west": { x: -halfWidth * diagonal, y: halfHeight * diagonal },
        "south east": { x: halfWidth * diagonal, y: -halfHeight * diagonal },
        "south west": { x: -halfWidth * diagonal, y: -halfHeight * diagonal }
      };
      for (const [anchor, offset] of Object.entries(anchorOffsets)) {
        const point = worldPoint(pt(center.x + offset.x), pt(center.y + offset.y));
        if (anchor === "center") {
          writeNamedCoordinate(context, name, point);
        }
        writeNamedCoordinate(context, `${name}.${anchor}`, point);
      }
    },

    registerCoordinateSystem: (name, resolve) => {
      registerAddonCoordinateSystem(context, name, (args) => {
        const resolved = resolve(args);
        return resolved && Number.isFinite(resolved.x) && Number.isFinite(resolved.y)
          ? worldPoint(pt(resolved.x), pt(resolved.y))
          : null;
      });
    },

    extendPictureBounds: (bounds) => {
      if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
        return;
      }
      const next = worldBounds(
        pt(Math.min(bounds.minX, bounds.maxX)),
        pt(Math.min(bounds.minY, bounds.maxY)),
        pt(Math.max(bounds.minX, bounds.maxX)),
        pt(Math.max(bounds.minY, bounds.maxY))
      );
      const current = context.pictureBounds;
      context.pictureBounds = current
        ? worldBounds(
            pt(Math.min(current.minX, next.minX)),
            pt(Math.min(current.minY, next.minY)),
            pt(Math.max(current.maxX, next.maxX)),
            pt(Math.max(current.maxY, next.maxY))
          )
        : next;
    },

    makeClipPath: (commands) => {
      clipCounter += 1;
      const clipId = `addon-clip:${statement.id}:${clipCounter}`;
      clipPathsById.set(clipId, {
        id: clipId,
        sourceRef: sourceRefFor(),
        commands: toCoreCommands(commands),
        fillRule: "nonzero"
      });
      return { clipId };
    },

    makePath: (spec) =>
      mint({
        kind: "Path",
        ...baseElementFields(`path:${elementCounter}`, spec.sourceId, spec.clip),
        style: toCoreStyle(spec.style),
        commands: toCoreCommands(spec.commands)
      }),

    makeCircle: (spec) =>
      mint({
        kind: "Circle",
        ...baseElementFields(`circle:${elementCounter}`, spec.sourceId, spec.clip),
        style: toCoreStyle(spec.style),
        center: toWorld(spec.center),
        radius: Math.max(0, spec.radius)
      }),

    makeEllipse: (spec) =>
      mint({
        kind: "Ellipse",
        ...baseElementFields(`ellipse:${elementCounter}`, spec.sourceId, spec.clip),
        style: toCoreStyle(spec.style),
        center: toWorld(spec.center),
        rx: Math.max(0, spec.radiusX),
        ry: Math.max(0, spec.radiusY)
      }),

    layoutText: (text, at, options = {}) => {
      const style = toCoreStyle(options.style);
      const layout = resolveNodeLayout(
        text,
        undefined,
        style,
        1,
        context.textEngine,
        options.textMode ?? "text",
        undefined,
        context.graphicsResolver
      );
      const anchor = DEFAULT_ANCHOR_OFFSETS[options.anchor ?? "center"] ?? DEFAULT_ANCHOR_OFFSETS.center;
      const position = worldPoint(
        pt(at.x + anchor.x * layout.anchorHalfWidth),
        pt(at.y + anchor.y * layout.anchorHalfHeight)
      );
      const suffix = `text:${elementCounter}`;
      const element = mint({
        ...makeTextElement(
          options.sourceId ?? statement.id,
          suffix,
          position,
          style,
          statement.span,
          text,
          layout.textBlockWidth,
          layout.textBlockHeight,
          layout.visualWidth,
          layout.visualHeight,
          layout.textRenderInfo,
          options.rotate,
          frame().styleChain
        ),
        id: nextElementId(suffix),
        runtimeId: nextElementId(suffix),
        layer: frame().layer,
        sourceRef: sourceRefFor(options.sourceId),
        clipChain: resolveClipChain(options.clip)
      });
      return {
        element: element,
        metrics: {
          width: layout.textBlockWidth,
          height: layout.textBlockHeight,
          baseline: layout.baseLineY
        }
      };
    },

    pgfmath: (expr) => {
      const result = evaluatePgfMathExpression(expr);
      return result.ok
        ? { ok: true, kind: result.quantity.kind, value: result.quantity.value }
        : { ok: false, code: result.code, message: result.message };
    },

    expandForeachList: (listRaw) => expandForeachList(listRaw, { parseExpressions: true }),

    evaluateTikzStatements: (statements, frameOptions?: AddonChildFrameOptions) => {
      const clip = frameOptions?.clip ? clipPathsById.get(frameOptions.clip.clipId) ?? null : null;
      const nestedElements = input.evaluateNested(statements as unknown as Statement[], {
        styleEntries: frameOptions?.styleEntries ?? [],
        clip
      });
      for (const element of nestedElements) {
        consumeElementBudget();
        mintedElements.add(element);
      }
      return nestedElements;
    },

    makeElementId: (suffix) => nextElementId(suffix),

    pushDiagnostic: pushAddonDiagnostic,

    markFeature: (featureId, status) => {
      if (!featureId.startsWith(`addon:${addonId}:`)) {
        return;
      }
      const current = featureUsage[featureId] ?? "unused";
      if (status === "unsupported") {
        featureUsage[featureId] = "used-unsupported";
      } else if (current !== "used-unsupported") {
        featureUsage[featureId] = "used-supported";
      }
    },

    preambleConfig: context.addonPreambleConfigs.get(addonId)
  };

  return {
    hostContext,
    mintedElements,
    toCoreElements: (elements) => {
      const coreElements: SceneElement[] = [];
      for (const element of elements) {
        if (mintedElements.has(element)) {
          coreElements.push(element as unknown as SceneElement);
        } else {
          pushAddonDiagnostic({
            severity: "warning",
            message: `Add-on "${addonId}" returned an element not created via the host context; it was dropped.`,
            span: statement.span,
            code: "addon-invalid-element"
          });
        }
      }
      return coreElements;
    }
  };
}

export function toApiStatement(statement: AddonStatement): ApiAddonStatement {
  return statement;
}

export function toApiStatements(statements: Statement[]): HostStatement[] {
  return statements;
}
