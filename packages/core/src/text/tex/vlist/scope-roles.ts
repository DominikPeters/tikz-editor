import type { ResolvedTexFont } from "../fonts/types.js";
import { articleListLeftMarginEmByDepth, type SimpleTexListKind } from "../ir.js";
import { texLength, type TexLength } from "../coordinates.js";
import type {
  TexParagraphInput,
  TexVBoxLayout,
  TexVBoxRole,
} from "./types.js";

export interface TexVBoxScope {
  readonly key: string;
  readonly role: TexVBoxRole;
}

export interface TexVBoxRoleScopeInput {
  readonly quoteDepth: number;
  readonly listScope?: TexVBoxRoleListScopeInput;
}

export interface TexVBoxRoleListScopeInput {
  readonly kind: SimpleTexListKind;
  readonly depth: number;
  readonly labelDepth: number;
  readonly itemIndex: number;
  readonly ownLeftMarginEm: number;
  readonly totalLeftMarginEm: number;
}

export function texVBoxLayoutForScopeRole(
  role: TexVBoxRole,
  font: ResolvedTexFont
): TexVBoxLayout {
  if (role.kind === "quote") {
    const ownMarginWidth = texArticleQuoteOwnMarginWidth(role.depth, font);
    return {
      leftMarginWidth: ownMarginWidth,
      rightMarginWidth: ownMarginWidth,
      paragraphPolicy: {
        fallbackAlignment: "justified",
        preserveRaggedRight: true,
        raggedRightProfile: "latex-quote",
      },
    };
  }

  if (role.kind === "list-item") {
    return {
      leftMarginWidth: texLength(0),
      rightMarginWidth: texLength(0),
    };
  }

  if (role.kind === "trivlist") {
    return {
      leftMarginWidth: texLength(0),
      rightMarginWidth: texLength(0),
      paragraphPolicy: {
        resetInheritedAlignment: true,
        resetAlignment: role.alignment,
        resetAlignmentProfile: "latex-declaration",
        allowParagraphIndent: false,
        allowForcedBreakIndent: false,
      },
    };
  }

  const leftMarginWidth = texLength(role.totalLeftMarginEm * font.atPt);
  return {
    leftMarginWidth,
    rightMarginWidth: texLength(0),
    list: {
      ownLeftMarginWidth: texLength(role.ownLeftMarginEm * font.atPt),
      labelRightEdge: texLength(role.totalLeftMarginEm * font.atPt - 0.5 * font.atPt),
      descriptionLabelSepWidth: texLength(0.5 * font.atPt),
    },
    paragraphPolicy: {
      resetInheritedAlignment: true,
      resetAlignmentSource: "latex-list",
      resetSpaceGlueProfile: true,
    },
  };
}

export function texVBoxScopePathForParagraph(
  paragraph: TexParagraphInput
): readonly TexVBoxScope[] {
  return texVBoxRolePathForParagraph(paragraph).map(texVBoxScopeForRole);
}

function texVBoxFallbackRolePathForParagraph(
  paragraph: TexParagraphInput
): readonly TexVBoxRole[] {
  return texVBoxRolePathForScope({
    quoteDepth: paragraph.quoteDepth,
    listScope: paragraph.listContext,
  });
}

export function texVBoxRolePathForScope(
  input: TexVBoxRoleScopeInput
): readonly TexVBoxRole[] {
  const roles: TexVBoxRole[] = [];
  for (let depth = 1; depth <= input.quoteDepth; depth += 1) {
    roles.push({ kind: "quote", depth });
  }
  const listScope = input.listScope;
  if (listScope) {
    roles.push({
      kind: "list",
      listKind: listScope.kind,
      depth: listScope.depth,
      labelDepth: listScope.labelDepth,
      ownLeftMarginEm: listScope.ownLeftMarginEm,
      totalLeftMarginEm: listScope.totalLeftMarginEm,
    });
    if (listScope.itemIndex > 0) {
      roles.push({
        kind: "list-item",
        listKind: listScope.kind,
        depth: listScope.depth,
        labelDepth: listScope.labelDepth,
        itemIndex: listScope.itemIndex,
      });
    }
  }
  return roles;
}

export function texVBoxScopePathForScope(
  input: TexVBoxRoleScopeInput
): readonly TexVBoxScope[] {
  return texVBoxRolePathForScope(input).map(texVBoxScopeForRole);
}

export function texVBoxRolePathForParagraph(
  paragraph: TexParagraphInput
): readonly TexVBoxRole[] {
  return paragraph.scopePath ?? texVBoxFallbackRolePathForParagraph(paragraph);
}

export function texVBoxScopeForRole(role: TexVBoxRole): TexVBoxScope {
  return {
    key: texVBoxScopeKeyForRole(role),
    role,
  };
}

export function texVBoxScopeKeyForRole(role: TexVBoxRole): string {
  if (role.kind === "quote") {
    return `quote:${role.depth}`;
  }
  if (role.kind === "trivlist") {
    return [
      "trivlist",
      role.envName,
      role.depth,
      role.alignment,
    ].join(":");
  }
  if (role.kind === "list-item") {
    return [
      "list-item",
      role.listKind,
      role.depth,
      role.labelDepth,
      role.itemIndex,
    ].join(":");
  }
  return [
    "list",
    role.listKind,
    role.depth,
    role.labelDepth,
    role.ownLeftMarginEm,
    role.totalLeftMarginEm,
  ].join(":");
}

function texArticleQuoteOwnMarginWidth(depth: number, font: ResolvedTexFont): TexLength {
  const em = articleListLeftMarginEmByDepth[
    Math.max(0, Math.min(depth - 1, articleListLeftMarginEmByDepth.length - 1))
  ] ?? 1;
  return texLength(em * font.atPt);
}
