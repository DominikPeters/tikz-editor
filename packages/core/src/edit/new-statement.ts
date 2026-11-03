import { writeRadii } from "./writer/authored-values.js";
import type { PathCommand } from "../ast/types.js";
import type { WorldPoint } from "../coords/points.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import type { SiteContext } from "../semantic/site-context.js";
import type { EvaluateOptions } from "../semantic/types.js";
import type { CoordinateText } from "./fragment.js";
import type { EditGeometrySnapshot } from "./geometry-session.js";
import { prepareInsertion } from "./insertion-context.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { circleRadiusLengths, createCoordinateWriter, worldEllipseRadiusLengths, type RadiusSpelling } from "./writer/index.js";

/** A statement about to be written: its command and the raw text of its options. */
export type NewStatement = Readonly<{ command: PathCommand; options: string }>;

/**
 * Writes a new statement's coordinates, and its radii, where they will be
 * read. Throws `CoordinateWriteRefused`.
 */
export type StatementPointWriter = ((point: WorldPoint) => CoordinateText) & Readonly<{
  /** A circle of this world radius: `even` where one radius draws it, else an `x radius` and a `y radius`. */
  circleRadii(radius: number): Readonly<{ x: CoordinateText; y: CoordinateText; even: boolean }>;
  /** An ellipse with these world half-axes along the world axes. */
  ellipseRadii(x: number, y: number): Readonly<{ x: CoordinateText; y: CoordinateText }>;
}>;

export type NewStatementPoints = (statement: NewStatement) => StatementPointWriter;

export class CoordinateWriteRefused extends Error {}

/** New radii are lengths, which PGF reads through the CTM alone (not the axis vectors), as they always were. */
const NEW_RADIUS: RadiusSpelling = { unitless: false, unit: "cm" };

/** The writer for a new statement read in `context`. */
export function statementPointWriter(source: string, context: SiteContext): StatementPointWriter {
  const writer = createCoordinateWriter(source);
  const point = (world: WorldPoint) => {
    const written = writer.point({ kind: "context", context }, world);
    if (written.kind !== "ok") throw new CoordinateWriteRefused(written.reason);
    return written.fragment;
  };
  return Object.assign(point, {
    circleRadii(radius: number) {
      const lengths = circleRadiusLengths(context, NEW_RADIUS, radius);
      if (!lengths) throw new CoordinateWriteRefused("a circle cannot be drawn in a skewed frame");
      const radii = writeRadii(lengths);
      return { ...radii, even: radii.x === radii.y };
    },
    ellipseRadii(x: number, y: number) {
      const lengths = worldEllipseRadiusLengths(context, NEW_RADIUS, x, y);
      if (!lengths) throw new CoordinateWriteRefused("the frame turns an ellipse off the axes it was drawn along");
      return writeRadii(lengths);
    }
  });
}

/**
 * Coordinates for a statement appended at the end of the figure, where the
 * evaluator would read it: after everything the picture and its styles set,
 * with the statement's own command and options. Uses the snapshot the caller
 * shows when it is for `source` (a drawing layer's page shift included).
 */
export function appendedStatementPoints(
  source: string,
  parseOptions: EditParseOptions = {},
  evaluateOptions: EvaluateOptions = {},
  geometry?: EditGeometrySnapshot
): NewStatementPoints {
  let snapshot: EditGeometrySnapshot | null = geometry?.source === source ? geometry : null;
  const contexts = new Map<string, SiteContext>();
  return statement => {
    const key = `${statement.command}\u0000${statement.options}`;
    let context = contexts.get(key);
    if (!context) {
      if (!snapshot) {
        const parsed = parseTikzForEdit(source, parseOptions);
        snapshot = { source, parsed, semantic: evaluateTikzFigure(parsed.figure, source, evaluateOptions) };
      }
      context = prepareInsertion(snapshot, { kind: "end" }, { kind: "path", command: statement.command, options: statement.options }, evaluateOptions);
      contexts.set(key, context);
    }
    return statementPointWriter(source, context);
  };
}
