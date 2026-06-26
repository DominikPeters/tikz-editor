import { describe, expect, it } from "vitest";

import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import type { EvaluateTikzResult } from "../../packages/core/src/semantic/evaluate.js";
import type { EditHandle, SceneElement } from "../../packages/core/src/semantic/types.js";
import { wp } from "../coords-helpers.js";
import { evaluateSemantic, elementsOfKind } from "./helpers.js";

function assertOriginalSourceRefInvariants(source: string, result: EvaluateTikzResult): void {
  for (const element of result.scene.elements) {
    expect(element.sourceRef.sourceSpan.from).toBeGreaterThanOrEqual(0);
    expect(element.sourceRef.sourceSpan.to).toBeGreaterThanOrEqual(element.sourceRef.sourceSpan.from);
    expect(element.sourceRef.sourceSpan.to).toBeLessThanOrEqual(source.length);
  }

  for (const handle of result.editHandles) {
    expect(handle.sourceRef.sourceSpan.from).toBeGreaterThanOrEqual(0);
    expect(handle.sourceRef.sourceSpan.to).toBeGreaterThanOrEqual(handle.sourceRef.sourceSpan.from);
    expect(handle.sourceRef.sourceSpan.to).toBeLessThanOrEqual(source.length);
    if (handle.sourceText.length > 0) {
      expect(handle.sourceText).toBe(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to));
    }
  }
}

function assertGeneratedIdentityRefs(result: EvaluateTikzResult): void {
  for (const element of result.scene.elements) {
    if (!isStatementExpandedElement(element)) {
      continue;
    }
    expect(element.identityRef?.sourceId).toBeTruthy();
    expect(element.identityRef?.sourceSpan.to).toBeGreaterThan(element.identityRef?.sourceSpan.from ?? -1);
  }

  for (const handle of result.editHandles) {
    if (!handle.sourceRef.sourceId.startsWith("foreach:") && !handle.sourceRef.sourceId.startsWith("unknown-statement:")) {
      continue;
    }
    expect(handle.identityRef?.sourceId).toBeTruthy();
    expect(handle.identityRef?.sourceSpan.to).toBeGreaterThan(handle.identityRef?.sourceSpan.from ?? -1);
  }
}

function assertRemappedStyleIdentityRefs(result: EvaluateTikzResult): void {
  for (const element of result.scene.elements) {
    if (!isStatementExpandedElement(element)) {
      continue;
    }
    const remappedEntries = element.styleChain.filter(
      (entry) => entry.sourceRef?.sourceSpan && entry.sourceRef.identityRef
    );
    expect(remappedEntries.length).toBeGreaterThan(0);
    for (const entry of remappedEntries) {
      expect(entry.sourceRef?.identityRef?.sourceId).toBeTruthy();
    }
  }
}

function isStatementExpandedElement(element: SceneElement): boolean {
  return element.sourceRef.sourceId.startsWith("foreach:")
    || element.sourceRef.sourceId.startsWith("unknown-statement:")
    || (element.origin?.macroStack?.length ?? 0) > 0;
}

function generatedElements(result: EvaluateTikzResult): SceneElement[] {
  return result.scene.elements.filter(
    (element) =>
      element.identityRef ||
      element.sourceRef.sourceId.startsWith("foreach:") ||
      element.sourceRef.sourceId.startsWith("unknown-statement:") ||
      (element.origin?.foreachStack.length ?? 0) > 0 ||
      (element.origin?.macroStack?.length ?? 0) > 0
  );
}

function generatedHandles(result: EvaluateTikzResult): EditHandle[] {
  return result.editHandles.filter((handle) => handle.identityRef);
}

