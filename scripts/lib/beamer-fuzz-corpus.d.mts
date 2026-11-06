import type { BeamerEditSequence } from "./beamer-edit-sequences.mjs";
export function fuzzHash(value: string | Uint8Array): string;
export function validateEditSequence(value: unknown): BeamerEditSequence;
export interface BeamerCorpusEntry { id: string; sequence: BeamerEditSequence; size: number; features: string[]; status: string; measured: boolean }
export function openBeamerFuzzCorpus(directory: string, namespace: string): {
  entries: BeamerCorpusEntry[]; active(): BeamerCorpusEntry[];
  remember(sequence: BeamerEditSequence, observation: { features: string[]; status: string; [key: string]: unknown }): BeamerCorpusEntry;
};
export function mutateBeamerCorpusSequence(parent: BeamerEditSequence, seed: number): BeamerEditSequence | null;
