#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Classify both sides of renames; callers supply git diff --no-renames paths. */
export function classifyCiChanges(files) {
  const result = { checks: false, unit: false, web: false, desktop: false, images: false, landing: false, ipad: false };
  const enable = (...jobs) => { for (const job of jobs) result[job] = true; };
  for (const file of files) {
    if (/(?:^|\/)(?:README|AGENTS|DEVELOPMENT|CONTRIBUTING|CHANGELOG)\.md$/u.test(file)) continue;
    if (/^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vitest\.config\.ts|eslint\.config\.[^/]+|knip\.jsonc?|\.npmrc|\.nvmrc|\.node-version)$/u.test(file)
      || file === ".github/workflows/ci.yml" || file === "scripts/ci-changes.mjs" || file === "scripts/ci-changes.d.mts") {
      enable(...Object.keys(result));
    } else if (/^packages\/(?:core|lezer-tex|lezer-tikz|lang-tikz)\//u.test(file)) {
      enable(...Object.keys(result));
    } else if (file.startsWith("packages/app/")) {
      enable("checks", "unit", "web", "desktop", "landing", "ipad");
      if (/^packages\/app\/src\/(?:image|pdf|graphic|imported-graphics)/u.test(file)) enable("images");
    } else if (file.startsWith("packages/tex-fuzz/")) {
      enable("checks", "unit", "images");
    } else if (file.startsWith("packages/")) {
      // Future shared packages must not silently bypass their consumers.
      enable(...Object.keys(result));
    } else if (file.startsWith("apps/landing/")) {
      enable("checks", "landing");
    } else if (file.startsWith("apps/ipad/")) {
      enable("checks", "unit", "ipad");
    } else if (file.startsWith("apps/desktop/")) {
      enable("checks", "unit", "desktop");
    } else if (file.startsWith("apps/web/")) {
      enable("checks", "unit", "web");
    } else if (file.startsWith("scripts/")) {
      enable("checks", "unit", "images");
    } else if (file.startsWith("test/")) {
      enable("checks", "unit");
      if (file.startsWith("test/fixtures/")) enable("images", "web");
      if (/^test\/tex-fuzz-(?:graphics|image-paint)(?:-tool)?\.spec\.ts$/u.test(file)) enable("images");
    } else if (file === ".github/workflows/image-fidelity.yml") {
      enable("checks", "images");
    } else if (file.startsWith(".github/")) {
      enable("checks");
    } else if (file.startsWith("apps/")) {
      enable(...Object.keys(result));
    } else if (/^(?:docs|design|artifacts)\//u.test(file) || /(?:\.md$|^(?:LICENSE|NOTICE|\.gitignore)$)/u.test(file)) {
      // Documentation and generated reports are not executable inputs.
    } else {
      // Unknown build/configuration inputs get conservative coverage.
      enable(...Object.keys(result));
    }
  }
  return result;
}

function changedFiles(event, eventName) {
  if (eventName === "workflow_dispatch") return null;
  const base = eventName === "pull_request" ? event.pull_request?.base?.sha : event.before;
  const head = eventName === "pull_request" ? event.pull_request?.head?.sha : event.after;
  if (!base || !head || /^0+$/u.test(base)) return null;
  try {
    // PRs compare against their merge base; pushes include every pushed commit.
    const from = eventName === "pull_request"
      ? execFileSync("git", ["merge-base", base, head], { encoding: "utf8" }).trim()
      : base;
    return execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", from, head], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\0").filter(Boolean);
  } catch (error) {
    // Force-push bases can disappear from the fetched history. Run all checks.
    console.warn(`Cannot determine changed paths; running all CI jobs: ${error.message}`);
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const files = changedFiles(event, process.env.GITHUB_EVENT_NAME);
  const jobs = files === null ? classifyCiChanges(["package.json"]) : classifyCiChanges(files);
  console.log(JSON.stringify({ changedFiles: files ?? "all (manual run or unavailable base)", jobs }, null, 2));
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(jobs).map(([job, enabled]) => `${job}=${enabled}\n`).join(""));
}
