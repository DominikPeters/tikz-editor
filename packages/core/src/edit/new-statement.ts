import type { PathCommand } from "../ast/types.js";
import type { WorldPoint } from "../coords/points.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import type { SiteContext } from "../semantic/site-context.js";
import type { EvaluateOptions } from "../semantic/types.js";
import type { CoordinateText } from "./fragment.js";
import type { EditGeometrySnapshot } from "./geometry-session.js";
import { prepareInsertion } from "./insertion-context.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { createCoordinateWriter } from "./writer/index.js";

/** A statement about to be written: its command and the raw text of its options. */
export type NewStatement = Readonly<{ command: PathCommand; options: string }>;

/** Writes the coordinates of a new statement where it will be read. Throws `CoordinateWriteRefused`. */
export type NewStatementPoints = (statement: NewStatement) => (point: WorldPoint) => CoordinateText;

export class CoordinateWriteRefused extends Error {}

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
  const writer = createCoordinateWriter(source);
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
    const at = context;
    return point => {
      const written = writer.point({ kind: "context", context: at }, point);
      if (written.kind !== "ok") throw new CoordinateWriteRefused(written.reason);
      return written.fragment;
    };
  };
}
