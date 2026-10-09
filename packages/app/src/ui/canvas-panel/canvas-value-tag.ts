import type { TaggedValue } from "@tikz-editor/core/editing/operations/index";

/** Average advance of the tag's font (9px UI and mono), in px per character. */
const TAG_CHAR_PX = 5.4;
/** Tags never shrink below this many characters, however narrow the construct. */
const MIN_TAG_CHARS = 28;

/**
 * The text of a construct's value tag (O8): its command and values in
 * source form (`\textcolor{red}`), as long as the outlined construct is
 * wide. Values are shortened longest first, each keeping its start
 * (`\href{https://exam…}`), so a wide `\parbox` shows all of its own.
 */
export function valueTagText(command: string, values: readonly Pick<TaggedValue, "open" | "close" | "text">[], widthPx: number): string {
  const budget = Math.max(MIN_TAG_CHARS, Math.floor(widthPx / TAG_CHAR_PX));
  const texts = values.map((value) => value.text.replace(/\s+/gu, " ").trim());
  const render = () => `\\${command}${values.map((value, index) => value.open + texts[index] + value.close).join("")}`;
  while (render().length > budget) {
    let longest = -1;
    texts.forEach((text, index) => {
      if (text.length > 2 && (longest < 0 || text.length > texts[longest].length)) {
        longest = index;
      }
    });
    if (longest < 0) {
      break;
    }
    const text = texts[longest].replace(/…$/u, "");
    texts[longest] = `${text.slice(0, Math.max(1, text.length - Math.max(1, render().length - budget) - 1))}…`;
  }
  return render();
}
