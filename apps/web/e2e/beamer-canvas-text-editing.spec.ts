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
 * Clicking slide text gives the canvas surface the keyboard, so the hidden
 * canvas input (not the bar textarea) holds DOM focus on return.
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
      await expect(page.getByTestId("canvas-focus-input")).toBeFocused();
      return textarea;
    }
    await closeScopeSession(page);
  }
  throw new Error(`No Beamer edit scope buffer contained ${JSON.stringify(expectedNeedle)}.`);
}

/**
 * Esc steps outward one surface at a time: bar focus hands the keyboard back
 * to the canvas surface, canvas focus closes the session. Press until the
 * session is gone regardless of which surface currently holds focus.
 */
async function closeScopeSession(page: Page): Promise<void> {
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  for (let press = 0; press < 2 && (await textarea.count()) > 0; press += 1) {
    await page.keyboard.press("Escape");
  }
  await expect(textarea).toHaveCount(0);
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

  await closeScopeSession(page);

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

  // A caret on structural source (here: the newline before any rendered
  // paragraph, and the \begin{itemize} line) collapses onto the nearest
  // rendered stop instead of clearing the canvas caret.
  for (const structuralOffset of [0, bufferText.indexOf(String.raw`\begin{itemize}`) + 1]) {
    await textarea.evaluate((element, offset) => {
      const input = element as HTMLTextAreaElement;
      input.focus();
      input.setSelectionRange(offset, offset);
      input.dispatchEvent(new Event("select", { bubbles: true }));
    }, structuralOffset);
    await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);
  }

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
  await closeScopeSession(page);

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

test("canvas focus: types on the slide, Cmd+E and Esc walk the surfaces, indication follows", async ({ page }) => {
  const textarea = await openScopeContaining(page, "Body typo.");
  const hiddenInput = page.getByTestId("canvas-focus-input");
  const popup = page.getByTestId("canvas-text-edit-popup");

  // Entry state: canvas surface owns the keyboard, the bar shows unfocused
  // chrome, and the dashed scope border marks the editable container.
  await expect(hiddenInput).toBeFocused();
  await expect(popup).toHaveAttribute("data-text-edit-focus", "canvas");
  await expect(page.getByTestId("canvas-scope-edit-border")).toHaveCount(1);

  // Typing goes to the slide without touching the bar; both surfaces mirror
  // the same buffer (safety property: typing is identical in both).
  const bufferText = await textarea.inputValue();
  const caret = bufferText.indexOf("Body typo") + "Body typo".length;
  await hiddenInput.evaluate((element, offset) => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(offset, offset);
  }, caret);
  await page.keyboard.type("x");
  await expect.poll(() => readStoreSource(page)).toContain("Body typox.");
  await expect(textarea).toHaveValue(bufferText.replace("Body typo.", "Body typox."));
  await expect(hiddenInput).toBeFocused();

  // A range selection renders gray (inactive) in the unfocused bar.
  await hiddenInput.evaluate((element, offset) => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(offset - "Body typo".length, offset + 1);
    input.dispatchEvent(new Event("select", { bubbles: true }));
  }, caret);
  await expect
    .poll(async () => page.getByTestId("canvas-text-edit-inactive-selection-rect").count())
    .toBeGreaterThan(0);

  // Cmd+E hands the keyboard to the bar at the same caret.
  await page.keyboard.press(`${PRIMARY_MOD}+e`);
  await expect(textarea).toBeFocused();
  await expect(popup).toHaveAttribute("data-text-edit-focus", "bar");
  await expect(page.getByTestId("canvas-text-edit-inactive-selection-rect")).toHaveCount(0);
  await expect(page.getByTestId("canvas-scope-edit-border")).toHaveCount(1);

  // Esc from the bar returns to canvas focus with the session open ...
  await page.keyboard.press("Escape");
  await expect(hiddenInput).toBeFocused();
  await expect(popup).toHaveAttribute("data-text-edit-focus", "canvas");
  await expect(textarea).toHaveCount(1);

  // ... and Esc from canvas focus closes the session.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveCount(0);
  await expect(page.getByTestId("canvas-focus-input")).toHaveCount(0);
  await expect(page.getByTestId("canvas-scope-edit-border")).toHaveCount(0);
});

