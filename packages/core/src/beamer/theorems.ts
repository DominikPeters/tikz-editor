import type {
  BeamerDocumentModel,
  BeamerTheoremDeclarationModel,
} from "./types.js";
import { scanBeamerEnvironmentTokens } from "./scan.js";

export type BeamerTheoremOccurrence = {
  readonly environment: string;
  readonly beginOffset: number;
  readonly declaration: BeamerTheoremDeclarationModel;
  readonly number: string | null;
};

export type BeamerTheoremCounterSeed = {
  readonly counter: string;
  readonly value: number;
};

/**
 * Resolve theorem declarations and counters in document source order.
 *
 * Like the shared macro binding pass, declarations become visible only after
 * their definition. Counter values are assigned once per source environment,
 * independently of overlay pages.
 */
export function resolveBeamerTheoremOccurrences(
  document: BeamerDocumentModel
): ReadonlyMap<number, BeamerTheoremOccurrence> {
  const result = new Map<number, BeamerTheoremOccurrence>();
  const counters = new Map<string, number>();
  const tokens = scanBeamerEnvironmentTokens(
    document.source,
    document.documentBodySpan
  );

  for (const token of tokens) {
    if (token.kind !== "begin") {
      continue;
    }
    const declarations = visibleDeclarations(
      document.preamble.theoremDeclarations,
      token.span.from
    );
    const declaration = declarations.get(token.name);
    if (!declaration) {
      continue;
    }
    const counterRoot = theoremCounterRoot(declaration, declarations);
    const sectionNumber = sectionNumberAt(document, token.span.from);
    const within = counterRoot
      ? declarations.get(counterRoot)?.within ?? declaration.within
      : undefined;
    const counterKey = counterRoot == null
      ? null
      : within === "section"
        ? `${counterRoot}@section:${sectionNumber}`
        : counterRoot;
    const value = counterKey == null
      ? null
      : (counters.get(counterKey) ?? 0) + 1;
    if (counterKey && value != null) {
      counters.set(counterKey, value);
    }
    result.set(token.span.from, {
      environment: token.name,
      beginOffset: token.span.from,
      declaration,
      number: value == null
        ? null
        : within === "section"
          ? `${sectionNumber}.${value}`
          : String(value),
    });
  }
  return result;
}

export function activeBeamerTheoremDeclarations(
  document: BeamerDocumentModel,
  offset: number
): ReadonlyMap<string, BeamerTheoremDeclarationModel> {
  return visibleDeclarations(document.preamble.theoremDeclarations, offset);
}

export function resolveBeamerTheoremCounterSeed(
  document: BeamerDocumentModel,
  offset: number
): readonly BeamerTheoremCounterSeed[] {
  const result = new Map<string, number>();
  const selectedSection = sectionNumberAt(document, offset);
  for (const occurrence of resolveBeamerTheoremOccurrences(document).values()) {
    if (occurrence.beginOffset >= offset || occurrence.number == null) {
      continue;
    }
    const declarations = visibleDeclarations(
      document.preamble.theoremDeclarations,
      occurrence.beginOffset
    );
    const counter = theoremCounterRoot(occurrence.declaration, declarations);
    if (!counter) {
      continue;
    }
    const within =
      declarations.get(counter)?.within ?? occurrence.declaration.within;
    if (
      within === "section" &&
      sectionNumberAt(document, occurrence.beginOffset) !== selectedSection
    ) {
      continue;
    }
    const value = Number(occurrence.number.split(".").at(-1));
    if (Number.isInteger(value)) {
      result.set(counter, value);
    }
  }
  return [...result].map(([counter, value]) => ({ counter, value }));
}

function visibleDeclarations(
  declarations: readonly BeamerTheoremDeclarationModel[],
  offset: number
): Map<string, BeamerTheoremDeclarationModel> {
  const result = new Map<string, BeamerTheoremDeclarationModel>();
  for (const declaration of declarations) {
    if (declaration.builtIn || declaration.span.from < offset) {
      result.set(declaration.name, declaration);
    }
  }
  return result;
}

function theoremCounterRoot(
  declaration: BeamerTheoremDeclarationModel,
  declarations: ReadonlyMap<string, BeamerTheoremDeclarationModel>
): string | null {
  if (declaration.counter == null) {
    return null;
  }
  let current = declaration;
  const seen = new Set<string>();
  while (current.sharedCounter && !seen.has(current.name)) {
    seen.add(current.name);
    const shared = declarations.get(current.sharedCounter);
    if (!shared) {
      return current.sharedCounter;
    }
    current = shared;
  }
  return current.counter;
}

function sectionNumberAt(
  document: BeamerDocumentModel,
  offset: number
): number {
  let number = 0;
  for (const section of document.sections) {
    if (section.span.from >= offset) {
      break;
    }
    if (section.level === 1 && !section.starred) {
      number += 1;
    }
  }
  return number;
}