describe("semantic source attribution invariants", () => {
  it("keeps statement foreach source refs original-facing and identity refs generated-facing", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \draw[red] (\x,0) -- ++(1,0);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    for (const path of elementsOfKind(result.scene.elements, "Path")) {
      expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toBe(String.raw`\draw[red] (\x,0) -- ++(1,0);`);
      expect(path.identityRef?.sourceId.startsWith("path:")).toBe(true);
    }
  });

  it("keeps nested foreach instances tied to the original nested template", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \foreach \y in {0,1}
      \draw[blue] (\x,\y) -- ++(1,0);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    for (const path of elementsOfKind(result.scene.elements, "Path")) {
      expect(path.origin?.foreachStack).toHaveLength(2);
      expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toBe(String.raw`\draw[blue] (\x,\y) -- ++(1,0);`);
    }
  });

  it("maps inline path foreach handles back to the original repeated coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (\x,0) };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const path = elementsOfKind(result.scene.elements, "Path")[0];
    expect(path?.origin?.foreachStack.length).toBeGreaterThan(0);
    expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toContain("foreach");
    const generatedHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(generatedHandles).toHaveLength(2);
    expect(new Set(generatedHandles.map((handle) => handle.runtimeId)).size).toBe(generatedHandles.length);
    for (const handle of generatedHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)).toBe(String.raw`(\x,0)`);
      expect(handle.identityRef?.sourceId).toContain("coordinate");
    }
  });

  it("composes nested inline path foreach source maps", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { foreach \y in {0,1} { -- (\x,\y) } };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const generatedHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(generatedHandles).toHaveLength(4);
    for (const handle of generatedHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)).toBe(String.raw`(\x,\y)`);
    }
  });

  it("keeps node foreach source refs original-facing", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node foreach \p in {0.25,0.75} [pos=\p] {\p};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const labels = elementsOfKind(result.scene.elements, "Text").filter((element) => element.text === "0.25" || element.text === "0.75");
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.origin?.foreachStack.length).toBeGreaterThan(0);
      expect(label.identityRef?.sourceId).toBe("node:0:0");
      expect(source.slice(label.sourceRef.sourceSpan.from, label.sourceRef.sourceSpan.to)).toBe(String.raw`node foreach \p in {0.25,0.75} [pos=\p] {\p}`);
    }
    const nodeHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(nodeHandles).toHaveLength(2);
    for (const handle of nodeHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)).toBe(String.raw`[pos=\p]`);
    }
  });

  it("keeps pic generated elements grouped on the invocation with template identity refs", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{tick/.pic={\draw[blue] (0,0) -- (1,0);}}
  \pic at (1,0) {tick};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const path = elementsOfKind(result.scene.elements, "Path")[0];
    expect(path?.sourceRef.sourceId).toMatch(/^pic-operation:/);
    expect(path?.identityRef?.sourceId).toBe("path:0");
    expect(path?.origin?.picStack).toHaveLength(1);
    expect(path?.origin?.picTemplateLocalTargetId).toBe("path:0");
    expect(source.slice(path?.sourceRef.sourceSpan.from ?? 0, path?.sourceRef.sourceSpan.to ?? 0)).toBe(String.raw`\pic at (1,0) {tick};`);
  });

  it("maps chained node foreach clauses to the original node template", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) node foreach \x in {0,1} foreach \y in {a,b} [name=n\x\y] {\x\y};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const labels = elementsOfKind(result.scene.elements, "Text").filter((element) => /^(0|1)(a|b)$/.test(element.text));
    expect(labels).toHaveLength(4);
    for (const label of labels) {
      expect(label.identityRef?.sourceId).toBe("node:0:0");
      expect(source.slice(label.sourceRef.sourceSpan.from, label.sourceRef.sourceSpan.to)).toBe(String.raw`node foreach \x in {0,1} foreach \y in {a,b} [name=n\x\y] {\x\y}`);
    }
  });

  it("does not regress child foreach evaluation while attribution remains original-bounded", () => {
    const source = String.raw`\begin{tikzpicture}
  \node {root}
    child foreach \x in {A,B} { node {\x} };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    assertOriginalSourceRefInvariants(source, result);
  });

  it("falls back to the path foreach operation span when macro-expanded path fragments are not precisely mappable", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\seg{-- (1,0)}
  \draw (0,0) foreach \x in {1,2} { \seg };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const generatedHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(generatedHandles).toHaveLength(2);
    for (const handle of generatedHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)).toBe(String.raw`foreach \x in {1,2} { \seg }`);
    }
  });

  it("maps macro-expanded path statements to invocation source refs with generated identity refs", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\myline}{\draw[red] (0,0) -- (1,0);}
  \myline
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    const path = elementsOfKind(result.scene.elements, "Path")[0];
    expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to).trim()).toBe(String.raw`\myline`);
    expect(path.origin?.macroStack?.[0]?.macroName).toBe(String.raw`\myline`);
  });

  it("keeps macro-inside-foreach generated identities while source refs fall back to original loop source", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\myline}[1]{\draw[red] (#1,0) -- ++(1,0);}
  \foreach \x in {0,1} { \myline{\x} }
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    for (const path of elementsOfKind(result.scene.elements, "Path")) {
      expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toContain(String.raw`\foreach`);
      expect(path.identityRef?.sourceId.startsWith("path:")).toBe(true);
    }
  });

  it("keeps foreach-inside-macro source refs on the macro invocation", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\twolines}{\foreach \x in {0,1} \draw[red] (\x,0) -- ++(1,0);}
  \twolines
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    const paths = elementsOfKind(result.scene.elements, "Path");
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to).trim()).toBe(String.raw`\twolines`);
      expect(path.identityRef?.sourceId.startsWith("path:")).toBe(true);
    }
  });

  it("composes path foreach item maps through macro-expanded path statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\mypath}{\draw (0,0) foreach \x in {1,2} { -- (\x,0) };}
  \mypath
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const generatedHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(generatedHandles.length).toBeGreaterThan(0);
    for (const handle of generatedHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to).trim()).toBe(String.raw`\mypath`);
    }
  });

  it("keeps global attribution invariants across a generated-source mini corpus", () => {
    const sources = [
      String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} \draw[red] (\x,0) -- ++(1,0);
\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (\x,0) };
\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node foreach \p in {0.25,0.75} [pos=\p,fill=red] {\p};
\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}
  \newcommand{\twolines}{\foreach \x in {0,1} \draw[blue] (\x,0) -- ++(1,0);}
  \twolines
\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}
  \newcommand{\mypath}{\draw (0,0) foreach \x in {1,2} { -- (\x,0) };}
  \mypath
\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}
  \def\seg{-- (1,0)}
  \draw (0,0) foreach \x in {1,2} { \seg };
\end{tikzpicture}`
    ];

    for (const source of sources) {
      const result = evaluateSemantic(source);
      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      assertOriginalSourceRefInvariants(source, result);
      expect(generatedElements(result).length + generatedHandles(result).length).toBeGreaterThan(0);
      const handles = generatedHandles(result);
      expect(new Set(handles.map((handle) => handle.runtimeId)).size).toBe(handles.length);
    }
  });

  it("preserves style provenance identity for generated statement, macro, and node foreach content", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{marked/.style={draw=green,fill=yellow}}
  \foreach \x in {0,1} \node[marked] at (\x,0) {\x};
  \newcommand{\myline}{\draw[marked] (0,1) -- (1,1);}
  \myline
  \path (0,2) node foreach \p in {0.25,0.75} [pos=\p,marked] {\p};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const generated = generatedElements(result).filter((element) => element.styleChain.length > 0);
    expect(generated.length).toBeGreaterThan(0);
    for (const element of generated) {
      const remappedEntries = element.styleChain.filter((entry) => entry.sourceRef?.sourceSpan && entry.sourceRef.identityRef);
      expect(remappedEntries.length).toBeGreaterThan(0);
      for (const entry of remappedEntries) {
        expect(entry.sourceRef?.identityRef?.sourceId).toBeTruthy();
        const span = entry.sourceRef?.sourceSpan;
        expect(span ? source.slice(span.from, span.to).length : 0).toBeGreaterThan(0);
      }
    }
  });

  it("rejects direct edits to repeated generated handles that share an original template span", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (\x,0) };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const handles = generatedHandles(result).filter((handle) => handle.sourceText === String.raw`(\x,0)`);

    expect(handles).toHaveLength(2);
    expect(handles[0]?.sourceRef.sourceSpan).toEqual(handles[1]?.sourceRef.sourceSpan);
    const target = handles[0];
    if (!target) {
      return;
    }

    const edit = applyEditAction(source, result.editHandles, {
      kind: "moveHandle",
      handleId: target.id,
      newWorld: wp(target.world.x + 10, target.world.y + 10)
    });
    expect(edit.kind).toBe("unsupported");
    if (edit.kind === "unsupported") {
      expect(edit.reason).toContain("shared source span");
    }
  });

  it("maps diagnostics from generated content back to original source slices", () => {
    const cases = [
      {
        source: String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} \draw[definitely unsupported key] (\x,0) -- ++(1,0);
\end{tikzpicture}`,
        codePrefix: "unsupported-option-flag:definitely unsupported key",
        slice: String.raw`\draw[definitely unsupported key] (\x,0) -- ++(1,0);`
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (bad\x) };
\end{tikzpicture}`,
        codePrefix: "unknown-named-coordinate:",
        slice: String.raw`(bad\x)`
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { foreach \y in {0,1} { -- (bad\x\y) } };
\end{tikzpicture}`,
        codePrefix: "unknown-named-coordinate:",
        slice: String.raw`(bad\x\y)`
      },
      {
        source: String.raw`\begin{tikzpicture}
  \def\seg{-- (bad)}
  \draw (0,0) foreach \x in {1,2} { \seg };
\end{tikzpicture}`,
        codePrefix: "unknown-named-coordinate:",
        slice: String.raw`foreach \x in {1,2} { \seg }`
      },
      {
        source: String.raw`\begin{tikzpicture}
  \newcommand{\badforeach}{\foreach \x in {0,1} \draw[definitely unsupported key] (\x,0) -- ++(1,0);}
  \badforeach
\end{tikzpicture}`,
        codePrefix: "unsupported-option-flag:definitely unsupported key",
        slice: String.raw`\badforeach`
      }
    ];

    for (const testCase of cases) {
      const result = evaluateSemantic(testCase.source);
      const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code?.startsWith(testCase.codePrefix));
      expect(diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of diagnostics) {
        expect(testCase.source.slice(diagnostic.span.from, diagnostic.span.to).trim()).toBe(testCase.slice);
      }
    }
  });
});
