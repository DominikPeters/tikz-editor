import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { collectSymbols } from "../packages/core/src/completion/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { tikzCompletion } from "../packages/app/src/ui/source-panel/tikz-autocomplete.js";

const ghostDeclarations = String.raw`\tikzset{ghost/.style={red}} \pgfkeys{ghostKey/.style={red}} \tikzstyle{ghostLegacy}=[red] \node (ghostNode) {hidden};`;
const liveDeclarations = String.raw`\tikzset{live/.style={blue}} \pgfkeys{/tikz/liveKey/.append style={thick}} \tikzstyle{liveLegacy}=[blue] \node (liveNode) {visible};`;

function symbolsFor(source: string, rawOnly = false) {
  return collectSymbols({ parseResult: rawOnly ? { source, figure: { body: [] } } as never : parseTikz(source, { recover: true }) });
}

function expectLiveOnly(source: string, rawOnly = false) {
  const symbols = symbolsFor(source, rawOnly);
  expect(symbols.styleNames).toEqual(expect.arrayContaining(["live", "livekey", "livelegacy"]));
  expect(symbols.nodeNames).toContain("liveNode");
  expect(symbols.styleNames.filter(name => name.startsWith("ghost"))).toEqual([]);
  expect(symbols.nodeNames).not.toContain("ghostNode");
}

describe.each([false, true])("lexically live completion recovery (rawOnly=%s)", rawOnly => {
  it.each(["\n", "\r\n", "\r"])("ignores line comments ending in %j", eol => {
    expectLiveOnly(`\\begin{tikzpicture}${eol}% ${ghostDeclarations}${eol}${liveDeclarations}${eol}\\end{tikzpicture}`, rawOnly);
  });

  it.each(["", "*"])("ignores inline verb%s material", star => {
    expectLiveOnly(`\\begin{tikzpicture}\n\\verb${star}|${ghostDeclarations}|\n${liveDeclarations}\n\\end{tikzpicture}`, rawOnly);
  });

  it.each(["verbatim", "verbatim*"])("ignores %s material", name => {
    expectLiveOnly(`\\begin{tikzpicture}\n\\begin{${name}}\n${ghostDeclarations}\n\\end{${name}}\n${liveDeclarations}\n\\end{tikzpicture}`, rawOnly);
  });

  it("preserves UTF-16 offsets after emoji in inert material", () => {
    expectLiveOnly(`\\begin{tikzpicture}\n% 🙂 ${ghostDeclarations}\n\\verb|🙂 ${ghostDeclarations}|\n${liveDeclarations}\n\\end{tikzpicture}`, rawOnly);
  });

  it("keeps brace-protected closing brackets in node options", () => {
    const symbols = symbolsFor(String.raw`\node[text={]}] (liveNode) {visible};`, rawOnly);
    expect(symbols.nodeNames).toContain("liveNode");
  });

  it("keeps a real escaped percent and its following declarations", () => {
    expectLiveOnly(`\\begin{tikzpicture}\n\\% ${liveDeclarations}\n% ${ghostDeclarations}\n\\end{tikzpicture}`, rawOnly);
  });

  it("keeps declarations after an escaped newline command opens a comment", () => {
    expectLiveOnly(`\\begin{tikzpicture}\n\\\\% ${ghostDeclarations}\n${liveDeclarations}\n\\end{tikzpicture}`, rawOnly);
  });

  it("does not let braces in comments swallow later live definitions", () => {
    expectLiveOnly(String.raw`\begin{tikzpicture}
\tikzset{
 % } ghost/.style={red},
 live/.style={blue},
 % { ghostKey/.style={red},
 /tikz/liveKey/.append style={thick}
}
\tikzstyle% {ghostLegacy}
{liveLegacy}=[blue]
\node% [draw] (ghostNode)
[draw] (liveNode) {visible};
\end{tikzpicture}`, rawOnly);
  });

  it("recovers live declarations below an unfinished group", () => {
    expectLiveOnly(`\\begin{tikzpicture}\n\\pgfkeys{unfinished\n% ${ghostDeclarations}\n${liveDeclarations}\n\\end{tikzpicture}`, rawOnly);
  });
});

it("offers live styles through the actual CodeMirror completion provider", () => {
  const source = String.raw`\begin{tikzpicture}
% \tikzset{ghost/.style={red}}
\tikzset{live/.style={blue}}
\draw[gho] (0,0)--(1,0);
\end{tikzpicture}`;
  const result = tikzCompletion(new CompletionContext(EditorState.create({ doc: source }), source.indexOf("gho]") + 3, true), symbolsFor(source));
  expect(result?.options.some(option => option.label === "live")).toBe(true);
  expect(result?.options.some(option => option.label === "ghost")).toBe(false);
});

it.each([false, true])("consumes exact control words rather than declaration-looking prefixes (rawOnly=%s)", rawOnly => {
  const source = String.raw`\\tikzset{ghost/.style={red}}
\tikzsetter{ghostKey/.style={red}}
\tikzstylesheet{ghostLegacy}=[red]
\\node (ghostNode) {hidden};
${liveDeclarations}`;
  expectLiveOnly(source, rawOnly);
});

it.each(["\\verb|", "\\begin{verbatim}\n", "\\begin{verbatim*}\n"])("does not recover declarations inside an unfinished inert form %j", prefix => {
  const symbols = symbolsFor(prefix + ghostDeclarations, true);
  expect(symbols).toEqual({ nodeNames: [], styleNames: [], coordinateNames: [] });
});

it.each(["\\tikzset", "\\pgfkeys"])("retains the complete argument recovery boundary for %s", command => {
  const symbols = symbolsFor(`${command}{outer/.style={${command}{ghost/.style={red}}}}\n${liveDeclarations}`, true);
  expect(symbols.styleNames).toContain("outer");
  expect(symbols.styleNames).not.toContain("ghost");
  expect(symbols.styleNames).toContain("live");
});
