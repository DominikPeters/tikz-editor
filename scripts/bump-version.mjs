#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageJsonUpdates = [
  { file: "package.json" },
  { file: "packages/lezer-tikz/package.json" },
  {
    file: "packages/lang-tikz/package.json",
    internalDependencies: ["@tikz-editor/lezer-tikz"],
  },
  {
    file: "packages/core/package.json",
    internalDependencies: ["@tikz-editor/lezer-tikz"],
  },
  {
    file: "packages/app/package.json",
    internalDependencies: ["@tikz-editor/core", "@tikz-editor/lang-tikz"],
  },
  {
    file: "apps/web/package.json",
    internalDependencies: ["@tikz-editor/app"],
  },
  {
    file: "apps/desktop/package.json",
    internalDependencies: ["@tikz-editor/app"],
  },
  {
    file: "apps/landing/package.json",
    internalDependencies: ["@tikz-editor/app"],
  },
];

const expectedFiles = [
  ...packageJsonUpdates.map(({ file }) => file),
  "package-lock.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.lock",
  "apps/desktop/src-tauri/tauri.conf.json",
];

const expectedFileSet = new Set(expectedFiles);

const usage = `Usage: npm run version:bump -- <version> [--no-commit] [--allow-dirty]

Examples:
  npm run version:bump -- 0.2.0
  npm run version:bump -- v0.2.0

By default this updates release metadata, stages the expected files, and commits
with message v<version>. It never creates a git tag.`;

function parseArgs(argv) {
  let rawVersion;
  let commit = true;
  let allowDirty = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }

    if (arg === "--no-commit") {
      commit = false;
      continue;
    }

    if (arg === "--allow-dirty") {
      allowDirty = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (rawVersion) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }

    rawVersion = arg;
  }

  if (!rawVersion) {
    throw new Error("Missing target version.\n\n" + usage);
  }

  return {
    version: normalizeVersion(rawVersion),
    commit,
    allowDirty,
  };
}

function normalizeVersion(rawVersion) {
  const match = /^(?:v)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/.exec(
    rawVersion,
  );

  if (!match) {
    throw new Error(`Invalid semver version: ${rawVersion}`);
  }

  return match[1];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      `${command} ${args.join(" ")} failed${stderr ? `:\n${stderr}` : ""}`,
    );
  }

  return result.stdout ?? "";
}

function getGitStatus() {
  const output = run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { capture: true },
  );

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      index: line[0],
      worktree: line[1],
      path: parseStatusPath(line),
      line,
    }));
}

function parseStatusPath(line) {
  const rawPath = line.slice(3);
  const renameSeparator = " -> ";
  const renameIndex = rawPath.indexOf(renameSeparator);
  return renameIndex === -1
    ? rawPath
    : rawPath.slice(renameIndex + renameSeparator.length);
}

function hasStagedChanges(status) {
  return status.some(({ index }) => index !== " " && index !== "?");
}

function hasCachedDiff() {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status === 0) {
    return false;
  }

  if (result.status === 1) {
    return true;
  }

  throw new Error(result.stderr?.trim() || "git diff --cached --quiet failed");
}

async function readJson(file) {
  return JSON.parse(await readFile(path.join(repoRoot, file), "utf8"));
}

async function writeJson(file, data) {
  await writeFile(
    path.join(repoRoot, file),
    JSON.stringify(data, null, 2) + "\n",
  );
}

async function updatePackageJsons(version) {
  for (const update of packageJsonUpdates) {
    const packageJson = await readJson(update.file);
    packageJson.version = version;

    for (const dependencyName of update.internalDependencies ?? []) {
      if (!packageJson.dependencies?.[dependencyName]) {
        throw new Error(`${update.file} is missing dependency ${dependencyName}`);
      }

      packageJson.dependencies[dependencyName] = version;
    }

    await writeJson(update.file, packageJson);
  }
}

async function updateTauriConfig(version) {
  const configFile = "apps/desktop/src-tauri/tauri.conf.json";
  const config = await readJson(configFile);
  config.version = version;
  await writeJson(configFile, config);
}

async function replaceInFile(file, pattern, replacement) {
  const absolutePath = path.join(repoRoot, file);
  const text = await readFile(absolutePath, "utf8");
  const updated = text.replace(pattern, replacement);

  if (updated === text) {
    throw new Error(`No matching version entry found in ${file}`);
  }

  await writeFile(absolutePath, updated);
}

