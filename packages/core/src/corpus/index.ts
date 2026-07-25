/**
 * Node-only corpus extraction helpers.
 *
 * This entry point intentionally depends on node:fs and node:path. Keep it
 * separate from the browser-safe package root.
 */
export {
  collectTikzSnippetsFromDocs,
  extractTikzSnippetsFromSource,
  type TikzSnippet,
  type TikzSnippetKind,
} from "./extract.js";
