import { describe, expect, it } from "vitest";
import type { SyntaxNode } from "@lezer/common";

import {
  mapBodyStatements,
  mapStatementNode,
  unwrapStatementLikeNode,
  type StatementMappingState
} from "../packages/core/src/domains/statements/parse.js";

type TestNode = SyntaxNode & {
  firstChild: TestNode | null;
  nextSibling: TestNode | null;
};

function testNode(
  name: string,
  from: number,
  to: number,
  children: TestNode[] = [],
  isAnonymous = false
): TestNode {
  const node = {
    type: { name, isAnonymous },
    from,
    to,
    firstChild: children[0] ?? null,
    nextSibling: null
  } as TestNode;
  for (let index = 0; index < children.length - 1; index += 1) {
    children[index].nextSibling = children[index + 1];
  }
  return node;
}

function mapNode(node: SyntaxNode, source = "\\tikzset{}"): ReturnType<typeof mapStatementNode> {
  const state: StatementMappingState = { nextStatementIndex: 0 };
  return mapStatementNode(node, source, state);
}

describe("domains statement parser mapping", () => {
  it("unwraps statement-like wrappers and ignores unsupported body children", () => {
    const bareStatement = testNode("Statement", 0, 1);
    expect(unwrapStatementLikeNode(bareStatement)).toBe(bareStatement);

    const path = testNode("PathStatement", 2, 3);
    const wrappedStatement = testNode("Statement", 2, 3, [path]);
    expect(unwrapStatementLikeNode(wrappedStatement)).toBe(path);

    const bodyItem = testNode("BodyItem", 2, 3, [wrappedStatement]);
    expect(unwrapStatementLikeNode(bodyItem)).toBe(path);

    const anonymous = testNode("Punctuation", 4, 5, [], true);
    const unsupported = testNode("UnsupportedStatement", 5, 6);
    const body = testNode("Body", 0, 6, [anonymous, unsupported]);
    expect(mapBodyStatements(body, "abcdef", { nextStatementIndex: 0 })).toEqual([]);
  });

  it("maps malformed style statements to empty option lists instead of throwing", () => {
    const tikzSet = mapNode(testNode("TikzSetStatement", 0, 8), "\\tikzset");
    expect(tikzSet).toMatchObject({
      kind: "TikzSet",
      payloadRaw: ""
    });
    expect(tikzSet).not.toHaveProperty("payloadSpan");
    expect(tikzSet?.kind === "TikzSet" ? tikzSet.optionList.entries : []).toEqual([]);

    const pgfkeys = mapNode(testNode("PgfkeysStatement", 0, 8), "\\pgfkeys");
    expect(pgfkeys).toMatchObject({
      kind: "Pgfkeys",
      payloadRaw: ""
    });
    expect(pgfkeys).not.toHaveProperty("payloadSpan");

    const tikzStyle = mapNode(testNode("TikzStyleStatement", 0, 10), "\\tikzstyle");
    expect(tikzStyle).toMatchObject({
      kind: "TikzStyle",
      styleNameRaw: "",
      definitionKind: "style",
      payloadRaw: ""
    });
    expect(tikzStyle).not.toHaveProperty("styleNameSpan");
    expect(tikzStyle).not.toHaveProperty("payloadSpan");

    const wrapperWithoutChild = mapNode(testNode("StyleDefinitionStatement", 0, 10), "\\tikzstyle");
    expect(wrapperWithoutChild).toBeNull();
  });

  it("maps malformed color and macro statements with absent spans and empty values", () => {
    const colorlet = mapNode(testNode("ColorletStatement", 0, 9), "\\colorlet");
    expect(colorlet).toMatchObject({
      kind: "Colorlet",
      nameRaw: "",
      valueRaw: ""
    });
    expect(colorlet).not.toHaveProperty("nameSpan");
    expect(colorlet).not.toHaveProperty("valueSpan");

    const defineColor = mapNode(testNode("DefineColorStatement", 0, 12), "\\definecolor");
    expect(defineColor).toMatchObject({
      kind: "DefineColor",
      nameRaw: "",
      modelRaw: "",
      specificationRaw: ""
    });
    expect(defineColor).not.toHaveProperty("nameSpan");
    expect(defineColor).not.toHaveProperty("modelSpan");
    expect(defineColor).not.toHaveProperty("specificationSpan");

    const macroDefinition = mapNode(testNode("MacroDefinitionStatement", 0, 4), "\\def");
    expect(macroDefinition).toMatchObject({
      kind: "MacroDefinition",
      nameRaw: "",
      valueRaw: ""
    });
    expect(macroDefinition).not.toHaveProperty("nameSpan");
    expect(macroDefinition).not.toHaveProperty("valueSpan");
  });

  it("maps macro aliases with command, grouped, and missing targets", () => {
    const source = String.raw`\let\a=\b \let\c={grouped} \let\d=`;
    const commandAlias = mapNode(
      testNode("MacroAliasStatement", 0, 9, [
        testNode("CommandName", 4, 6),
        testNode("LetAliasTarget", 7, 9, [testNode("CommandName", 7, 9)])
      ]),
      source
    );
    expect(commandAlias).toMatchObject({
      kind: "MacroAlias",
      nameRaw: "\\a",
      targetRaw: "\\b",
      targetSpan: { from: 7, to: 9 }
    });

    const groupAlias = mapNode(
      testNode("MacroAliasStatement", 10, 27, [
        testNode("CommandName", 14, 16),
        testNode("LetAliasTarget", 17, 26, [testNode("Group", 17, 26)])
      ]),
      source
    );
    expect(groupAlias).toMatchObject({
      kind: "MacroAlias",
      nameRaw: "\\c",
      targetRaw: "grouped",
      targetSpan: { from: 18, to: 25 }
    });

    const missingTarget = mapNode(
      testNode("MacroAliasStatement", 27, 34, [testNode("CommandName", 31, 33)]),
      source
    );
    expect(missingTarget).toMatchObject({
      kind: "MacroAlias",
      nameRaw: "\\d",
      targetRaw: ""
    });
    expect(missingTarget).not.toHaveProperty("targetSpan");
  });

  it("maps incomplete macro command definitions without throwing", () => {
    const source = String.raw`\newcommand{{notACommand}}[bad][default]`;
    const groupedName = testNode("MacroCommandName", 11, 26, [testNode("Group", 11, 26)]);
    const malformedArity = testNode("MacroCommandArity", 26, 31, [testNode("Number", 27, 30)]);
    const defaultArg = testNode("MacroCommandDefaultArg", 31, 40);
    const statement = mapNode(
      testNode("MacroCommandDefinitionStatement", 0, 40, [
        testNode("NewCommandCmd", 0, 11),
        groupedName,
        malformedArity,
        defaultArg
      ]),
      source
    );

    expect(statement).toMatchObject({
      kind: "MacroCommandDefinition",
      commandRaw: "\\newcommand",
      nameRaw: "",
      arity: 0,
      optionalDefaultRaw: "default",
      optionalDefaultSpan: { from: 32, to: 39 },
      bodyRaw: "",
      starred: false
    });
    expect(statement).not.toHaveProperty("nameSpan");
    expect(statement).not.toHaveProperty("bodySpan");
  });

  it("returns null for unsupported statement node types", () => {
    expect(mapNode(testNode("DefinitelyUnsupportedStatement", 0, 1), "x")).toBeNull();
  });
});
