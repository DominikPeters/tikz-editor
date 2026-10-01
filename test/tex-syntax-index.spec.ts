/* eslint @typescript-eslint/no-base-to-string: ["warn", { "ignoredTypeNames": ["Tree"] }] -- Lezer implements Tree.toString() but omits it from its declarations. */
import {
  beamerDocumentParser,
  texDocumentParser,
  texFragmentParser,
} from "@tikz-editor/lezer-tex";
import { describe, expect, it } from "vitest";

import {
  buildTexSyntaxIndex,
  getTexSyntaxIndex,
  matchTexSyntaxEnvironments,
} from "../packages/core/src/text/tex/syntax-index.js";

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
    )).toEqual(["2-", "beta"]);
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

  it("keys the bounded cache by parser identity as well as source", () => {
    const source = "Alpha <2-> omega";
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
