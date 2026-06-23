export type TikzDocEntryType = "key" | "command" | "style";

export type TikzDocEntry = {
  type: TikzDocEntryType;
  signatureHtml: string;
  defaultHtml: string;
  snippetHtml: string;
  page: string;
  anchor: string;
  href: string;
};

type DocIndex = Record<string, string>;
type DocChunk = Record<string, TikzDocEntry>;

let indexPromise: Promise<DocIndex | null> | null = null;
const chunkPromises = new Map<string, Promise<DocChunk | null>>();

export async function lookupTikzDocEntry(candidates: readonly string[]): Promise<TikzDocEntry | null> {
  const normalizedCandidates = normalizeCandidates(candidates);
  if (normalizedCandidates.length === 0) {
    return null;
  }

  const index = await loadDocIndex();
  if (!index) {
    return null;
  }

  let matchedCandidate: string | null = null;
  let chunkName: string | null = null;
  for (const candidate of normalizedCandidates) {
    const directChunk = index[candidate];
    if (directChunk) {
      matchedCandidate = candidate;
      chunkName = directChunk;
      break;
    }
  }
  if (!matchedCandidate || !chunkName) {
    return null;
  }

  const chunk = await loadChunk(chunkName);
  if (!chunk) {
    return null;
  }

  for (const candidate of normalizedCandidates) {
    const entry = chunk[candidate];
    if (entry) {
      return entry;
    }
  }

  // Fallback in case index/chunk aliases diverge.
  return chunk[matchedCandidate] ?? null;
}

function normalizeCandidates(candidates: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.trim().toLowerCase();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

async function loadDocIndex(): Promise<DocIndex | null> {
  indexPromise ??= fetchJson<DocIndex>("docs/keys/index.json");
  return indexPromise;
}

async function loadChunk(chunkName: string): Promise<DocChunk | null> {
  const existing = chunkPromises.get(chunkName);
  if (existing) {
    return existing;
  }
  const pending = fetchJson<DocChunk>(`docs/keys/${chunkName}.json`);
  chunkPromises.set(chunkName, pending);
  return pending;
}

async function fetchJson<T>(assetPath: string): Promise<T | null> {
  try {
    const base = resolveBaseUrl();
    const url = new URL(assetPath, base).toString();
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function resolveBaseUrl(): string {
  if (typeof document !== "undefined" && typeof document.baseURI === "string" && document.baseURI.length > 0) {
    return document.baseURI;
  }
  if (typeof window !== "undefined" && typeof window.location?.href === "string" && window.location.href.length > 0) {
    return window.location.href;
  }
  return "http://localhost/";
}

export function resetTikzDocCacheForTests(): void {
  indexPromise = null;
  chunkPromises.clear();
}
