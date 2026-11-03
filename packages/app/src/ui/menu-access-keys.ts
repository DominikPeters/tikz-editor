// Access keys for the in-app menu bar (the underlined letter Alt+letter or a
// letter in an open menu picks). Assigned per menu: Windows conventions first,
// then the first letter of a word, then any letter, each letter used once.

const CONVENTIONAL: Readonly<Record<string, string>> = {
  "cut": "t",
  "exit": "x",
  "save as...": "a",
  "select all": "a"
};

const LETTER = /[\p{L}\p{N}]/u;

function candidates(label: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < label.length; index += 1) {
    if (LETTER.test(label.charAt(index)) && (index === 0 || !LETTER.test(label.charAt(index - 1)))) out.push(index);
  }
  for (let index = 0; index < label.length; index += 1) {
    if (LETTER.test(label.charAt(index)) && !out.includes(index)) out.push(index);
  }
  return out;
}

/** The index of each label's access key, or null when every letter is taken. */
export function assignAccessKeys(labels: readonly string[]): Array<number | null> {
  const used = new Set<string>();
  const keys: Array<number | null> = labels.map((label) => {
    const letter = CONVENTIONAL[label.trim().toLowerCase()];
    if (!letter || used.has(letter)) return null;
    const index = candidates(label).find((candidate) => label.charAt(candidate).toLowerCase() === letter);
    if (index === undefined) return null;
    used.add(letter);
    return index;
  });
  return keys.map((assigned, position) => {
    if (assigned != null) return assigned;
    const label = labels[position] ?? "";
    for (const index of candidates(label)) {
      const letter = label.charAt(index).toLowerCase();
      if (!used.has(letter)) {
        used.add(letter);
        return index;
      }
    }
    return null;
  });
}
