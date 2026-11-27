/**
 * Which table files a document reads, so a host can load them before
 * rendering (as it loads images and theme files): `\addplot table {name}`
 * and `\pgfplotstableread{name}\macro` with a file name argument (no row
 * separator inside, manual pgfplotstable.tex `table/format=auto`).
 * Names are as written; TeX finds them relative to the main document.
 */
const TABLE_READ = /\\pgfplotstableread\s*(?:\[(?:[^[\]]|\[[^\]]*\])*\])?\s*\{([^{}\\\n\r]+)\}/gu;
const PLOT_TABLE = /(?<![\\A-Za-z@{])table\s*(?:\[(?:[^[\]]|\[(?:[^[\]]|\[[^\]]*\])*\])*\])?\s*(?:from\s*)?\{([^{}\\\n\r]+)\}/gu;

/** Whether the text may read table files at all (a cheap test before scanning). */
export function mayReadPgfplotsTableFiles(text: string): boolean {
  return text.includes("\\pgfplotstableread") || (text.includes("\\addplot") && /(?<![\\A-Za-z@{])table\s*[[{f]/u.test(text));
}

export function pgfplotsTableFileNames(text: string): string[] {
  if (!mayReadPgfplotsTableFiles(text)) return [];
  const names = new Set<string>();
  const stripped = text.replace(/(?<!\\)%[^\n]*/gu, "");
  for (const pattern of [TABLE_READ, PLOT_TABLE]) {
    for (const match of stripped.matchAll(pattern)) {
      const name = match[1]?.trim();
      if (name && !/\s/u.test(name)) names.add(name);
    }
  }
  return [...names];
}
