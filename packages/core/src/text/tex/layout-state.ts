import type {
  SimpleTexParagraphBlock,
  TexAlignmentProfile,
  TexParagraphAlignment,
  TexSpaceGlueProfile,
} from "./ir.js";
import type { TexLayoutIrOptions } from "./layout-options.js";
import {
  texScopeParagraphAlignment,
  texScopeParagraphAlignmentProfile,
  type TexParagraphScopePolicy,
} from "./vlist/paragraph-scope.js";

export interface TexParagraphLayoutStateResult {
  readonly inheritedAlignment: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: TexAlignmentProfile;
  readonly alignment: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
}

export class TexParagraphLayoutState {
  private activeAlignment: TexParagraphAlignment;
  private activeAlignmentProfile: TexAlignmentProfile | undefined;
  private activeSpaceGlueProfile: TexSpaceGlueProfile;

  public constructor(
    private readonly defaultAlignment: TexParagraphAlignment,
    private readonly options: TexLayoutIrOptions
  ) {
    this.activeAlignment = defaultAlignment;
    this.activeSpaceGlueProfile =
      options.spaceGlueProfile ?? texInitialSpaceGlueProfile(defaultAlignment);
  }

  public resolveParagraph(params: {
    readonly paragraph: Pick<SimpleTexParagraphBlock, "alignment" | "alignmentProfile">;
    readonly scopePolicy: TexParagraphScopePolicy;
    readonly finalParagraphInNode: boolean;
  }): TexParagraphLayoutStateResult {
    const inheritedAlignment = params.scopePolicy.resetInheritedAlignment
      ? this.defaultAlignment
      : this.activeAlignment;
    const inheritedAlignmentProfile = params.scopePolicy.resetInheritedAlignment
      ? undefined
      : this.activeAlignmentProfile;
    const blockAlignment = texHonoredBlockAlignment(
      params.paragraph,
      this.options,
      params.finalParagraphInNode
    );
    const blockAlignmentProfile = blockAlignment
      ? params.paragraph.alignmentProfile
      : undefined;
    const alignment = blockAlignment ?? this.activeAlignment;
    const alignmentProfile = blockAlignment
      ? blockAlignmentProfile
      : this.activeAlignmentProfile;

    if (blockAlignment) {
      this.activeAlignment = blockAlignment;
      this.activeAlignmentProfile = blockAlignmentProfile;
      if (
        blockAlignmentProfile === "latex-declaration" &&
        this.options.tikzTextWidthNode === true
      ) {
        this.activeSpaceGlueProfile = "tikz-fixed";
      }
    }

    return {
      inheritedAlignment,
      ...(inheritedAlignmentProfile ? { inheritedAlignmentProfile } : {}),
      alignment: texScopeParagraphAlignment(params.scopePolicy, alignment),
      ...(texScopeParagraphAlignmentProfile(
        params.scopePolicy,
        alignment,
        alignmentProfile
      ) ? {
          alignmentProfile: texScopeParagraphAlignmentProfile(
            params.scopePolicy,
            alignment,
            alignmentProfile
          ),
        }
      : {}),
      spaceGlueProfile: params.scopePolicy.resetSpaceGlueProfile
        ? this.options.spaceGlueProfile ?? texInitialSpaceGlueProfile(this.defaultAlignment)
        : this.activeSpaceGlueProfile,
    };
  }
}

export function texInitialReportAlignment(
  block: Pick<SimpleTexParagraphBlock, "alignment" | "alignmentProfile"> | undefined,
  defaultAlignment: TexParagraphAlignment,
  options: TexLayoutIrOptions
): TexParagraphAlignment {
  return texHonoredBlockAlignment(block, options) ?? defaultAlignment;
}

function texHonoredBlockAlignment(
  block: Pick<SimpleTexParagraphBlock, "alignment" | "alignmentProfile"> | undefined,
  options: TexLayoutIrOptions,
  finalParagraphInNode = false
): TexParagraphAlignment | undefined {
  if (!block?.alignment) {
    return undefined;
  }
  if (
    options.tikzTextWidthNode === true &&
    block.alignmentProfile === "latex-declaration" &&
    finalParagraphInNode
  ) {
    return undefined;
  }
  return block.alignment;
}

function texInitialSpaceGlueProfile(
  alignment: TexParagraphAlignment
): TexSpaceGlueProfile {
  return alignment === "justified" ? "font" : "tikz-fixed";
}
