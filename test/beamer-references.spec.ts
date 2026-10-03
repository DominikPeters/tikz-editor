import { describe, expect, it } from "vitest";
import { prepareBeamerDocument, renderBeamerFrame } from "../packages/core/src/beamer/render.js";

const deck = (frames: string, preamble = "") => String.raw`\documentclass{beamer}
${preamble}
\begin{document}${frames}\end{document}`;
const frame = (body: string, options = "") => String.raw`\begin{frame}${options}${body}\end{frame}`;
const links = (result: Awaited<ReturnType<typeof renderBeamerFrame>>) => result.layout.paragraphs.flatMap((p) => p.links ?? []);
const text = (result: Awaited<ReturnType<typeof renderBeamerFrame>>) => result.layout.paragraphs.flatMap((p) => p.report.lines.map((line) => line.segments.map((s) => s.text ?? "").join(""))).join("\n");

describe("Beamer hyperlinks and manual bibliographies", () => {
  it("resolves forward equation references and preserves numbers across frame renders", async () => {
    const source = deck(frame(String.raw`Forward \eqref{second}.\begin{equation}\label{first}a=b\end{equation}`) +
      frame(String.raw`\begin{equation}\label{second}c=d\end{equation}References \ref{first}, \eqref{second}.`), String.raw`\usepackage{amsmath}`);
    const prepared = prepareBeamerDocument(source);
    const first = await prepared.renderFrame({ frameIndex: 0 });
    const second = await prepared.renderFrame({ frameIndex: 1 });
    expect(text(first)).toContain("Forward (2).");
    expect(text(second)).toContain("References 1, (2).");
    expect(first.svg.svg).toContain('data-tex-glyph="49"');
    expect(second.svg.svg).toContain('data-tex-glyph="50"');
    expect(links(first).some(link => link.destination.kind === "frame" && link.destination.frameId === "frame:1")).toBe(true);
    expect([...first.diagnostics, ...second.diagnostics]).toEqual([]);
  });

  it("resolves explicit equation-star tags and reports unresolved numeric references", async () => {
    const source = deck(frame(String.raw`\begin{equation*}\label{custom}a=b\tag{A}\end{equation*}See \eqref{custom}; \ref{missing}.`), String.raw`\usepackage{amsmath}`);
    const result = await renderBeamerFrame(source);
    expect(text(result)).toContain("See (A); ??.");
    expect(result.diagnostics.filter(d => d.code === "beamer-unresolved-reference")).toHaveLength(1);
    expect(result.layout.items.some(item => item.kind === "unsupported")).toBe(false);
  });

  it("resolves forward frame labels, explicit labels and overlay destinations", async () => {
    const source = deck(frame(String.raw`\hyperlink{later<2>}{Go} \hyperref[named]{Named} \hyperlink{target}{Target}`) +
      frame(String.raw`\label<2>{named}\hypertarget<3>{target}{Third}`, "[label=later]"));
    const prepared = prepareBeamerDocument(source);
    expect(prepared.frameStepCount(1)).toBe(3);
    const result = await prepared.renderFrame();
    expect(links(result).map((link) => link.destination)).toEqual([
      { kind: "frame", frameId: "frame:1", step: 2 },
      { kind: "frame", frameId: "frame:1", step: 2 },
      { kind: "frame", frameId: "frame:1", step: 3 },
    ]);
    expect(text(await prepared.renderFrame({ frameIndex: 1, step: 3 }))).toContain("Third");
    expect(text(await prepared.renderFrame({ frameIndex: 1, step: 2 }))).not.toContain("Third");
  });

  it("resolves numeric/custom citations, multiple keys and a citation note", async () => {
    const source = deck(frame(String.raw`See \cite[p. 12]{first,custom,last}.`) + frame(String.raw`
\begin{thebibliography}{99}
\bibitem{first} First author. \newblock First title.
\bibitem[AB26]{custom} Custom author.
\bibitem{last} Last author.
\end{thebibliography}`), String.raw`\setbeamertemplate{bibliography item}[text]`);
    const result = await renderBeamerFrame(source);
    expect(text(result)).toContain("See [1, AB26, 2, p. 12].");
    expect(links(result).map((link) => link.label)).toEqual(["Citation first", "Citation custom", "Citation last"]);
    expect(links(result).every((link) => link.destination.kind === "frame" && link.destination.frameId === "frame:1")).toBe(true);
    const references = await renderBeamerFrame(source, { frameIndex: 1 });
    expect(references.layout.items.some((item) => item.kind === "unsupported")).toBe(false);
    expect(text(references)).toContain("First title.");
    expect(text(references)).toContain("[AB26]");
    expect(references.layout.paragraphs.every((p) => !p.listStructure)).toBe(true);
  });

  it("does not create placeholders for invisible reference-only content", async () => {
    for (const body of [String.raw`\label{empty}`, String.raw`\hypertarget{empty}{}`, String.raw`\hypertarget<2>{later}{Later}`]) {
      const result = await renderBeamerFrame(deck(frame(body)));
      expect(result.layout.items.some((item) => item.kind === "unsupported")).toBe(false);
      expect(links(result)).toHaveLength(0);
    }
  });

  it("retains link text source coordinates, formatting, and line wrapping", async () => {
    const body = String.raw`Prefix \hyperlink{there}{\textbf{A long linked phrase with enough words to wrap within this narrow column several times}} suffix.`;
    const source = deck(frame(String.raw`\begin{columns}\begin{column}{.3\textwidth}${body}\end{column}\end{columns}`) + frame("Destination", "[label=there]"));
    const result = await renderBeamerFrame(source);
    const regions = links(result);
    expect(new Set(regions.map((link) => link.bounds.y)).size).toBeGreaterThan(1);
    expect(result.svg.svg).not.toContain('data-tex-literal="unsupported-command"');
    const paragraph = result.layout.paragraphs.find((p) => p.links?.length)!;
    const linkedText = paragraph.report.lines.flatMap((line) => line.segments).find((segment) => segment.text === "linked")!;
    expect(source.slice(linkedText.sourceStartRaw, linkedText.sourceEndRaw)).toBe("linked");
    const prefix = paragraph.report.lines.flatMap((line) => line.segments).find((segment) => segment.text === "Prefix")!;
    expect(regions[0].bounds.x).toBeGreaterThanOrEqual(prefix.x + prefix.width);
  });

  it("does not expose covered links and removes inactive overlay-qualified hyperlink text", async () => {
    const source = deck(frame(String.raw`\uncover<2>{\hyperlink{there}{Covered}} \hyperlink<2>{there}{Second step}`) + frame("Destination", "[label=there]"));
    const first = await renderBeamerFrame(source);
    expect(links(first)).toHaveLength(0);
    expect(text(first)).not.toContain("Second step");
    const second = await renderBeamerFrame(source, { step: 2 });
    expect(text(second)).toContain("Second step");
    expect(links(second).length).toBeGreaterThan(0);
  });

  it("resolves sparse destinations without enumerating their overlay steps", async () => {
    const source = deck(frame(String.raw`\hyperlink{later<1000000000>}{Frame} \hyperlink{named}{Named} \cite{entry}`) +
      frame(String.raw`\label<1000000000>{named}
\begin{thebibliography}{9}\bibitem<1000000000->{entry} Entry.\end{thebibliography}`, "[label=later]"));
    const prepared = prepareBeamerDocument(source);
    expect(prepared.frameStepCount(1)).toBe(1000000000);
    const result = await prepared.renderFrame();
    expect(links(result).map((link) => link.destination)).toEqual(Array.from({ length: 3 }, () =>
      ({ kind: "frame", frameId: "frame:1", step: 1000000000 })));
  });

  it("finds targets at interval ends and inside overlay-qualified reference bodies", async () => {
    const source = deck(frame(String.raw`\hyperlink{after}{After} \hyperlink{nested}{Nested}`) +
      frame(String.raw`\alt<1-4>{Before}{\hypertarget{after}{After}}
\hypertarget<3-5>{outer}{\hyperlink<4->{after}{\hypertarget{nested}{Nested}}}`));
    const result = await renderBeamerFrame(source);
    expect(links(result).map((link) => link.destination)).toEqual([
      { kind: "frame", frameId: "frame:1", step: 5 },
      { kind: "frame", frameId: "frame:1", step: 4 },
    ]);
  });

  it("keeps the earliest destination when frame aliases collide with authored targets", async () => {
    const source = deck(frame(String.raw`\hyperlink{later<2>}{First} \hyperlink{later<3>}{Third} \hyperlink{later<4>}{Last}`) +
      frame(String.raw`\hypertarget{later<2>}{Authored}`) +
      frame(String.raw`\only<3>{Three}`, "[label=later]") +
      frame(String.raw`\hypertarget{later<3>}{Duplicate}\only<4>{Four}`, "[label=later]"));
    const result = await renderBeamerFrame(source);
    expect(links(result).map((link) => link.destination)).toEqual([
      { kind: "frame", frameId: "frame:1", step: 1 },
      { kind: "frame", frameId: "frame:2", step: 3 },
      { kind: "frame", frameId: "frame:3", step: 4 },
    ]);
    expect(result.diagnostics.some((entry) => entry.code === "beamer-duplicate-target")).toBe(true);
  });

  it("retains ordinary list editing topology alongside a bibliography", async () => {
    const source = deck(frame(String.raw`\begin{itemize}\item Editable item\end{itemize}
\begin{thebibliography}{9}\bibitem{entry} Reference.\end{thebibliography}`));
    const result = await renderBeamerFrame(source);
    const lists = result.layout.paragraphs.flatMap((paragraph) => paragraph.listStructure ?? []);
    expect(lists.map((list) => list.environment)).toEqual(["itemize"]);
    expect(source.slice(lists[0].items[0].commandSpan.from, lists[0].items[0].commandSpan.to).trim()).toBe(String.raw`\item`);
  });

  it("uses the first visible overlay for bibliography item destinations", async () => {
    const source = deck(frame(String.raw`\cite{later}`) + frame(String.raw`\begin{thebibliography}{9}\bibitem<2->{later} Later entry.\end{thebibliography}`));
    expect(links(await renderBeamerFrame(source))[0].destination).toEqual({ kind: "frame", frameId: "frame:1", step: 2 });
    expect(prepareBeamerDocument(source).frameStepCount(1)).toBe(2);
  });

  it("keeps unresolved links readable and emits missing/duplicate reference diagnostics", async () => {
    const source = deck(frame(String.raw`\hyperlink{missing}{Readable} \cite{absent}`) + frame("One", "[label=duplicate]") + frame("Two", "[label=duplicate]"));
    const result = await renderBeamerFrame(source);
    expect(text(result)).toContain("Readable [?]");
    expect(links(result)).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(["beamer-unresolved-link", "beamer-unresolved-citation", "beamer-duplicate-target"]));
  });

  it("renders external links and URLs while refusing executable URL schemes", async () => {
    const source = deck(frame(String.raw`\href{https://example.com}{Example} \url{https://example.com/a_b?x=1&y=2} \href{javascript:alert(1)}{Unsafe}`));
    const result = await renderBeamerFrame(source);
    expect(links(result).map((link) => link.destination)).toEqual(expect.arrayContaining([
      { kind: "external", url: "https://example.com" },
      { kind: "external", url: "https://example.com/a_b?x=1&y=2" },
    ]));
    expect(links(result).some((link) => link.destination.kind === "external" && link.destination.url.startsWith("javascript:"))).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "beamer-unsupported-link-url")).toBe(true);
  });

  it("does not share reference state between prepared documents or retain old targets after edits", async () => {
    const source = deck(frame(String.raw`\cite{key}`) + frame(String.raw`\begin{thebibliography}{9}\bibitem[OLD]{key} Entry.\end{thebibliography}`));
    const old = prepareBeamerDocument(source);
    const fresh = prepareBeamerDocument(source.replace("OLD", "NEW"));
    const results = await Promise.all([old.renderFrame(), fresh.renderFrame(), old.renderFrame()]);
    expect(results.map(text)).toEqual(["[OLD]", "[NEW]", "[OLD]"]);
  });

  it("ignores comments and verbatim targets and lowers hyperlinks produced by text macros", async () => {
    const source = deck(frame(String.raw`% \label{fake}
\go{Destination}
\begin{verbatim}\label{alsofake}\end{verbatim}`) + frame("There", "[label=there]"), String.raw`\newcommand{\go}[1]{\hyperlink{there}{#1}}`);
    const result = await renderBeamerFrame(source);
    expect(links(result)[0].destination).toEqual({ kind: "frame", frameId: "frame:1", step: 1 });
  });
});
