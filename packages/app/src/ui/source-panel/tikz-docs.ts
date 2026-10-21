import { isRecord } from "../../validation";
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
  indexPromise ??= fetchJson("docs/keys/index.json").then(value => {
    if (!isRecord(value)) return null;
    const index: DocIndex = {};
    for (const [key, chunk] of Object.entries(value)) {
      if (typeof chunk !== "string") return null;
      index[key] = chunk;
    }
    return index;
  });
  return indexPromise;
}

async function loadChunk(chunkName: string): Promise<DocChunk | null> {
  const existing = chunkPromises.get(chunkName);
  if (existing) {
    return existing;
  }
  const pending = fetchJson(`docs/keys/${chunkName}.json`).then(value => {
    if (!isRecord(value)) return null;
    const chunk: DocChunk = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!isRecord(entry) || (entry.type !== "key" && entry.type !== "command" && entry.type !== "style") ||
        typeof entry.signatureHtml !== "string" || typeof entry.defaultHtml !== "string" ||
        typeof entry.snippetHtml !== "string" || typeof entry.page !== "string" ||
        typeof entry.anchor !== "string" || typeof entry.href !== "string") return null;
      chunk[key] = { type: entry.type, signatureHtml: entry.signatureHtml, defaultHtml: entry.defaultHtml,
        snippetHtml: entry.snippetHtml, page: entry.page, anchor: entry.anchor, href: entry.href };
    }
    return chunk;
  });
  chunkPromises.set(chunkName, pending);
  return pending;
}

async function fetchJson(assetPath: string): Promise<unknown> {
  try {
    const base = resolveBaseUrl();
    const url = new URL(assetPath, base).toString();
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const value: unknown = await response.json();
    return value;
  } catch {
    return null;
  }
}

function resolveBaseUrl(): string {
  if (typeof document !== "undefined" && typeof document.baseURI === "string" && document.baseURI.length > 0) {
    return document.baseURI;
  }
  if (typeof window !== "undefined" && typeof window.location.href === "string" && window.location.href.length > 0) {
    return window.location.href;
  }
  return "http://localhost/";
}

export function resetTikzDocCacheForTests(): void {
  indexPromise = null;
  chunkPromises.clear();
}
