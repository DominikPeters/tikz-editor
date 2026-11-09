// Collects the license notices of everything the apps ship: the npm packages
// bundled into the web, desktop and iPad front ends, the Rust crates compiled
// into the desktop and iPad shells, and the fonts whose glyph outlines the TeX
// engine embeds. Settings → Thanks shows the result.
//
// Usage: node scripts/generate-acknowledgements.mjs   (rerun after dependency changes)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "packages/app/src/acknowledgements/third-party.generated.json");
const notices = path.join(root, "packages/app/src/acknowledgements/notices");

const APP_WORKSPACES = ["@tikz-editor/web", "@tikz-editor/desktop", "@tikz-editor/ipad"];
const CARGO_SHELLS = [
  { dir: "apps/desktop/src-tauri", platform: null },
  { dir: "apps/ipad/src-tauri", platform: "aarch64-apple-ios" },
];

const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;

/** The texts of a package directory's license-like files. */
function licenseText(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => LICENSE_FILE.test(name)).sort()
    .map((name) => readFileSync(path.join(dir, name), "utf8").trim())
    .filter(Boolean);
}

function npmPackages() {
  const seen = new Map();
  for (const workspace of APP_WORKSPACES) {
    const listing = execFileSync("npm", ["ls", "-w", workspace, "--omit=dev", "--all", "--parseable"], {
      cwd: root, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"],
    });
    for (const dir of listing.split("\n").filter(Boolean)) {
      const manifestPath = path.join(dir, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      // Our own workspaces are not third-party.
      if (!manifest.name || manifest.name.startsWith("@tikz-editor/") || manifest.private) continue;
      const key = `${manifest.name}@${manifest.version}`;
      if (seen.has(key)) continue;
      const license = typeof manifest.license === "string" ? manifest.license
        : manifest.license?.type ?? (Array.isArray(manifest.licenses) ? manifest.licenses.map((entry) => entry.type).join(" OR ") : "UNKNOWN");
      seen.set(key, { name: manifest.name, version: manifest.version, license, text: licenseText(dir) });
    }
  }
  return [...seen.values()];
}

function cratePackages() {
  const seen = new Map();
  for (const shell of CARGO_SHELLS) {
    const args = ["metadata", "--format-version", "1", "--locked"];
    if (shell.platform) args.push("--filter-platform", shell.platform);
    const metadata = JSON.parse(execFileSync("cargo", args, {
      cwd: path.join(root, shell.dir), encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"],
    }));
    const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
    const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
    // Only what is linked into the app: normal dependencies, not build
    // scripts, dev dependencies or proc macros (they run at compile time).
    const queue = [metadata.resolve.root];
    const reached = new Set(queue);
    while (queue.length) {
      const node = nodes.get(queue.shift());
      for (const dep of node?.deps ?? []) {
        if (reached.has(dep.pkg)) continue;
        if (!dep.dep_kinds.some((kind) => kind.kind === null)) continue;
        const pkg = packages.get(dep.pkg);
        if (pkg?.targets.some((target) => target.kind.includes("proc-macro"))) continue;
        reached.add(dep.pkg);
        queue.push(dep.pkg);
      }
    }
    for (const id of reached) {
      const pkg = packages.get(id);
      if (!pkg || id === metadata.resolve.root) continue;
      const key = `${pkg.name}@${pkg.version}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        name: pkg.name, version: pkg.version, license: pkg.license ?? "UNKNOWN",
        text: licenseText(path.dirname(pkg.manifest_path)),
      });
    }
  }
  return [...seen.values()];
}

function notice(file) {
  return readFileSync(path.join(notices, file), "utf8").trim();
}

// The glyph outlines in packages/core/src/text/tex/fonts/data/outlines
// (scripts/generate-tex-font-data.mjs) and the bundled KaTeX fonts.
const fonts = [
  { name: "Computer Modern and AMS fonts (Type 1)", license: "OFL-1.1", text: notice("amsfonts-OFL.txt") },
  { name: "Latin Modern", license: "GUST Font License", text: notice("latin-modern-GUST-FONT-LICENSE.txt") },
  { name: "Fira Sans", license: "OFL-1.1", text: notice("fira-OFL.txt") },
  { name: "RSFS (Ralph Smith's Formal Script)", license: "Free to use and distribute", text: notice("rsfs-README.txt") },
  { name: "Beamer bibliography icons", license: "LPPL-1.3c OR GPL-2.0", text: notice("beamer-icons.txt") },
];

const bySort = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
const npm = npmPackages().sort(bySort);
const crates = cratePackages().sort(bySort);

// Many packages share a license text up to layout (each crate ships its own
// copy of the Apache license, rewrapped); store each text once, as written.
const texts = [];
const textIndex = new Map();
const tidy = (text) => text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
const refOne = (text) => {
  const tidied = tidy(text);
  const key = tidied.replace(/\s+/g, " ").toLowerCase();
  if (!textIndex.has(key)) { textIndex.set(key, texts.length); texts.push(tidied); }
  return textIndex.get(key);
};
const ref = (text) => (Array.isArray(text) ? text : [text]).map(refOne);
const entry = ({ name, version, license, text }) => ({ name, ...(version ? { version } : {}), license, text: ref(text) });

writeFileSync(output, `${JSON.stringify({
  fonts: fonts.map(entry),
  npm: npm.map(entry),
  crates: crates.map(entry),
  texts,
})}\n`);
const missing = [...npm, ...crates].filter((pkg) => !pkg.text.length).length;
console.log(`${fonts.length} fonts, ${npm.length} npm packages, ${crates.length} crates, ${texts.length} distinct texts; ${missing} without a license file (listed by name and license)`);