test("canvas focus: arrows move by rendered stops, rows, and select-then-delete atoms", async ({ page }) => {
  const titleTextarea = await openScopeContaining(page, "Titel typo");
  const hiddenInput = page.getByTestId("canvas-focus-input");
  const titleBuffer = await titleTextarea.inputValue();
  expect(titleBuffer).toBe(String.raw`Titel typo \generatedword`);

  const readSelection = () => hiddenInput.evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    return [input.selectionStart, input.selectionEnd];
  });
  const setCaret = (offset: number) => hiddenInput.evaluate((element, value) => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(value, value);
    input.dispatchEvent(new Event("select", { bubbles: true }));
  }, offset);

  // Arrow motion is atomic over a macro invocation: one step crosses the
  // whole \generatedword call in either direction.
  const invocationStart = titleBuffer.indexOf(String.raw`\generatedword`);
  await setCaret(invocationStart);
  await page.keyboard.press("ArrowRight");
  await expect.poll(readSelection).toEqual([titleBuffer.length, titleBuffer.length]);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(readSelection).toEqual([invocationStart, invocationStart]);

  // Backspace beside the atom selects it first (select-then-delete), and
  // the second press deletes the whole invocation; undo restores it.
  await setCaret(titleBuffer.length);
  await page.keyboard.press("Backspace");
  await expect.poll(readSelection).toEqual([invocationStart, titleBuffer.length]);
  await page.keyboard.press("Backspace");
  await expect.poll(() => readStoreSource(page)).toBe(
    SOURCE.replace(String.raw`Titel typo \generatedword`, "Titel typo ")
  );
  await page.keyboard.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await closeScopeSession(page);

  // Vertical motion walks rendered rows: down from the body paragraph lands
  // inside the list item's rendered text, skipping structural source.
  const bodyTextarea = await openScopeContaining(page, "Body typo.");
  const bodyBuffer = await bodyTextarea.inputValue();
  const bodyStart = bodyBuffer.indexOf("Body typo.");
  const listStart = bodyBuffer.indexOf("List typo");
  await setCaret(bodyStart);
  await page.keyboard.press("ArrowDown");
  await expect.poll(readSelection).toEqual([
    expect.any(Number),
    expect.any(Number),
  ]);
  const [downOffset] = await readSelection();
  expect(downOffset).toBeGreaterThanOrEqual(listStart);
  expect(downOffset).toBeLessThanOrEqual(listStart + "List typo".length);

  // Home/End clamp to the rendered row, not the buffer line.
  await page.keyboard.press("End");
  await expect.poll(readSelection).toEqual([
    listStart + "List typo".length,
    listStart + "List typo".length,
  ]);
  await page.keyboard.press("Home");
  await expect.poll(readSelection).toEqual([listStart, listStart]);

  // Shift extends over rendered stops.
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(readSelection).toEqual([listStart, listStart + 1]);
  await expect(page.getByTestId("canvas-text-selection-overlay")).toHaveCount(1);
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
  await closeScopeSession(page);

  const instituteTextarea = await openScopeContaining(
    page,
    "Analytical Engine Institute"
  );
  await expect(instituteTextarea).toHaveValue("Analytical Engine Institute");
});

const DRAWING_ONLY_SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Drawing only}
\begin{center}
\begin{tikzpicture}
\draw[very thick] (0,0) rectangle (4,2);
\end{tikzpicture}
\end{center}
\end{frame}
\end{document}`;

test("selects the drawing atom in a frame without rendered paragraphs", async ({ page }) => {
  await setSource(page, DRAWING_ONLY_SOURCE);

  // The frame body renders no paragraphs, so the tikzpicture atom itself
  // must anchor the scope session.
  const atomRegion = page.locator('[data-hit-region-key^="deck-atom:"]').first();
  await expect(atomRegion).toBeVisible({ timeout: 30_000 });
  const box = await atomRegion.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveCount(1);
  const buffer = await textarea.inputValue();
  expect(buffer).toContain(String.raw`\begin{tikzpicture}`);
  const selection = await textarea.evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  });
  expect(selection).toContain(String.raw`\begin{tikzpicture}`);
  expect(selection).toContain(String.raw`\end{tikzpicture}`);
});
