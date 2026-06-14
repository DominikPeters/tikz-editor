import type {
  TexAlignmentProfile,
  TexParagraphAlignment,
} from "./ir.js";
import type {
  TexVBoxItem,
  TexVBoxListItemLayout,
} from "./vlist/index.js";

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
}

export interface TexParagraphScopeContext {
  readonly policy: TexParagraphScopePolicy;
  readonly layout: TexParagraphScopeLayout;
  readonly listItemLayout?: TexVBoxListItemLayout;
}

export function texParagraphScopeContext(
  ancestors: readonly TexVBoxItem[]
): TexParagraphScopeContext {
  return {
    policy: texParagraphScopePolicy(ancestors),
    layout: texParagraphScopeLayout(ancestors),
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
  for (const ancestor of ancestors) {
    if (!ancestor.layout) {
      continue;
    }
    leftMarginWidth += ancestor.layout.leftMarginWidth;
    rightMarginWidth += ancestor.layout.rightMarginWidth;
  }
  return {
    leftMarginWidth,
    rightMarginWidth,
  };
}
