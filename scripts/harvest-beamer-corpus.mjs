#!/usr/bin/env node
// Harvest a corpus of real-world Beamer .tex sources from GitHub code search.
//
// Strategy: GitHub's (legacy) code search caps results at ~1000 per query, so
// we stratify queries by \usetheme value plus a few generic queries. Results
// are deduplicated by git blob sha (content-addressed, so identical copies of
// e.g. theme demo decks across forks collapse to one file).
//
// The corpus is for local analysis and oracle caching only — files have no
// redistribution license, so the output directory must stay gitignored
// (it lives under /artifacts, which is).
//
// Usage:
//   node scripts/harvest-beamer-corpus.mjs [--out-dir artifacts/beamer-corpus]
//     [--limit-per-query 100] [--themes metropolis,Madrid,...] [--no-generic]
//     [--sleep-ms 7000] [--max-kb 512] [--dry-run]
//
// Requires an authenticated `gh` CLI.

import { execFile } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const DEFAULT_THEMES = [
  "metropolis", "moloch", "Madrid", "Berlin", "Warsaw", "CambridgeUS",
  "Copenhagen", "Singapore", "Frankfurt", "Boadilla", "AnnArbor", "Antibes",
  "Bergen", "Berkeley", "Darmstadt", "Dresden", "Goettingen", "Hannover",
  "Ilmenau", "Luebeck", "Malmoe", "Marburg", "Montpellier", "PaloAlto",
  "Pittsburgh", "Rochester", "Szeged", "default", "focus", "sthlm",
  "Execushares", "Feather"
];

const GENERIC_QUERIES = [
  { stratum: "generic:documentclass", terms: ["documentclass", "beamer"] },
  { stratum: "generic:frametitle", terms: ["begin", "frame", "frametitle"] },
  { stratum: "generic:pause", terms: ["begin", "frame", "pause"] }
];

const BEAMER_MARKER = /\\documentclass[^\n]*\{beamer\}|\\usetheme\b|\\begin\{frame\}/;

function parseArgs(argv) {
  const options = {
    outDir: "artifacts/beamer-corpus",
    limitPerQuery: 100,
    themes: DEFAULT_THEMES,
    generic: true,
    sleepMs: 7000,
    maxKb: 512,
    dryRun: false
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out-dir") options.outDir = argv[++i];
    else if (arg === "--limit-per-query") options.limitPerQuery = Number(argv[++i]);
    else if (arg === "--themes") options.themes = argv[++i].split(",").map((t) => t.trim()).filter(Boolean);
    else if (arg === "--no-generic") options.generic = false;
    else if (arg === "--sleep-ms") options.sleepMs = Number(argv[++i]);
    else if (arg === "--max-kb") options.maxKb = Number(argv[++i]);
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function runGh(args, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const { stdout } = await execFileP("gh", args, { maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    } catch (error) {
      const message = `${error.stderr ?? ""} ${error.message ?? ""}`;
      if (attempt >= retries) {
        throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${message.slice(0, 300)}`, { cause: error });
      }
      const rateLimited = /rate limit|HTTP 403|HTTP 429|abuse/i.test(message);
      const delay = rateLimited ? 70_000 : 5_000 * (attempt + 1);
      console.warn(`  gh failed (${rateLimited ? "rate limited" : "error"}), retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }
}

function repoFullName(repository) {
  return repository?.fullName ?? repository?.nameWithOwner
    ?? (repository?.owner?.login && repository?.name ? `${repository.owner.login}/${repository.name}` : null);
}

function sanitize(part, maxLength = 60) {
  return part.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, maxLength);
}

function loadManifest(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

async function searchStratum(stratum, terms, limit) {
  const args = [
    "search", "code", ...terms,
    "--extension", "tex",
    "--limit", String(limit),
    "--json", "path,repository,sha,url"
  ];
  const stdout = await runGh(args);
  const results = JSON.parse(stdout);
  return results
    .map((entry) => ({
      stratum,
      sha: entry.sha,
      path: entry.path,
      repo: repoFullName(entry.repository)
    }))
    .filter((entry) => entry.sha && entry.repo && entry.path?.endsWith(".tex"));
}

async function fetchBlob(repo, sha) {
  const stdout = await runGh(["api", `repos/${repo}/git/blobs/${sha}`], { retries: 2 });
  const blob = JSON.parse(stdout);
  if (blob.encoding !== "base64" || typeof blob.content !== "string") return null;
  return { size: blob.size, content: Buffer.from(blob.content, "base64").toString("utf8") };
}

async function main() {
  const options = parseArgs(process.argv);
  const outDir = resolve(process.cwd(), options.outDir);
  const manifestPath = join(outDir, "manifest.json");
  mkdirSync(outDir, { recursive: true });

  const manifest = loadManifest(manifestPath);
  const seen = new Set(manifest.map((entry) => entry.sha));
  console.log(`Resuming with ${manifest.length} files already in manifest.`);

  const queries = [
    ...(options.generic ? GENERIC_QUERIES : []),
    ...options.themes.map((theme) => ({ stratum: `theme:${theme}`, terms: ["usetheme", theme] }))
  ];

  const totals = { searched: 0, new: 0, saved: 0, skippedSize: 0, skippedMarker: 0, failed: 0 };

  for (const [index, query] of queries.entries()) {
    let candidates;
    try {
      candidates = await searchStratum(query.stratum, query.terms, options.limitPerQuery);
    } catch (error) {
      console.warn(`[${query.stratum}] search failed: ${error.message}`);
      continue;
    }
    const fresh = candidates.filter((candidate) => !seen.has(candidate.sha));
    totals.searched += candidates.length;
    console.log(`[${index + 1}/${queries.length}] ${query.stratum}: ${candidates.length} results, ${fresh.length} new`);

    if (!options.dryRun) {
      for (const candidate of fresh) {
        seen.add(candidate.sha);
        totals.new++;
        let blob;
        try {
          blob = await fetchBlob(candidate.repo, candidate.sha);
        } catch {
          totals.failed++;
          continue;
        }
        await sleep(150);
        if (!blob || blob.size > options.maxKb * 1024) {
          totals.skippedSize++;
          continue;
        }
        if (!BEAMER_MARKER.test(blob.content)) {
          totals.skippedMarker++;
          continue;
        }
        const [owner, repoName] = candidate.repo.split("/");
        const fileName = `${sanitize(owner)}__${sanitize(repoName)}__${sanitize(basename(candidate.path, ".tex"))}-${candidate.sha.slice(0, 8)}.tex`;
        writeFileSync(join(outDir, fileName), blob.content);
        manifest.push({
          sha: candidate.sha,
          repo: candidate.repo,
          path: candidate.path,
          stratum: query.stratum,
          file: fileName,
          size: blob.size,
          fetchedAt: new Date().toISOString()
        });
        totals.saved++;
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    if (index < queries.length - 1) {
      await sleep(options.sleepMs);
    }
  }

  console.log(
    `Done. ${totals.searched} search results, ${totals.new} new shas, ${totals.saved} saved, ` +
    `${totals.skippedSize} skipped (size), ${totals.skippedMarker} skipped (no beamer marker), ${totals.failed} fetch failures.`
  );
  console.log(`Corpus: ${outDir} (${manifest.length} files in manifest)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
