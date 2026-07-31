import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  gotoApp,
  readCodeMirrorText,
  readStoreSource,
  resetStorageBeforeNavigation,
  setSource
} from "./helpers";

const PRIMARY_MOD = process.platform === "darwin" ? "Meta" : "Control";

const SOURCE = String.raw`\documentclass{beamer}
\newcommand{\generatedword}{Generated}
\begin{document}
\begin{frame}{Titel typo \generatedword}
Body typo.
\begin{itemize}
\item List typo
\end{itemize}
\begin{block}{Block typo}
Block body typo
\end{block}
\only<2->{Hidden overlay}
\[
  x + y
\]
\end{frame}
\begin{frame}{Later frame}
Later body
\end{frame}
\end{document}`;

const BODY_SCOPE_TEXT = String.raw`
Body typo.
\begin{itemize}
\item List typo
\end{itemize}
\begin{block}{Block typo}
Block body typo
\end{block}
\only<2->{Hidden overlay}
\[
  x + y
\]
`;

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
});

function deckTextRegions(page: Page): Locator {
  return page.locator(
    '[data-hit-region-target-id][data-hit-region-interaction-mode="text"]'
  );
}

/**
 * Clicks deck text regions until a scope session whose buffer contains
 * `expectedNeedle` opens, and returns the session textarea. One session per
 * scope: the buffer is the scope's full source span, not a fragment.
 */
async function openScopeContaining(page: Page, expectedNeedle: string): Promise<Locator> {
  await expect.poll(async () => deckTextRegions(page).count(), {
    timeout: 30_000
  }).toBeGreaterThan(0);

  const targetIds = await deckTextRegions(page).evaluateAll((regions) =>
    [...new Set(regions.map((region) =>
      region.getAttribute("data-hit-region-target-id")
    ).filter((value): value is string => value != null))]
  );
  for (const targetId of targetIds) {
    const candidate = page.locator(
      `[data-hit-region-target-id="${targetId}"][data-hit-region-interaction-mode="text"]`
    ).first();
    const box = await candidate.boundingBox();
    if (!box) {
      continue;
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const textarea = page.getByTestId("canvas-text-edit-textarea");
    if (await textarea.count() > 0 && (await textarea.inputValue()).includes(expectedNeedle)) {
      await expect(textarea).toBeFocused();
      return textarea;
    }
    await page.keyboard.press("Escape");
  }
  throw new Error(`No Beamer edit scope buffer contained ${JSON.stringify(expectedNeedle)}.`);
}

async function replaceRange(
  page: Page,
  textarea: Locator,
  start: number,
  end: number,
  data: string
): Promise<void> {
  await textarea.evaluate((element, args) => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(args.start, args.end);
    input.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertReplacementText",
      data: args.data
    }));
  }, { start, end, data });
}

async function clickRenderedSourceOffset(page: Page, sourceOffset: number): Promise<void> {
  const candidates = page.locator(
    `[data-testid="canvas-svg-layer"] [data-source-start="${sourceOffset}"]`
  );
  await expect.poll(async () => candidates.count()).toBeGreaterThan(0);
  for (let index = 0; index < await candidates.count(); index += 1) {
    const box = await candidates.nth(index).boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
  }
  throw new Error(`No visible rendered source geometry starts at ${sourceOffset}.`);
}

test("opens scope-wide sessions and edits title and list text with undo/redo", async ({ page }) => {
  const titleTextarea = await openScopeContaining(page, "Titel typo");
  // The frame-title scope buffer is the whole title argument, including
  // content that is not directly editable (the macro invocation).
  await expect(titleTextarea).toHaveValue(String.raw`Titel typo \generatedword`);

  // Caret tracking: buffer offset 0 renders a canvas caret at the title's
  // left edge.
  const titleRegions = page.locator(
    '[data-hit-region-target-id$=":scope:title"][data-hit-region-interaction-mode="text"]'
  );
  const titleBoxes = (await Promise.all(
    Array.from({ length: await titleRegions.count() }, (_, index) =>
      titleRegions.nth(index).boundingBox()
    )
  )).filter((box): box is NonNullable<typeof box> => box != null);
  const titleLeft = Math.min(...titleBoxes.map((box) => box.x));
  await titleTextarea.press("Home");
  await expect.poll(async () => {
    const caretBox = await page.getByTestId("canvas-text-selection-caret").boundingBox();
    return caretBox ? caretBox.x + caretBox.width / 2 : Number.NaN;
  }).toBeCloseTo(titleLeft, 0);

  await replaceRange(page, titleTextarea, 3, 5, "le");
  const titleEdited = SOURCE.replace("Titel typo", "Title typo");
  await expect.poll(() => readStoreSource(page)).toBe(titleEdited);
  await expect.poll(() => readCodeMirrorText(page)).toBe(titleEdited);
  await expect(titleTextarea).toHaveValue(String.raw`Title typo \generatedword`);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);

  await titleTextarea.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await titleTextarea.press(`${PRIMARY_MOD}+Shift+z`);
  await expect.poll(() => readStoreSource(page)).toBe(titleEdited);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveCount(0);

  // The whole frame body is one scope: list items, blocks, and structural
  // source share a single session buffer.
  const bodyTextarea = await openScopeContaining(page, "List typo");
  await expect(bodyTextarea).toHaveValue(BODY_SCOPE_TEXT);
  const bufferText = await bodyTextarea.inputValue();
  const listStart = bufferText.indexOf("List typo");
  await replaceRange(page, bodyTextarea, listStart, listStart + "List typo".length, "List fixed");
  const finalSource = titleEdited.replace("List typo", "List fixed");
  await expect.poll(() => readStoreSource(page)).toBe(finalSource);
  await expect.poll(() => readCodeMirrorText(page)).toBe(finalSource);
});

