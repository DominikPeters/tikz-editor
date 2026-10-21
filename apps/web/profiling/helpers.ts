import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { parseTikz, type Statement } from "@tikz-editor/core";
import { readActiveFigureId, readFigureCount } from "../e2e/helpers";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TRACES_DIR = path.join(THIS_DIR, "traces");
export const PAPER_PATH = path.resolve(THIS_DIR, "../../../test/papers/equal_shares_arxiv_v2.tex");

export type PaperTarget = {
  source: string;
  targetLine: string;
  targetOffset: number;
  activeRootId: string;
  activeFigureNumber: number;
  targetSourceId: string;
};

function findStatementContainingOffset(statements: readonly Statement[], offset: number): Statement | null {
  for (const statement of statements) {
    if (offset < statement.span.from || offset >= statement.span.to) {
      continue;
    }
    if (statement.kind === "Scope") {
      return findStatementContainingOffset(statement.body, offset) ?? statement;
    }
    return statement;
  }
  return null;
}

export function resolvePaperTarget(targetLines: string | readonly string[]): PaperTarget {
  const lines = typeof targetLines === "string" ? [targetLines] : targetLines;
  const source = fs.readFileSync(PAPER_PATH, "utf8");
  const targetLine = lines.find((line) => source.includes(line));
  if (!targetLine) {
    throw new Error(`Target draw line not found in ${PAPER_PATH}`);
  }

  const targetOffset = source.indexOf(targetLine);
  const fullParse = parseTikz(source, { recover: true, includeContextDefinitions: true });
  const figure = fullParse.figures.find((candidate) => targetOffset >= candidate.span.from && targetOffset < candidate.span.to);
  if (!figure) {
    throw new Error(`Could not resolve figure containing target line in ${PAPER_PATH}`);
  }
  const activeFigureNumber = fullParse.figures.findIndex((candidate) => candidate.id === figure.id) + 1;
  if (activeFigureNumber <= 0) {
    throw new Error(`Could not resolve figure number for ${figure.id}`);
  }

  const activeParse = parseTikz(source, {
    recover: true,
    includeContextDefinitions: true,
    activeFigureId: figure.id
  });
  const targetStatement = findStatementContainingOffset(activeParse.figure.body, targetOffset);
  if (!targetStatement || targetStatement.kind !== "Path") {
    throw new Error(`Could not resolve path statement containing target line in ${PAPER_PATH}`);
  }

  return {
    source,
    targetLine,
    targetOffset,
    activeRootId: figure.id,
    activeFigureNumber,
    targetSourceId: targetStatement.id
  };
}

export async function seedWorkspace(
  page: import("@playwright/test").Page,
  target: PaperTarget,
  docId: string
): Promise<void> {
  await page.addInitScript(({ source, activeRootId, id }) => {
    const payload = {
      workspaceVersion: 3,
      documents: [
        {
          id,
          title: "equal_shares_arxiv_v2.tex",
          source,
          activeRootId,
          savedSource: source,
          fileRef: null,
          assistantThreadId: null,
          assistantWorkspacePath: null,
          assistantFigurePath: null,
          assistantPreviewPath: null
        }
      ],
      tabOrder: [id],
      activeDocumentId: id,
      recentDocumentIds: [id]
    };
    localStorage.setItem("tikz-editor:workspace", JSON.stringify(payload));
  }, {
    source: target.source,
    activeRootId: target.activeRootId,
    id: docId
  });
}

export async function startCDPProfile(page: import("@playwright/test").Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("Profiler.enable");
  await client.send("Profiler.start");
  return client;
}

export async function stopCDPProfile(
  client: import("playwright-core").CDPSession,
  filename: string
): Promise<string> {
  const { profile } = await client.send("Profiler.stop");
  await client.send("Profiler.disable");

  fs.mkdirSync(TRACES_DIR, { recursive: true });
  const outPath = path.join(TRACES_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(profile, null, 2), "utf8");
  return outPath;
}

export async function resolveVisibleSamplePointForSelector(
  page: import("@playwright/test").Page,
  selector: string
): Promise<{ x: number; y: number }> {
  return await page.evaluate((rawSelector) => {
    const elements = Array.from(document.querySelectorAll(rawSelector));
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const visible =
        (rect.width > 0 || rect.height > 0) &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0;
      if (!visible) {
        continue;
      }

      const fallback = () => ({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      });

      if (element instanceof SVGGeometryElement && typeof element.getTotalLength === "function") {
        try {
          const length = element.getTotalLength();
          const sample = element.getPointAtLength(Math.min(Math.max(length * 0.25, 1), Math.max(length - 1, 1)));
          const svg = element.ownerSVGElement;
          const ctm = element.getScreenCTM();
          if (!svg || !ctm) {
            return fallback();
          }
          const point = svg.createSVGPoint();
          point.x = sample.x;
          point.y = sample.y;
          const screen = point.matrixTransform(ctm);
          return { x: screen.x, y: screen.y };
        } catch {
          return fallback();
        }
      }

      return fallback();
    }
    throw new Error(`No visible element matched selector: ${rawSelector}`);
  }, selector);
}

export async function clearSelection(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: { clearSelection?: () => void };
    }).__TIKZ_EDITOR_APP_TEST_API__?.clearSelection?.();
  });
}

/**
 * Waits for the target figure to be active in the figure navigator.
 * Does NOT wait for the SVG to render — each script polls for its own
 * ready condition after calling this.
 */
export async function waitForActiveFigure(
  page: import("@playwright/test").Page,
  target: PaperTarget
): Promise<void> {
  const figureButton = page.getByRole("button", { name: `Figure ${target.activeFigureNumber}` });
  await expect.poll(async () => readFigureCount(page), {
    timeout: 60_000,
    message: "waiting for figure navigator to populate"
  }).toBeGreaterThanOrEqual(target.activeFigureNumber);
  await expect(figureButton).toBeVisible({ timeout: 60_000 });

  const currentActiveFigureId = await readActiveFigureId(page);
  if (currentActiveFigureId !== target.activeRootId) {
    await figureButton.click();
  }

  await expect.poll(async () => readActiveFigureId(page), {
    timeout: 60_000,
    message: "waiting for target active figure"
  }).toBe(target.activeRootId);
}
