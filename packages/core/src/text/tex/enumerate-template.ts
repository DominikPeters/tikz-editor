/** Bounded enumerate.sty mini templates: ungrouped 1/a/A/i/I select a counter;
 * grouped text is literal. Formatting programs remain source-editable. */
export function enumerateTemplateText(template: string, counter: number): string | null {
  let depth = 0;
  let format = "1";
  const parts: Array<{ text: string; counter: boolean }> = [];
  for (let at = 0; at < template.length; at++) {
    const char = template[at] ?? "";
    if (char === "\\" || char === "%" || /[\r\n$#&^_]/u.test(char)) return null;
    if (char === "{") { depth++; continue; }
    if (char === "}") { if (--depth < 0) return null; continue; }
    if (depth === 0 && (char === "[" || char === "]" || char === "<" || char === ">")) return null;
    const isCounter = depth === 0 && "1aAiI".includes(char);
    if (isCounter) format = char;
    parts.push({ text: char, counter: isCounter });
  }
  if (depth !== 0) return null;
  let number = String(counter);
  if (format === "a" || format === "A") {
    number = counter >= 1 && counter <= 26 ? String.fromCharCode(96 + counter) : "?";
    if (format === "A") number = number.toUpperCase();
  }
  if (format === "i" || format === "I") {
    number = "";
    let rest = Math.max(1, counter);
    for (const [value, token] of [[1000,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]] as const) {
      while (rest >= value) { number += token; rest -= value; }
    }
    if (format === "I") number = number.toUpperCase();
  }
  return parts.map(part => part.counter ? number : part.text).join("");
}
