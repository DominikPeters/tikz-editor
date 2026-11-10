import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { classifyCiChanges } from "../scripts/ci-changes.mjs";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("CI change coverage", () => {
  it("keeps marketing-only pushes out of desktop, browser and TeX campaigns", () => {
    expect(classifyCiChanges(["apps/landing/src/App.tsx", "apps/landing/src/app.css"])).toEqual({
      checks: true, unit: false, web: false, desktop: false, images: false, landing: true, ipad: false,
    });
  });
  it("lets documentation changes finish through the CI result check", () => {
    expect(Object.values(classifyCiChanges(["README.md", "apps/desktop/README.md", "packages/core/README.md", "design/beamer-editor.md"]))).not.toContain(true);
    expect(classifyCiChanges(["apps/landing/src/help.md"]).landing).toBe(true);
  });
  it("runs all consumers when a shared renderer or lockfile changes", () => {
    for (const path of ["packages/core/src/beamer/render.ts", "packages/lezer-tex/src/grammar/tex.grammar", "package-lock.json", ".github/workflows/ci.yml"]) {
      expect(Object.values(classifyCiChanges([path])), path).not.toContain(false);
    }
  });
  it("runs UI consumers without unrelated independent TeX comparisons", () => {
    expect(classifyCiChanges(["packages/app/src/ui/canvas-panel/CanvasPanel.tsx"])).toEqual({
      checks: true, unit: true, web: true, desktop: true, images: false, landing: true, ipad: true,
    });
    expect(classifyCiChanges(["packages/app/src/image-asset-cache.ts"]).images).toBe(true);
  });
  it("keeps shell changes isolated to their shell and unit checks", () => {
    expect(classifyCiChanges(["apps/desktop/src-tauri/src/lib.rs"])).toEqual({
      checks: true, unit: true, web: false, desktop: true, images: false, landing: false, ipad: false,
    });
    expect(classifyCiChanges(["apps/ipad/vite.config.ts"]).ipad).toBe(true);
    expect(classifyCiChanges(["apps/web/e2e/beamer-pdf-image.spec.ts"]).web).toBe(true);
  });
  it("covers independent oracle inputs and imported fixture assets", () => {
    for (const path of ["scripts/lib/tex-fuzz-image-paint.mjs", "test/tex-fuzz-image-paint.spec.ts", "test/fixtures/graphics-fuzz/fuzz-images/pages.pdf", ".github/workflows/image-fidelity.yml"]) {
      expect(classifyCiChanges([path]).images, path).toBe(true);
    }
  });
  it("does not let future packages or unknown build configuration bypass CI", () => {
    for (const path of ["packages/new-renderer/src/index.ts", "apps/new-shell/src/main.ts", "new-build.config.json"]) {
      expect(Object.values(classifyCiChanges([path])), path).not.toContain(false);
    }
  });

  function repository() {
    const directory = mkdtempSync(join(tmpdir(), "tikz-ci-paths-")); directories.push(directory);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-b", "main");
    const commit = (message: string) => {
      git("add", "."); git("-c", "user.name=CI tests", "-c", "user.email=ci@example.test", "-c", "commit.gpgsign=false", "commit", "-m", message);
      return git("rev-parse", "HEAD");
    };
    const classify = (event: unknown, name: string) => {
      const eventPath = join(directory, "event.json"), output = join(directory, "output.txt");
      writeFileSync(eventPath, JSON.stringify(event)); writeFileSync(output, "");
      execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/ci-changes.mjs", import.meta.url))], {
        cwd: directory, env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: name, GITHUB_OUTPUT: output }, stdio: "pipe",
      });
      return Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map(line => line.split("=")));
    };
    return { directory, git, commit, classify };
  }

  it("classifies an entire push, including the deleted side of a rename", () => {
    const { directory, git, commit, classify } = repository();
    writeFileSync(join(directory, "renderer.ts"), "export const renderer = 1;\n");
    const before = commit("renderer");
    git("mv", "renderer.ts", "README.md"); const after = commit("move renderer");
    expect(Object.values(classify({ before, after }, "push"))).not.toContain("false");
  });
  it("compares a pull request against its merge base, not unrelated base-branch edits", () => {
    const { directory, git, commit, classify } = repository();
    writeFileSync(join(directory, "README.md"), "base\n"); commit("base");
    git("checkout", "-b", "feature");
    writeFileSync(join(directory, "README.md"), "documentation\n"); const head = commit("docs");
    git("checkout", "main");
    writeFileSync(join(directory, "package-lock.json"), "{}\n"); const base = commit("unrelated dependencies");
    expect(Object.values(classify({ pull_request: { base: { sha: base }, head: { sha: head } } }, "pull_request"))).not.toContain("true");
  });
  it("runs everything for a new branch, a missing force-push base, or a manual run", () => {
    const { directory, commit, classify } = repository();
    writeFileSync(join(directory, "README.md"), "base\n"); const after = commit("base");
    for (const [event, name] of [[{ before: "0".repeat(40), after }, "push"], [{ before: "1".repeat(40), after }, "push"], [{}, "workflow_dispatch"]] as const) {
      expect(Object.values(classify(event, name))).not.toContain("false");
    }
  });
});
