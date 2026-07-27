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

async function openAuthoredSpan(page: Page, expectedText: string): Promise<Locator> {
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
    if (await textarea.count() > 0 && await textarea.inputValue() === expectedText) {
      await expect(textarea).toBeFocused();
      return textarea;
    }
    await page.keyboard.press("Escape");
  }
  throw new Error(`No editable Beamer span contained exactly ${JSON.stringify(expectedText)}.`);
}

async function dispatchPaste(page: Page, text: string): Promise<void> {
  await page.getByTestId("canvas-text-edit-textarea").evaluate((element, data) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertFromPaste",
      data
    });
    textarea.dispatchEvent(event);
  }, text);
}

async function expectCaretAndPopupToTrackEditedSpan(
  page: Page,
  textarea: Locator
): Promise<void> {
  const popup = page.getByTestId("canvas-text-edit-popup");
  const targetId = await popup.getAttribute("data-text-edit-target-id");
  if (!targetId) {
    throw new Error("Active text editor did not publish its target ID.");
  }
  const regions = page.locator(
    `[data-hit-region-target-id="${targetId}"][data-hit-region-interaction-mode="text"]`
  );
  const regionBoxes = (await Promise.all(
    Array.from({ length: await regions.count() }, (_, index) =>
      regions.nth(index).boundingBox()
    )
  )).filter((box): box is NonNullable<typeof box> => box != null);
  if (regionBoxes.length === 0) {
    throw new Error(`No visible hit geometry for active target ${targetId}.`);
  }
  const editedBounds = {
    left: Math.min(...regionBoxes.map((box) => box.x)),
    right: Math.max(...regionBoxes.map((box) => box.x + box.width)),
    top: Math.min(...regionBoxes.map((box) => box.y)),
    bottom: Math.max(...regionBoxes.map((box) => box.y + box.height))
  };

  await expect.poll(async () => {
    const popupBox = await popup.boundingBox();
    return popupBox
      ? popupBox.x + popupBox.width / 2
      : Number.NaN;
  }).toBeCloseTo((editedBounds.left + editedBounds.right) / 2, 0);

  await expect.poll(async () => (await textarea.boundingBox())?.width ?? Number.NaN)
    .toBeGreaterThanOrEqual(editedBounds.right - editedBounds.left - 1);

  await textarea.press("Home");
  await expect.poll(async () => {
    const caretBox = await page.getByTestId("canvas-text-selection-caret").boundingBox();
    return caretBox ? caretBox.x + caretBox.width / 2 : Number.NaN;
  }).toBeCloseTo(editedBounds.left, 0);

  await textarea.press("End");
  await expect.poll(async () => {
    const caretBox = await page.getByTestId("canvas-text-selection-caret").boundingBox();
    return caretBox ? caretBox.x + caretBox.width / 2 : Number.NaN;
  }).toBeCloseTo(editedBounds.right, 0);
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

test("edits authored frame-title and list text with live source sync and undo/redo", async ({ page }) => {
  let textarea = await openAuthoredSpan(page, "Titel typo ");
  await expectCaretAndPopupToTrackEditedSpan(page, textarea);
  await textarea.evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(3, 5);
    input.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertReplacementText",
      data: "le"
    }));
  });

  const titleEdited = SOURCE.replace("Titel typo", "Title typo");
  await expect.poll(() => readStoreSource(page)).toBe(titleEdited);
  await expect.poll(() => readCodeMirrorText(page)).toBe(titleEdited);
  await expect(textarea).toHaveValue("Title typo ");
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);

  await textarea.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await textarea.press(`${PRIMARY_MOD}+Shift+z`);
  await expect.poll(() => readStoreSource(page)).toBe(titleEdited);

  await page.keyboard.press("Escape");
  textarea = await openAuthoredSpan(page, "List typo");
  await textarea.selectText();
  await textarea.type("List fixed");
  const finalSource = titleEdited.replace("List typo", "List fixed");
  await expect.poll(() => readStoreSource(page)).toBe(finalSource);
  await expect.poll(() => readCodeMirrorText(page)).toBe(finalSource);
  expect(finalSource.replace("Title typo", "Titel typo").replace("List fixed", "List typo"))
    .toBe(SOURCE);
});

test("rejects structural input and exposes only visible directly-authored spans", async ({ page }) => {
  await openAuthoredSpan(page, "Titel typo ");
  await page.keyboard.press("Escape");
  await openAuthoredSpan(page, "List typo");
  await page.keyboard.press("Escape");
  await openAuthoredSpan(page, "Block typo");
  await page.keyboard.press("Escape");
  await openAuthoredSpan(page, "Block body typo");
  await page.keyboard.press("Escape");

  const generatedInvocation = SOURCE.indexOf(
    String.raw`\generatedword`,
    SOURCE.indexOf(String.raw`\begin{frame}`)
  );
  await clickRenderedSourceOffset(page, generatedInvocation);
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveCount(0);
  await expect(
    page.locator('[data-testid="canvas-svg-layer"]')
  ).not.toContainText("Hidden overlay");

  const textarea = await openAuthoredSpan(page, "Body typo.");
  await expectCaretAndPopupToTrackEditedSpan(page, textarea);
  await textarea.press("End");
  await dispatchPaste(page, "two\nlines");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await expect(textarea).toHaveValue("Body typo.");

  await textarea.press("Enter");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveCount(0);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});