async function updateCargoFiles(version) {
  await replaceInFile(
    "apps/desktop/src-tauri/Cargo.toml",
    /(^\[package\]\nname = "app"\nversion = ")[^"]+(")/m,
    `$1${version}$2`,
  );
  await replaceInFile(
    "apps/desktop/src-tauri/Cargo.lock",
    /(\[\[package\]\]\nname = "app"\nversion = ")[^"]+(")/,
    `$1${version}$2`,
  );
}

async function verifyVersion(version) {
  for (const update of packageJsonUpdates) {
    const packageJson = await readJson(update.file);
    assertEqual(packageJson.version, version, `${update.file} version`);

    for (const dependencyName of update.internalDependencies ?? []) {
      assertEqual(
        packageJson.dependencies?.[dependencyName],
        version,
        `${update.file} dependency ${dependencyName}`,
      );
    }
  }

  const packageLock = await readJson("package-lock.json");
  assertEqual(packageLock.version, version, "package-lock.json version");
  assertEqual(packageLock.packages[""].version, version, "root lock version");

  for (const update of packageJsonUpdates.slice(1)) {
    const lockPackagePath = update.file.replace(/\/package\.json$/, "");
    const lockedPackage = packageLock.packages[lockPackagePath];
    assertEqual(lockedPackage?.version, version, `${update.file} lock version`);

    for (const dependencyName of update.internalDependencies ?? []) {
      assertEqual(
        lockedPackage?.dependencies?.[dependencyName],
        version,
        `${update.file} lock dependency ${dependencyName}`,
      );
    }
  }

  const tauriConfig = await readJson("apps/desktop/src-tauri/tauri.conf.json");
  assertEqual(tauriConfig.version, version, "tauri.conf.json version");

  const cargoToml = await readFile(
    path.join(repoRoot, "apps/desktop/src-tauri/Cargo.toml"),
    "utf8",
  );
  const cargoLock = await readFile(
    path.join(repoRoot, "apps/desktop/src-tauri/Cargo.lock"),
    "utf8",
  );

  const escapedVersion = escapeRegExp(version);

  if (
    !new RegExp(
      `^\\[package\\]\\nname = "app"\\nversion = "${escapedVersion}"`,
      "m",
    ).test(cargoToml)
  ) {
    throw new Error("Cargo.toml app package version did not verify");
  }

  if (
    !new RegExp(
      `\\[\\[package\\]\\]\\nname = "app"\\nversion = "${escapedVersion}"`,
    ).test(cargoLock)
  ) {
    throw new Error("Cargo.lock app package version did not verify");
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${String(actual)}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoUnexpectedChanges(beforeStatus) {
  const beforePaths = new Set(
    beforeStatus.map(({ path: statusPath }) => statusPath),
  );
  const unexpected = getGitStatus().filter(
    ({ path: statusPath }) =>
      !expectedFileSet.has(statusPath) && !beforePaths.has(statusPath),
  );

  if (unexpected.length > 0) {
    throw new Error(
      "Version bump produced unexpected file changes:\n" +
        unexpected.map(({ line }) => `  ${line}`).join("\n"),
    );
  }
}

async function main() {
  const { version, commit, allowDirty } = parseArgs(process.argv.slice(2));
  const currentRootPackage = await readJson("package.json");

  if (currentRootPackage.version === version) {
    try {
      await verifyVersion(version);
      console.log(`Already at version ${version}.`);
      return;
    } catch {
      // Continue with the bump; a previous run may have updated only some files.
    }
  }

  const beforeStatus = getGitStatus();

  if (beforeStatus.length > 0 && !allowDirty) {
    throw new Error(
      "Working tree is dirty. Commit or stash changes first, or pass --allow-dirty.",
    );
  }

  if (commit && allowDirty && hasStagedChanges(beforeStatus)) {
    throw new Error(
      "Refusing to commit with pre-existing staged changes. Commit, unstage, or pass --no-commit.",
    );
  }

  if (allowDirty) {
    for (const { path: statusPath } of beforeStatus) {
      if (expectedFileSet.has(statusPath)) {
        console.warn(
          `Warning: ${statusPath} already has local changes and may be included in the version commit.`,
        );
      }
    }
  }

  await updatePackageJsons(version);
  await updateTauriConfig(version);
  await updateCargoFiles(version);

  run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
  await verifyVersion(version);
  assertNoUnexpectedChanges(beforeStatus);

  if (!commit) {
    console.log(`Updated release metadata to ${version}. Commit skipped.`);
    return;
  }

  run("git", ["add", ...expectedFiles]);

  if (!hasCachedDiff()) {
    throw new Error("No version changes were staged for commit.");
  }

  run("git", ["commit", "-m", `v${version}`]);

  console.log(`Committed v${version}. No git tag was created.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
