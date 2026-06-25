import type {
  TexAlignmentProfile,
  TexParagraphAlignment,
} from "../ir.js";
import type {
  TexVBoxItem,
  TexVBoxListItemLayout,
} from "./types.js";

export interface TexParagraphScopePolicy {
  readonly fallbackAlignment?: TexParagraphAlignment;
  readonly preserveRaggedRight?: boolean;
  readonly raggedRightProfile?: TexAlignmentProfile;
  readonly resetInheritedAlignment: boolean;
  readonly resetSpaceGlueProfile: boolean;
}

export interface TexParagraphScopeLayout {
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly scopedLineWidth?: number;
  readonly scopedLeftMarginWidth?: number;
  readonly scopedRightMarginWidth?: number;
}

export interface TexParagraphScopeContext {
  readonly policy: TexParagraphScopePolicy;
  readonly layout: TexParagraphScopeLayout;
  readonly quoteContextActive: boolean;
  readonly listContextActive: boolean;
  readonly listItemLayout?: TexVBoxListItemLayout;
}

export function texParagraphScopeContext(
  ancestors: readonly TexVBoxItem[]
): TexParagraphScopeContext {
  return {
    policy: texParagraphScopePolicy(ancestors),
    layout: texParagraphScopeLayout(ancestors),
    quoteContextActive: ancestors.some((ancestor) => ancestor.role?.kind === "quote"),
    listContextActive: ancestors.some((ancestor) =>
      ancestor.role?.kind === "list" || ancestor.role?.kind === "list-item"
    ),
    listItemLayout: ancestors.at(-1)?.layout?.listItem,
  };
}

export function texScopeParagraphAlignment(
  policy: TexParagraphScopePolicy,
  alignment: TexParagraphAlignment
): TexParagraphAlignment {
  if (!policy.fallbackAlignment) {
    return alignment;
  }
  if (policy.preserveRaggedRight && alignment === "ragged-right") {
    return "ragged-right";
  }
  return policy.fallbackAlignment;
}

export function texScopeParagraphAlignmentProfile(
  policy: TexParagraphScopePolicy,
  alignment: TexParagraphAlignment,
  alignmentProfile: TexAlignmentProfile | undefined
): TexAlignmentProfile | undefined {
  if (!policy.fallbackAlignment) {
    return alignmentProfile;
  }
  if (policy.preserveRaggedRight && alignment === "ragged-right") {
    return policy.raggedRightProfile;
  }
  return undefined;
}

function texParagraphScopePolicy(
  ancestors: readonly TexVBoxItem[]
): TexParagraphScopePolicy {
  const policy: {
    fallbackAlignment?: TexParagraphAlignment;
    preserveRaggedRight?: boolean;
    raggedRightProfile?: TexAlignmentProfile;
    resetInheritedAlignment: boolean;
    resetSpaceGlueProfile: boolean;
  } = {
    resetInheritedAlignment: false,
    resetSpaceGlueProfile: false,
  };
  for (const ancestor of ancestors) {
    const paragraphPolicy = ancestor.layout?.paragraphPolicy;
    if (!paragraphPolicy) {
      continue;
    }
    if (paragraphPolicy.fallbackAlignment) {
      policy.fallbackAlignment = paragraphPolicy.fallbackAlignment;
    }
    if (paragraphPolicy.preserveRaggedRight !== undefined) {
      policy.preserveRaggedRight = paragraphPolicy.preserveRaggedRight;
    }
    if (paragraphPolicy.raggedRightProfile !== undefined) {
      policy.raggedRightProfile = paragraphPolicy.raggedRightProfile;
    }
    policy.resetInheritedAlignment ||= paragraphPolicy.resetInheritedAlignment === true;
    policy.resetSpaceGlueProfile ||= paragraphPolicy.resetSpaceGlueProfile === true;
  }
  return policy;
}

function texParagraphScopeLayout(
  ancestors: readonly TexVBoxItem[]
): TexParagraphScopeLayout {
  let leftMarginWidth = 0;
  let rightMarginWidth = 0;
  let scopedWidth: number | undefined;
  let scopedLeftMarginWidth = 0;
  let scopedRightMarginWidth = 0;
  for (const ancestor of ancestors) {
    const left = ancestor.layout?.leftMarginWidth ?? 0;
    const right = ancestor.layout?.rightMarginWidth ?? 0;
    leftMarginWidth += left;
    rightMarginWidth += right;
    const width = finiteTexScopeWidth(ancestor.width);
    if (width !== undefined) {
      scopedWidth = width;
      scopedLeftMarginWidth = left;
      scopedRightMarginWidth = right;
      continue;
    }
    if (scopedWidth !== undefined) {
      scopedLeftMarginWidth += left;
      scopedRightMarginWidth += right;
    }
  }
  const scopedLineWidth = scopedWidth === undefined
    ? undefined
    : Math.max(0, scopedWidth - scopedLeftMarginWidth - scopedRightMarginWidth);
  return {
    leftMarginWidth,
    rightMarginWidth,
    ...(scopedLineWidth !== undefined
      ? {
          scopedLineWidth,
          scopedLeftMarginWidth,
          scopedRightMarginWidth,
        }
      : {}),
  };
}

function finiteTexScopeWidth(value: TexVBoxItem["width"]): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
