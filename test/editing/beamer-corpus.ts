import * as fs from "node:fs";
import * as path from "node:path";

import { prepareBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { createCommandTable, type CommandTable } from "../../packages/core/src/editing/commands/table.js";
import { getTexSyntaxIndex, matchTexSyntaxEnvironments } from "../../packages/core/src/text/tex/syntax-index.js";
import { beamerDocumentParser } from "@tikz-editor/lezer-tex";

export type CorpusScope = {
  readonly file: string;
  readonly frameIndex: number;
  readonly kind: "frame-title" | "frame-body" | "column";
  /** The scope's source (a session buffer). */
  readonly text: string;
  readonly commands: CommandTable;
};

const FIXTURE_ROOT = path.resolve(__dirname, "../fixtures/beamer");

function texFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return texFiles(full);
    return entry.name.endsWith(".tex") ? [full] : [];
  });
}

/**
 * Every edit scope of every Beamer fixture (frame titles, frame bodies and
 * column bodies), with its interpretation environment. Extra decks can be
 * added locally with EDIT_TREE_EXTRA_CORPUS (a path list separated by the
 * platform delimiter); they are not part of the repository.
 */
export function beamerCorpusScopes(): CorpusScope[] {
  const extra = (process.env.EDIT_TREE_EXTRA_CORPUS ?? "").split(path.delimiter).filter(Boolean);
  const files = [...texFiles(FIXTURE_ROOT), ...extra];
  const scopes: CorpusScope[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    if (!/\\documentclass(?:\[[^\]]*\])?\{beamer\}/u.test(source)) continue;
    const prepared = prepareBeamerDocument(source);
    const name = path.relative(FIXTURE_ROOT, file);
    prepared.document.frames.forEach((frame, frameIndex) => {
      const environment = prepared.frameEditingEnvironment(frameIndex);
      const commands = createCommandTable(environment);
      const add = (kind: CorpusScope["kind"], from: number, to: number) => {
        scopes.push({ file: name, frameIndex, kind, text: source.slice(from, to), commands });
      };
      if (frame.title) add("frame-title", frame.title.contentSpan.from, frame.title.contentSpan.to);
      add("frame-body", frame.bodySpan.from, frame.bodySpan.to);
      const body = source.slice(frame.bodySpan.from, frame.bodySpan.to);
      const index = getTexSyntaxIndex(body, beamerDocumentParser);
      for (const environmentMatch of matchTexSyntaxEnvironments(index).values()) {
        if (environmentMatch.name !== "column") continue;
        // The column body starts after its width argument.
        const widthEnd = index.groupByStart.get(environmentMatch.begin.span.to)?.span.to ?? environmentMatch.begin.span.to;
        add("column", frame.bodySpan.from + widthEnd, frame.bodySpan.from + environmentMatch.contentSpan.to);
      }
    });
  }
  return scopes;
}