test("keeps structure stable through transiently invalid source and supports structural edits", async ({ page }) => {
  const textarea = await openScopeContaining(page, "Body typo.");
  const bufferText = await textarea.inputValue();

  const readParagraphTopology = () =>
    page.locator('[data-testid="canvas-svg-layer"] g[data-paragraph-id]').evaluateAll(
      (elements) => elements.map((element) => element.getAttribute("data-paragraph-id"))
    );
  const stableTopology = await readParagraphTopology();
  expect(stableTopology.length).toBeGreaterThan(2);

  // Type a lone backslash inside the "Body typo." run: the source becomes
  // transiently invalid TeX, but the structural mask must keep the rest of
  // the frame from restructuring mid-keystroke — same flow nodes, same ids.
  const caret = bufferText.indexOf("Body ty") + 2;
  await textarea.evaluate((element, offset) => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(offset, offset);
  }, caret);
  await textarea.press("\\");
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`Bo\dy typo.`);
  await expect.poll(readParagraphTopology).toEqual(stableTopology);
  await textarea.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);

  // Enter is a source newline in a scope session, not a session close.
  const afterBody = bufferText.indexOf("Body typo.") + "Body typo.".length;
  await textarea.evaluate((element, offset) => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(offset, offset);
  }, afterBody);
  await textarea.press("Enter");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveCount(1);
  await expect.poll(() => readStoreSource(page)).toBe(
    SOURCE.replace("Body typo.\n", "Body typo.\n\n")
  );
  await textarea.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await page.keyboard.press("Escape");

  // Macro output is an atomic render: clicking it opens the owning scope
  // session with the whole invocation selected.
  const generatedInvocation = SOURCE.indexOf(
    String.raw`\generatedword`,
    SOURCE.indexOf(String.raw`\begin{frame}`)
  );
  await clickRenderedSourceOffset(page, generatedInvocation);
  const atomTextarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(atomTextarea).toHaveCount(1);
  await expect(atomTextarea).toHaveValue(String.raw`Titel typo \generatedword`);
  const titleBuffer = String.raw`Titel typo \generatedword`;
  await expect.poll(async () => atomTextarea.evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    return [input.selectionStart, input.selectionEnd];
  })).toEqual([
    titleBuffer.indexOf(String.raw`\generatedword`),
    titleBuffer.length
  ]);
});

const TITLE_PAGE_SOURCE = String.raw`\documentclass{beamer}
\usetheme{Madrid}
\title{Deck title}
\subtitle{Deck subtitle}
\author{Ada Lovelace}
\institute{Analytical Engine Institute}
\date{December 1843}
\begin{document}
\begin{frame}
\titlepage
\end{frame}
\end{document}`;

test("edits title-page metadata through preamble field scopes", async ({ page }) => {
  await setSource(page, TITLE_PAGE_SOURCE);

  // Each metadata field is its own scope whose buffer is the preamble
  // argument content.
  const authorTextarea = await openScopeContaining(page, "Ada Lovelace");
  await expect(authorTextarea).toHaveValue("Ada Lovelace");
  await replaceRange(page, authorTextarea, 0, "Ada".length, "Augusta");
  const edited = TITLE_PAGE_SOURCE.replace("Ada Lovelace", "Augusta Lovelace");
  await expect.poll(() => readStoreSource(page)).toBe(edited);
  await expect.poll(() => readCodeMirrorText(page)).toBe(edited);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveCount(0);

  const instituteTextarea = await openScopeContaining(
    page,
    "Analytical Engine Institute"
  );
  await expect(instituteTextarea).toHaveValue("Analytical Engine Institute");
});
