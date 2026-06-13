import type {
  TexParagraphInput,
  TexSourceSpan,
  TexVBoxItem,
  TexVBoxRole,
  TexVListDocument,
  TexVListItem,
} from "./types.js";

interface ScopeFrame {
  readonly key: string;
  readonly role: TexVBoxRole;
  readonly items: TexVListItem[];
  sourceSpan?: TexSourceSpan;
}

export function groupSimpleTexVListScopes(vlist: TexVListDocument): TexVListDocument {
  const rootItems: TexVListItem[] = [];
  const stack: ScopeFrame[] = [];

  for (let index = 0; index < vlist.items.length; index += 1) {
    const item = vlist.items[index];
    if (!item) {
      continue;
    }
    const path = scopePathForItem(item, vlist.items[index + 1]);
    const commonPrefixLength = commonScopePrefixLength(stack, path);
    stack.length = commonPrefixLength;

    for (let pathIndex = commonPrefixLength; pathIndex < path.length; pathIndex += 1) {
      const scope = path[pathIndex];
      if (!scope) {
        continue;
      }
      const frame: ScopeFrame = {
        key: scope.key,
        role: scope.role,
        items: [],
      };
      appendItem(stack, rootItems, mutableFrameToVBox(frame));
      stack.push(frame);
    }

    appendItem(stack, rootItems, item);
  }

  return {
    ...vlist,
    items: rootItems,
  };
}

function scopePathForItem(
  item: TexVListItem,
  nextItem: TexVListItem | undefined
): readonly { readonly key: string; readonly role: TexVBoxRole }[] {
  if (item.kind === "paragraph") {
    return scopePathForParagraph(item.paragraph);
  }
  if (
    (item.kind === "glue" || item.kind === "penalty" || item.kind === "rule" || item.kind === "placeholder") &&
    item.scopePath
  ) {
    return item.scopePath.map((role) => ({
      key: keyForScopeRole(role),
      role,
    }));
  }
  if (item.kind === "glue" && nextItem?.kind === "paragraph") {
    return scopePathForParagraph(nextItem.paragraph);
  }
  return [];
}

function keyForScopeRole(role: TexVBoxRole): string {
  if (role.kind === "quote") {
    return `quote:${role.depth}`;
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

function scopePathForParagraph(
  paragraph: TexParagraphInput
): readonly { readonly key: string; readonly role: TexVBoxRole }[] {
  const scopes: Array<{ readonly key: string; readonly role: TexVBoxRole }> = [];
  for (let depth = 1; depth <= paragraph.quoteDepth; depth += 1) {
    scopes.push({
      key: `quote:${depth}`,
      role: { kind: "quote", depth },
    });
  }
  const listContext = paragraph.listContext;
  if (listContext) {
    scopes.push({
      key: [
        "list",
        listContext.kind,
        listContext.depth,
        listContext.labelDepth,
        listContext.ownLeftMarginEm,
        listContext.totalLeftMarginEm,
      ].join(":"),
      role: {
        kind: "list",
        listKind: listContext.kind,
        depth: listContext.depth,
        labelDepth: listContext.labelDepth,
        ownLeftMarginEm: listContext.ownLeftMarginEm,
        totalLeftMarginEm: listContext.totalLeftMarginEm,
      },
    });
  }
  return scopes;
}

function commonScopePrefixLength(
  stack: readonly ScopeFrame[],
  path: readonly { readonly key: string }[]
): number {
  const max = Math.min(stack.length, path.length);
  for (let index = 0; index < max; index += 1) {
    if (stack[index]?.key !== path[index]?.key) {
      return index;
    }
  }
  return max;
}

function appendItem(
  stack: readonly ScopeFrame[],
  rootItems: TexVListItem[],
  item: TexVListItem
): void {
  const parent = stack.at(-1);
  if (parent) {
    parent.items.push(item);
    for (const frame of stack) {
      frame.sourceSpan = mergeSourceSpans(frame.sourceSpan, item.sourceSpan);
    }
    return;
  }
  rootItems.push(item);
}

function mutableFrameToVBox(frame: ScopeFrame): TexVBoxItem {
  return {
    kind: "vbox",
    get sourceSpan() {
      return frame.sourceSpan;
    },
    role: frame.role,
    items: frame.items,
  };
}

function mergeSourceSpans(
  current: TexSourceSpan | undefined,
  next: TexSourceSpan | undefined
): TexSourceSpan | undefined {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return {
    start: Math.min(current.start, next.start),
    end: Math.max(current.end, next.end),
  };
}
