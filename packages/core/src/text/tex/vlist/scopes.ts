import type { ResolvedTexFont } from "../fonts/types.js";
import { texListItemLayoutForParagraph } from "./list-labels.js";
import {
  texVBoxLayoutForScopeRole,
  texVBoxScopeForRole,
  texVBoxScopePathForParagraph,
  type TexVBoxScope,
} from "./scope-roles.js";
import type {
  TexSourceSpan,
  TexVBoxLayout,
  TexVBoxItem,
  TexVBoxRole,
  TexVListDocument,
  TexVListItem,
} from "./types.js";

interface ScopeFrame {
  readonly key: string;
  readonly role: TexVBoxRole;
  readonly items: TexVListItem[];
  layout: TexVBoxLayout;
  sourceSpan?: TexSourceSpan;
}

export function groupSimpleTexVListScopes(
  vlist: TexVListDocument,
  font: ResolvedTexFont
): TexVListDocument {
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
        layout: texVBoxLayoutForScopeRole(scope.role, font),
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
): readonly TexVBoxScope[] {
  if (item.kind === "paragraph") {
    return texVBoxScopePathForParagraph(item.paragraph);
  }
  if (
    (item.kind === "glue" || item.kind === "penalty" || item.kind === "rule" || item.kind === "placeholder") &&
    item.scopePath
  ) {
    return item.scopePath.map(texVBoxScopeForRole);
  }
  if (item.kind === "glue" && nextItem?.kind === "paragraph") {
    return texVBoxScopePathForParagraph(nextItem.paragraph);
  }
  return [];
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
    enrichListItemFrameFromParagraph(stack, item);
    return;
  }
  rootItems.push(item);
}

function enrichListItemFrameFromParagraph(
  stack: readonly ScopeFrame[],
  item: TexVListItem
): void {
  if (item.kind !== "paragraph" || item.paragraph.listContext?.showLabel !== true) {
    return;
  }
  const listItemFrame = stack.at(-1);
  if (listItemFrame?.role.kind !== "list-item") {
    return;
  }
  const listItem = texListItemLayoutForParagraph(stack, item.paragraph);
  if (!listItem) {
    return;
  }
  listItemFrame.layout = {
    ...listItemFrame.layout,
    listItem,
  };
}

function mutableFrameToVBox(frame: ScopeFrame): TexVBoxItem {
  return {
    kind: "vbox",
    get sourceSpan() {
      return frame.sourceSpan;
    },
    role: frame.role,
    get layout() {
      return frame.layout;
    },
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
