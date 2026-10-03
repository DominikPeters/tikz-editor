const PATH_COMMANDS = new Set("MmLlHhVvCcSsQqTtAaZz");

/**
 * Guard svg2tikz's two nonadvancing parser states, without replacing its
 * geometry grammar. Its tokenizer skips unknown characters and accepts even
 * partial numeric tokens, so a strict SVG-number regexp is not a safe guard.
 */
function assertPathParserProgress(data: string): void {
  let command: string | null = null;
  let cursor = 0;
  while (cursor < data.length) {
    const char = data.charAt(cursor);
    if (PATH_COMMANDS.has(char)) {
      command = char;
      cursor += 1;
      continue;
    }
    const startsNumber = char === "+" || char === "-" || char === "." || (char >= "0" && char <= "9");
    if (!startsNumber) {
      cursor += 1;
      continue;
    }
    if (command === null || command === "Z" || command === "z") {
      throw new Error(command === null
        ? "Malformed SVG path data: a number appears before any path command."
        : "Malformed SVG path data: a number cannot repeat a closepath command.");
    }

    // Follow the installed dependency's numeric token boundary, including
    // malformed partial numbers; every branch advances the cursor.
    if (char === "+" || char === "-") cursor += 1;
    let hasDot = false;
    while (cursor < data.length) {
      const next = data.charAt(cursor);
      if (next >= "0" && next <= "9") cursor += 1;
      else if (next === "." && !hasDot) { hasDot = true; cursor += 1; }
      else if (next === "e" || next === "E") {
        cursor += 1;
        if (data.charAt(cursor) === "+" || data.charAt(cursor) === "-") cursor += 1;
      } else break;
    }
  }
}

export function parseSvgForImport(source: string): Element {
  if (typeof DOMParser === "undefined") throw new Error("DOMParser is not available in this environment");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  // Match the converter's selection and pass this same tree into conversion.
  const svg = document.querySelector("svg");
  if (!svg) throw new Error("No <svg> element found");
  const validated = new Set<Element>();
  function validate(element: Element): void {
    if (validated.has(element)) return;
    validated.add(element);
    assertPathParserProgress(element.getAttribute("d") ?? "");
  }
  // <use> resolves through ownerDocument, including targets outside the chosen
  // SVG. Check decoded attributes throughout that document, not a raw-text regex
  // or a namespace-dependent querySelectorAll('path') subset.
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element.localName.toLowerCase() === "path" || element.tagName.toLowerCase() === "path") validate(element);
  }
  // Preprocessing also parses the first marker path/polygon unless its actual
  // tagName is 'polygon'. Use exactly that selection to cover DOM namespace
  // selector differences without treating unrelated d attributes as paths.
  for (const marker of Array.from(svg.querySelectorAll("marker"))) {
    if (!marker.getAttribute("id")) continue;
    const shape = marker.querySelector("path, polygon");
    if (shape && shape.tagName.toLowerCase() !== "polygon") validate(shape);
  }
  return svg;
}
