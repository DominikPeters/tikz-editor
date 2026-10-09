import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildBeamerCaretStopDomain,
  prepareBeamerDocument,
  resolveBeamerEditScopeAt,
} from "../../packages/core/src/beamer/index.js";
import type { BeamerEditScopeKind } from "../../packages/core/src/beamer/types.js";
import { createCommandTable, type CommandTable } from "../../packages/core/src/editing/commands/table.js";
import { getTexSyntaxIndex, matchTexSyntaxEnvironments } from "../../packages/core/src/text/tex/syntax-index.js";
import { beamerDocumentParser } from "@tikz-editor/lezer-tex";

export type CorpusScope = {
  readonly file: string;
  readonly frameIndex: number;
  readonly kind: BeamerEditScopeKind;
  /** The scope's source (a session buffer). */
  readonly text: string;
  readonly commands: CommandTable;
  /** The deck the scope is in (absolute path), its source, and the scope's span there. */
  readonly path: string;
  readonly source: string;
  readonly span: { readonly from: number; readonly to: number };
  /** The spans of the deck's frames (the scope is in the one at `frameIndex`). */
  readonly frames: readonly { readonly from: number; readonly to: number }[];
};

const FIXTURE_ROOT = path.resolve(__dirname, "../fixtures/beamer");

function texFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return texFiles(full);
    return entry.name.endsWith(".tex") ? [full] : [];
  });
}

function beamerCorpusFiles(): { file: string; name: string; source: string }[] {
  const extra = (process.env.EDIT_TREE_EXTRA_CORPUS ?? "").split(path.delimiter).filter(Boolean);
  return [...texFiles(FIXTURE_ROOT), ...extra]
    .map((file) => ({ file: path.resolve(file), name: path.relative(FIXTURE_ROOT, file), source: fs.readFileSync(file, "utf8") }))
    .filter(({ source }) => /\\documentclass(?:\[[^\]]*\])?\{beamer\}/u.test(source));
}

export type RenderedCorpusScope = CorpusScope & {
  /** Today's rendered caret stops in the scope, buffer-local. */
  readonly stops: readonly number[];
};

/**
 * The edit scopes the app opens on the first step of every fixture frame,
 * with the caret stops today's renderer publishes for them (built from the
 * paragraphs the app would pass).
 */
export async function renderedBeamerCorpusScopes(): Promise<RenderedCorpusScope[]> {
  const scopes: RenderedCorpusScope[] = [];
  for (const { file, name, source } of beamerCorpusFiles()) {
    const prepared = prepareBeamerDocument(source);
    for (let frameIndex = 0; frameIndex < prepared.document.frames.length; frameIndex += 1) {
      const page = await prepared.renderFrame({ frameIndex, step: 1 });
      const commands = createCommandTable(prepared.frameEditingEnvironment(frameIndex));
      const editScopes = page.layout.editScopes ?? [];
      for (const scope of editScopes) {
        const paragraphs = page.layout.paragraphs.filter((paragraph) =>
          paragraph.role !== "headline" &&
          paragraph.role !== "footline" &&
          resolveBeamerEditScopeAt(editScopes, paragraph.sourceSpan.from)?.id === scope.id &&
          paragraph.sourceSpan.to <= scope.span.to
        );
        if (paragraphs.length === 0) continue;
        const domain = buildBeamerCaretStopDomain({ paragraphs, source });
        scopes.push({
          file: name,
          frameIndex,
          kind: scope.kind,
          text: source.slice(scope.span.from, scope.span.to),
          commands,
          path: file,
          source,
          span: scope.span,
          frames: prepared.document.frames.map((frame) => frame.span),
          stops: domain.offsets
            .filter((offset) => offset >= scope.span.from && offset <= scope.span.to)
            .map((offset) => offset - scope.span.from),
        });
      }
    }
  }
  return scopes;
}

/**
 * Every edit scope of every Beamer fixture (frame titles, frame bodies and
 * column bodies), with its interpretation environment. Extra decks can be
 * added locally with EDIT_TREE_EXTRA_CORPUS (a path list separated by the
 * platform delimiter); they are not part of the repository.
 */
export function beamerCorpusScopes(): CorpusScope[] {
  const scopes: CorpusScope[] = [];
  for (const { file, name, source } of beamerCorpusFiles()) {
    const prepared = prepareBeamerDocument(source);
    const frames = prepared.document.frames.map((frame) => frame.span);
    prepared.document.frames.forEach((frame, frameIndex) => {
      const environment = prepared.frameEditingEnvironment(frameIndex);
      const commands = createCommandTable(environment);
      const add = (kind: CorpusScope["kind"], from: number, to: number) => {
        scopes.push({ file: name, frameIndex, kind, text: source.slice(from, to), commands, path: file, source, span: { from, to }, frames });
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
