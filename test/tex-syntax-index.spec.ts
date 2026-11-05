/* eslint @typescript-eslint/no-base-to-string: ["warn", { "ignoredTypeNames": ["Tree"] }] -- Lezer implements Tree.toString() but omits it from its declarations. */
import {
  beamerDocumentParser,
  texDocumentParser,
  texFragmentParser,
} from "@tikz-editor/lezer-tex";
import { LRParser } from "@lezer/lr";
import { describe, expect, it } from "vitest";

import {
  buildTexSyntaxIndex,
  getTexSyntaxIndex,
  matchTexSyntaxEnvironments,
  type TexSyntaxIndex,
} from "../packages/core/src/text/tex/syntax-index.js";
import { collectTestGarbage } from "./setup/gc.js";

describe("shared TeX syntax index", () => {
  it("indexes controls, stars, trivia, and nested arguments", () => {
    const source = String.raw`\command*% comment
[outer={nested},escaped=\{]{required {child} and \}}`;
    const index = buildTexSyntaxIndex(source, texFragmentParser);
    const command = index.controls[0];

    expect(command).toMatchObject({
      name: "command",
      kind: "word",
      commandSpan: { from: 0, to: 8 },
      span: { from: 0, to: 9 },
      starSpan: { from: 8, to: 9 },
    });
    const optional = index.argumentAfter(
      command?.span.to ?? 0,
      "optional",
      source.length
    );
    const required = index.argumentAfter(
      optional?.span.to ?? 0,
      "required",
      source.length
    );
    expect(valueOf(source, optional?.contentSpan)).toBe(
      String.raw`outer={nested},escaped=\{`
    );
    expect(valueOf(source, required?.contentSpan)).toBe(
      String.raw`required {child} and \}`
    );
    expect(optional).toMatchObject({ complete: true, recovered: false });
    expect(required).toMatchObject({ complete: true, recovered: false });
    expect(index.comments).toHaveLength(1);
    expect(index.controls.map((control) => control.name)).toEqual([
      "command",
      "{",
      "}",
    ]);
  });

  it("keeps top-level angle syntax profile-specific", () => {
    const source = String.raw`\only<2->{Visible} Alpha <beta>`;
    const generic = buildTexSyntaxIndex(source, texDocumentParser);
    const beamer = buildTexSyntaxIndex(source, beamerDocumentParser);
    const only = beamer.controls.find((control) => control.name === "only");

    expect(generic.overlayArguments).toEqual([]);
    expect(beamer.overlayArguments.map((argument) =>
      valueOf(source, argument.contentSpan)
    )).toEqual(["2-"]);
    expect(
      beamer.argumentAfter(only?.span.to ?? 0, "overlay", source.length)
    ).toEqual(beamer.overlayArguments[0]);
    expect(generic.tree.toString()).not.toContain("OverlaySpecification");
    expect(beamer.tree.toString()).toContain("OverlaySpecification");
  });

  it("exposes flat boundaries independently of mismatched CST nesting", () => {
    const source = String.raw`\begin{foo}
\end{bar}
\begin{frame}Visible\end{frame}`;
    const index = buildTexSyntaxIndex(source, beamerDocumentParser);

    expect(index.environmentBoundaries.map((boundary) => [
      boundary.kind,
      boundary.name,
    ])).toEqual([
      ["begin", "foo"],
      ["end", "bar"],
      ["begin", "frame"],
      ["end", "frame"],
    ]);
    expect(
      index.environmentBoundariesIn({ from: source.indexOf("\\begin{frame}"), to: source.length })
        .map((boundary) => boundary.name)
    ).toEqual(["frame", "frame"]);
    expect(
      [...matchTexSyntaxEnvironments(index).values()].map(
        (environment) => environment.name
      )
    ).toEqual(["frame"]);
  });

  it.each([
    "BVerbatim",
    "Verbatim",
    "alltt",
    "lstlisting",
    "minted",
    "semiverbatim",
    "verbatim",
    "verbatim*",
  ])("masks structural syntax inside %s", (name) => {
    const header =
      name === "minted"
        ? "{tex}"
        : name === "BVerbatim" ||
            name === "Verbatim" ||
            name === "lstlisting"
          ? "[numbers=left]"
          : "";
    const source = String.raw`\begin{${name}}${header}
{ unmatched
literal % \end{frame}
\begin{frame}{not structural}
\end{${name}}
\begin{frame}Visible\end{frame}`;
    const index = buildTexSyntaxIndex(source, beamerDocumentParser);

    expect(index.opaqueEnvironments).toHaveLength(1);
    expect(index.opaqueEnvironments[0]).toMatchObject({
      name,
      recovered: false,
    });
    expect(index.environmentBoundaries.map((boundary) => boundary.name)).toEqual([
      name,
      name,
      "frame",
      "frame",
    ]);
    expect(
      index.controlsIn(index.opaqueEnvironments[0]?.bodySpan ?? { from: 0, to: 0 })
    ).toEqual([]);
    expect(index.comments).toEqual([]);
  });

  it("retains recovered arguments and unterminated opaque bodies", () => {
    const argumentSource = String.raw`\command{unfinished`;
    const argumentIndex = buildTexSyntaxIndex(
      argumentSource,
      texFragmentParser
    );
    const argument = argumentIndex.argumentAfter(
      argumentIndex.controls[0]?.span.to ?? 0,
      "required",
      argumentSource.length
    );
    expect(argument).toMatchObject({
      complete: false,
      recovered: true,
      span: { from: 8, to: argumentSource.length },
    });

    const opaqueSource = String.raw`\begin{verbatim}
literal % \end{frame}`;
    const opaqueIndex = buildTexSyntaxIndex(
      opaqueSource,
      beamerDocumentParser
    );
    expect(opaqueIndex.opaqueEnvironments[0]).toMatchObject({
      name: "verbatim",
      endSpan: null,
      recovered: true,
      bodySpan: { to: opaqueSource.length },
    });
    expect(opaqueIndex.errors.length).toBeGreaterThan(0);
    expect(opaqueIndex.environmentBoundaries.map((boundary) => boundary.name))
      .toEqual(["verbatim"]);
  });

  it("reparses from the previous index after an edit with the same result as a fresh parse", () => {
    const base = String.raw`\begin{frame}{Title}
  The previous slide says the system
  \[ f(x)^Td<0 \]
  \item<2-> More \textbf{text}.
\end{frame}`;
    getTexSyntaxIndex(base, beamerDocumentParser);
    for (const edit of [" given as", "\\alpha", "{", "}"]) {
      const at = base.indexOf("system") + "system".length;
      const edited = base.slice(0, at) + edit + base.slice(at);
      const incremental = getTexSyntaxIndex(edited, beamerDocumentParser);
      const fresh = buildTexSyntaxIndex(edited, beamerDocumentParser);
      expect(incremental.tree.toString()).toBe(fresh.tree.toString());
      expect(incremental.groups).toEqual(fresh.groups);
      expect(incremental.controls).toEqual(fresh.controls);
    }
  });

  it("keeps reparsing a document from its own tree while fragments of it are indexed in between", () => {
    const frame = String.raw`\begin{frame}{Slide}
  Text with a caption \caption{A figure} and a \footnote{note}.
\end{frame}
`;
    const document = `\\documentclass{beamer}\n\\begin{document}\n${frame.repeat(40)}\\end{document}\n`;
    getTexSyntaxIndex(document, beamerDocumentParser);
    const reused: number[] = [];
    const createParse = LRParser.prototype.createParse;
    LRParser.prototype.createParse = function (input, fragments, ranges) {
      if (this === beamerDocumentParser && input.length > 1000) {
        reused.push(fragments.reduce((sum, fragment) => sum + fragment.to - fragment.from, 0));
      }
      return createParse.call(this, input, fragments, ranges);
    };
    try {
      let source = document;
      for (let key = 0; key < 12; key++) {
        // A render indexes fragments of the document with the same parser.
        for (const fragment of ["A figure", "note", `caption ${key}`]) getTexSyntaxIndex(fragment, beamerDocumentParser);
        const at = source.indexOf("Text with") + key;
        source = source.slice(0, at) + "x" + source.slice(at);
        getTexSyntaxIndex(source, beamerDocumentParser);
      }
    } finally {
      LRParser.prototype.createParse = createParse;
    }
    expect(reused).toHaveLength(12);
    for (const length of reused) expect(length).toBeGreaterThan(document.length / 2);
  });

  it.each([200000, 600000])("bounds retained syntax history for unrelated %i-character documents", async (length) => {
    const parser = beamerDocumentParser.configure({});
    const references: WeakRef<TexSyntaxIndex>[] = [];
    for (let index = 0; index < 8; index++) {
      // Distinct first/last characters prevent replacing the previous index
      // as an edit of the same document, exercising separate history entries.
      references.push(new WeakRef(getTexSyntaxIndex(String.fromCharCode(97 + index).repeat(length), parser)));
    }
    await collectTestGarbage();
    const retained = references.filter(reference => reference.deref()).length;
    // Normal indexes can be owned by both the reusable cache and history,
    // each with its own byte budget; oversized indexes only live in history.
    expect(retained).toBeLessThanOrEqual(length === 600000 ? 1 : 4);
    expect(retained).toBeGreaterThan(0);
    // Keep the WeakMap owner alive through collection as it is in the app.
    expect(parser.topNode.name).toBe(beamerDocumentParser.topNode.name);
  });

  it("keeps an oversized active document available for incremental edits between fragment parses", () => {
    const parser = beamerDocumentParser.configure({});
    let source = `${"% padding\n".repeat(60000)}\\begin{frame}Text\\end{frame}`;
    getTexSyntaxIndex(source, parser);
    const reused: number[] = [];
    const createParse = LRParser.prototype.createParse;
    LRParser.prototype.createParse = function (input, fragments, ranges) {
      if (this === parser && input.length > 500000) {
        reused.push(fragments.reduce((sum, fragment) => sum + fragment.to - fragment.from, 0));
      }
      return createParse.call(this, input, fragments, ranges);
    };
    try {
      for (let edit = 0; edit < 3; edit++) {
        for (let fragment = 0; fragment < 12; fragment++) getTexSyntaxIndex(`caption ${fragment}`, parser);
        source = source.replace("Text", `Text${edit}`);
        getTexSyntaxIndex(source, parser);
      }
    } finally {
      LRParser.prototype.createParse = createParse;
    }
    expect(reused).toHaveLength(3);
    for (const length of reused) expect(length).toBeGreaterThan(source.length / 2);
  });

  it("keys the bounded cache by parser identity as well as source", () => {
    const source = String.raw`\item<2-> omega`;
    const generic = getTexSyntaxIndex(source, texDocumentParser);
    const beamer = getTexSyntaxIndex(source, beamerDocumentParser);

    expect(getTexSyntaxIndex(source, texDocumentParser)).toBe(generic);
    expect(getTexSyntaxIndex(source, beamerDocumentParser)).toBe(beamer);
    expect(generic).not.toBe(beamer);
    expect(generic.overlayArguments).toEqual([]);
    expect(beamer.overlayArguments).toHaveLength(1);
  });
});

function valueOf(
  source: string,
  span: { readonly from: number; readonly to: number } | undefined
): string | undefined {
  return span ? source.slice(span.from, span.to) : undefined;
}
