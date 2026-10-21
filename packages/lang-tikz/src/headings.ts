import { syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

const HEADING_COMMANDS = new Set([
  "\\part",
  "\\chapter",
  "\\section",
  "\\subsection",
  "\\subsubsection",
  "\\paragraph",
  "\\frametitle",
  "\\framesubtitle",
]);

const headingMark = Decoration.mark({ class: "cm-tex-heading" });

const WRAPPERS = new Set(["DocumentItem", "FragmentItem", "TexItem"]);

/** The item itself, unwrapped from the grammar's single-child item nodes. */
function unwrap(node: SyntaxNode | null): SyntaxNode | null {
  while (node && WRAPPERS.has(node.name)) node = node.firstChild;
  return node;
}

/** The outermost single-child wrapper of `node`, whose siblings are the next items. */
function outermostWrapper(node: SyntaxNode): SyntaxNode {
  while (node.parent && WRAPPERS.has(node.parent.name)) node = node.parent;
  return node;
}

/**
 * The braced titles of sectioning commands and frames, so a document's
 * outline stands out. A title is the first group after the command, past a
 * star, overlay specification or optional argument; a frame's title may be
 * followed by its subtitle. Like TeX, the search skips spaces, single line
 * breaks and comments, but stops at a blank line.
 */
function titleRanges(doc: Text, start: SyntaxNode, maxGroups: number): { from: number; to: number }[] {
  const titles: { from: number; to: number }[] = [];
  for (let next = outermostWrapper(start).nextSibling; next && titles.length < maxGroups; next = next.nextSibling) {
    const item = unwrap(next);
    if (!item) break;
    if (item.name === "Group") {
      const closed = doc.sliceString(item.to - 1, item.to) === "}";
      titles.push({ from: item.from + 1, to: closed ? item.to - 1 : item.to });
      continue;
    }
    const text = doc.sliceString(item.from, item.to);
    if (item.name === "Comment" || (item.name === "Whitespace" && !/\n[ \t]*\n/u.test(text))) continue;
    // Only the title, not the subtitle, may follow these.
    const beforeTitle =
      item.name === "OverlaySpecification" ||
      item.name === "OptionalArgument" ||
      (item.name === "Text" && text === "*");
    if (!beforeTitle || titles.length > 0) break;
  }
  return titles.filter((range) => range.from < range.to);
}

/** The title ranges of headings that start within `within`. */
export function texHeadingRanges(state: EditorState, within: readonly { from: number; to: number }[]): { from: number; to: number }[] {
  const { doc } = state;
  const tree = syntaxTree(state);
  const ranges: { from: number; to: number }[] = [];
  for (const { from, to } of within) {
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        if (ref.name === "ControlSequence" && HEADING_COMMANDS.has(doc.sliceString(ref.from, ref.to))) {
          const command = ref.node.parent;
          if (command?.name === "GenericCommand") {
            ranges.push(...titleRanges(doc, command, 1));
          }
          return false;
        }
        if (ref.name === "BeginEnvironment") {
          const name = ref.node.getChild("EnvironmentNameLike");
          if (name && doc.sliceString(name.from, name.to) === "frame") {
            ranges.push(...titleRanges(doc, ref.node, 2));
          }
          return false;
        }
        return;
      },
    });
  }
  return ranges;
}

function headingDecorations(view: EditorView): DecorationSet {
  return Decoration.set(texHeadingRanges(view.state, view.visibleRanges).map((range) => headingMark.range(range.from, range.to)), true);
}

export const texHeadings = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = headingDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = headingDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  ),
  EditorView.baseTheme({ ".cm-tex-heading": { fontWeight: "bold" } }),
];
