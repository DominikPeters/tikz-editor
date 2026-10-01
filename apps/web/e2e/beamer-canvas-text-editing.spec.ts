import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

import {
  gotoApp,
  readCodeMirrorText,
  readStoreSource,
  resetStorageBeforeNavigation,
  setSource
} from "./helpers";

const PRIMARY_MOD = process.platform === "darwin" ? "Meta" : "Control";
const KKT_SOURCE = readFileSync(new URL("../../../test/fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url), "utf8");

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

test("KKT display math caret and highlights align with the rendered glyphs", async ({ page }) => {
  await setSource(page, KKT_SOURCE);
  await page.getByRole("button", { name: "Problem form and notation", exact: true }).click();
  await expect.poll(() => page.locator(
    '[data-hit-region-target-id^="frame:2:"][data-hit-region-interaction-mode="text"]'
  ).count()).toBeGreaterThan(0);
  const textarea = await openScopeContaining(page, "the active set is");
  const buffer = await textarea.inputValue();
  const start = buffer.indexOf("g_i(x)=0");
  expect(start).toBeGreaterThan(0);
  const documentOffset = KKT_SOURCE.indexOf("g_i(x)=0");
  const glyph = page.locator(
    `[data-testid="canvas-svg-layer"] path[data-tex-glyph][data-source-start="${documentOffset}"][data-source-end="${documentOffset + 1}"]`
  );
  await expect(glyph).toHaveCount(1);
  const setSelection = async (end: number) => {
    await textarea.evaluate((element, selection) => {
      const input = element as HTMLTextAreaElement;
      input.focus();
      input.setSelectionRange(selection.start, selection.end);
      input.dispatchEvent(new Event("select", { bubbles: true }));
    }, { start, end });
  };

  // Compare with the actual painted path, not a point supplied by the hit map.
  await setSelection(start);
  await expect.poll(async () => {
    const painted = await glyph.boundingBox();
    const caret = await page.getByTestId("canvas-text-selection-caret").boundingBox();
    if (!painted || !caret) return false;
    const centerY = caret.y + caret.height / 2;
    return centerY >= painted.y - 1 && centerY <= painted.y + painted.height + 1;
  }).toBe(true);

  await setSelection(start + 1);
  await expect.poll(async () => {
    const painted = await glyph.boundingBox();
    if (!painted) return false;
    const rectangles = page.getByTestId("canvas-text-selection-rect");
    for (let index = 0; index < await rectangles.count(); index++) {
      const selected = await rectangles.nth(index).boundingBox();
      if (selected && selected.x <= painted.x + 1 &&
        selected.x + selected.width >= painted.x + painted.width - 1 &&
        selected.y <= painted.y + 1 &&
        selected.y + selected.height >= painted.y + painted.height - 1) return true;
    }
    return false;
  }).toBe(true);
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

test("canvas focus: structural Enter splits items, Backspace merges, Tab nests and unnests", async ({ page }) => {
  await openScopeContaining(page, "List typo");
  const hiddenInput = page.getByTestId("canvas-focus-input");
  const textarea = page.getByTestId("canvas-text-edit-textarea");

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
  // The block title's segment offset shifts with every upstream edit, so it
  // doubles as a "this source revision is rendered" signal — structural keys
  // are guarded against stale caret domains and would otherwise swallow.
  const waitForRenderOf = (source: string) =>
    expect.poll(async () =>
      page.locator(
        `[data-testid="canvas-svg-layer"] [data-source-start="${source.indexOf("Block typo")}"]`
      ).count()
    ).toBeGreaterThan(0);
  await waitForRenderOf(SOURCE);

  // Enter mid-item splits it into two items with idiomatic source, caret at
  // the new item's content start.
  let buffer = await textarea.inputValue();
  await setCaret(buffer.indexOf(" typo\n\\end{itemize}"));
  await page.keyboard.press("Enter");
  const afterSplit = SOURCE.replace("\\item List typo", "\\item List\n\\item typo");
  await expect.poll(() => readStoreSource(page)).toBe(afterSplit);
  buffer = await textarea.inputValue();
  const splitCaret = buffer.indexOf("typo\n\\end{itemize}");
  await expect.poll(readSelection).toEqual([splitCaret, splitCaret]);
  await waitForRenderOf(afterSplit);

  // Backspace at the new item's content start merges it back into the
  // previous item, restoring the original source.
  await page.keyboard.press("Backspace");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await waitForRenderOf(SOURCE);

  // Tab nests the second item into a nested itemize; Shift+Tab unwraps it.
  buffer = await textarea.inputValue();
  await setCaret(buffer.indexOf(" typo\n\\end{itemize}"));
  await page.keyboard.press("Enter");
  await expect.poll(() => readStoreSource(page)).toBe(afterSplit);
  await waitForRenderOf(afterSplit);
  await page.keyboard.press("Tab");
  const nested = afterSplit.replace(
    "\\item typo\n",
    "\\begin{itemize}\n\\item typo\n\\end{itemize}\n"
  );
  await expect.poll(() => readStoreSource(page)).toBe(nested);
  await waitForRenderOf(nested);
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => readStoreSource(page)).toBe(afterSplit);
  await waitForRenderOf(afterSplit);

  // Enter at the end of the last item opens an empty item; a second Enter
  // deletes it and exits the list onto a fresh line after the environment.
  buffer = await textarea.inputValue();
  const typoEnd = buffer.indexOf("typo\n\\end{itemize}") + "typo".length;
  await setCaret(typoEnd);
  await page.keyboard.press("Enter");
  const withEmptyItem = afterSplit.replace(
    "\\item typo\n",
    "\\item typo\n\\item \n"
  );
  await expect.poll(() => readStoreSource(page)).toBe(withEmptyItem);
  await waitForRenderOf(withEmptyItem);
  await page.keyboard.press("Enter");
  const exited = afterSplit.replace("\\end{itemize}\n", "\\end{itemize}\n\n");
  await expect.poll(() => readStoreSource(page)).toBe(exited);
  await waitForRenderOf(exited);

  // Enter in ordinary body prose breaks the paragraph with a blank line.
  buffer = await textarea.inputValue();
  await setCaret(buffer.indexOf(" typo."));
  await page.keyboard.press("Enter");
  const paragraphBreak = exited.replace("Body typo.", "Body\n\ntypo.");
  await expect.poll(() => readStoreSource(page)).toBe(paragraphBreak);

  // The whole structural sequence unwinds through session undo.
  for (const expected of [exited, withEmptyItem, afterSplit, nested, afterSplit, SOURCE, afterSplit, SOURCE]) {
    await page.keyboard.press(`${PRIMARY_MOD}+z`);
    await expect.poll(() => readStoreSource(page)).toBe(expected);
  }
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

test("selects the drawing object; Enter opens the nested figure editor", async ({ page }) => {
  await setSource(page, DRAWING_ONLY_SOURCE);

  // Since the object layer, clicking a non-text render selects the object.
  // Enter on a tikzpicture enters the nested figure editor (the Stage 3a
  // atom-span session remains only for pictures without a root id and for
  // graphics). Anchor on the tikz-specific key: the beforeEach source
  // publishes its own object regions, and a generic locator can race the
  // re-render.
  const objectRegion = page.locator(
    '[data-hit-region-deck-object-id][data-hit-region-key*="tikz"]'
  );
  await expect(objectRegion).toBeVisible({ timeout: 30_000 });
  const box = await objectRegion.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const outline = page.locator('[data-testid="deck-object-selection"] rect');
  await expect(outline).toHaveAttribute("data-deck-object-kind", "tikzpicture");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("nested-figure-breadcrumb")).toBeVisible();
  await expect(outline).toHaveCount(0);
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveCount(0);
  await page.getByTestId("nested-figure-breadcrumb-exit").click();
  await expect(page.getByTestId("nested-figure-breadcrumb")).toHaveCount(0);
});

const OBJECT_LAYER_SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Objects}
\begin{block}{Facts}
\begin{itemize}
\item Alpha one
\item Beta two
\item Gamma three
\end{itemize}
\end{block}
\end{frame}
\end{document}`;

test("object layer: Esc ladder, marker selection, duplicate and delete with undo", async ({ page }) => {
  await setSource(page, OBJECT_LAYER_SOURCE);

  const outline = page.locator('[data-testid="deck-object-selection"] rect');
  const markerRegions = page.locator('[data-hit-region-key^="deck-object-marker:"]');
  await expect.poll(async () => markerRegions.count(), { timeout: 30_000 }).toBe(3);

  // Clicking the second bullet selects its item.
  const secondMarker = markerRegions.nth(1);
  const markerBox = await secondMarker.boundingBox();
  await page.mouse.click(
    markerBox!.x + markerBox!.width / 2,
    markerBox!.y + markerBox!.height / 2
  );
  await expect(outline).toHaveAttribute("data-deck-object-kind", "item");

  // Esc walks the ladder: item → list → block → clear.
  await page.keyboard.press("Escape");
  await expect(outline).toHaveAttribute("data-deck-object-kind", "list");
  await page.keyboard.press("Escape");
  await expect(outline).toHaveAttribute("data-deck-object-kind", "block");
  await page.keyboard.press("Escape");
  await expect(outline).toHaveCount(0);

  // Enter drills back into text at the item's content start; Esc returns
  // to the same selected item (ladder rung 1 from a session).
  await page.mouse.click(
    markerBox!.x + markerBox!.width / 2,
    markerBox!.y + markerBox!.height / 2
  );
  await expect(outline).toHaveAttribute("data-deck-object-kind", "item");
  await page.keyboard.press("Enter");
  const focusInput = page.getByTestId("canvas-focus-input");
  await expect(focusInput).toBeFocused();
  const caretContext = await focusInput.evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    return input.value.slice(input.selectionStart ?? 0, (input.selectionStart ?? 0) + 4);
  });
  expect(caretContext).toBe("Beta");
  await page.keyboard.press("Escape");
  await expect(outline).toHaveAttribute("data-deck-object-kind", "item");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveCount(0);

  // Cmd/Ctrl+D duplicates the item and selects the copy.
  await page.keyboard.press(`${PRIMARY_MOD}+d`);
  await expect
    .poll(async () => (await readStoreSource(page)).match(/\\item Beta two/gu)?.length)
    .toBe(2);
  await expect(outline).toHaveAttribute("data-deck-object-kind", "item", {
    timeout: 15_000
  });

  // Delete removes the selected copy again.
  await page.keyboard.press("Backspace");
  await expect.poll(() => readStoreSource(page)).toBe(OBJECT_LAYER_SOURCE);
  await expect(outline).toHaveCount(0);

  // Block chrome click (top-right corner, clear of the title text) selects
  // the block; Delete removes the whole environment; undo restores it.
  const blockRegion = page.locator('[data-hit-region-key^="deck-object:"][data-hit-region-deck-object-id*="block"]');
  await expect(blockRegion).toHaveCount(1);
  const blockBox = await blockRegion.boundingBox();
  await page.mouse.click(blockBox!.x + blockBox!.width - 6, blockBox!.y + 5);
  await expect(outline).toHaveAttribute("data-deck-object-kind", "block");
  await page.keyboard.press("Delete");
  await expect.poll(() => readStoreSource(page)).not.toContain("Facts");
  await page.keyboard.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(OBJECT_LAYER_SOURCE);
});

test("deck inspector: frame options with no selection, object properties when selected", async ({ page }) => {
  await setSource(page, OBJECT_LAYER_SOURCE);

  // With nothing selected the inspector shows the frame options (never the
  // frame title — that is edited on canvas).
  const alignmentDropdown = page.getByRole("button", { name: "Alignment" });
  await expect(alignmentDropdown).toBeVisible();
  await alignmentDropdown.click();
  await page.getByRole("option", { name: "Top" }).click();
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`\begin{frame}[t]{Objects}`);

  // Selecting an item swaps the inspector to the object: free-text overlay
  // spec commits on Enter.
  const markerRegions = page.locator('[data-hit-region-key^="deck-object-marker:"]');
  await expect.poll(async () => markerRegions.count(), { timeout: 30_000 }).toBe(3);
  const markerBox = await markerRegions.nth(1).boundingBox();
  await page.mouse.click(
    markerBox!.x + markerBox!.width / 2,
    markerBox!.y + markerBox!.height / 2
  );
  const overlayInput = page.getByPlaceholder("e.g. 2-");
  await expect(overlayInput).toBeVisible();
  await overlayInput.fill("2-");
  await overlayInput.press("Enter");
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`\item<2-> Beta two`);

  // Block selection exposes title and type; the type dropdown renames the
  // environment at both boundaries.
  const blockRegion = page.locator('[data-hit-region-key^="deck-object:"][data-hit-region-deck-object-id*="block"]');
  const blockBox = await blockRegion.boundingBox();
  await page.mouse.click(blockBox!.x + blockBox!.width - 6, blockBox!.y + 5);
  const outline = page.locator('[data-testid="deck-object-selection"] rect');
  await expect(outline).toHaveAttribute("data-deck-object-kind", "block");
  const titleInput = page.getByRole("textbox", { name: "Title" });
  await expect(titleInput).toHaveValue("Facts");
  await titleInput.fill("Key facts");
  await titleInput.press("Enter");
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`\begin{block}{Key facts}`);
  const typeDropdown = page.getByRole("button", { name: "Type" });
  await typeDropdown.click();
  await page.getByRole("option", { name: "alertblock" }).click();
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`\begin{alertblock}{Key facts}`);
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`\end{alertblock}`);
});

test("format toolbar: wrap toggles, shortcut, color menu, and list buttons", async ({ page }) => {
  const textarea = await openScopeContaining(page, "Body typo.");

  const selectInBuffer = async (needle: string, length = needle.length) => {
    const buffer = await textarea.inputValue();
    const start = buffer.indexOf(needle);
    expect(start).toBeGreaterThanOrEqual(0);
    await textarea.evaluate((element, args) => {
      const input = element as HTMLTextAreaElement;
      input.focus();
      input.setSelectionRange(args.start, args.end);
      input.dispatchEvent(new Event("select", { bubbles: true }));
    }, { start, end: start + length });
  };

  // Bold wraps the selection; the button reports active; Cmd+B unwraps it
  // through the shared shortcut path.
  await selectInBuffer("typo", 4);
  const bold = page.getByTestId("text-format-bold");
  await expect(bold).toBeEnabled();
  await bold.click();
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`Body \textbf{typo}.`);
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press(`${PRIMARY_MOD}+b`);
  await expect.poll(() => readStoreSource(page)).toContain("Body typo.");

  // The color menu applies \textcolor; picking another swatch replaces the
  // color argument in place; Remove color unwraps.
  // The floating swatch menu defeats Playwright's stability heuristics, so
  // menu interactions dispatch clicks directly; the pointer path is covered
  // by the toolbar buttons above.
  await selectInBuffer("typo", 4);
  await page.getByTestId("text-format-color").dispatchEvent("click");
  await page.getByTestId("text-format-color-blue").dispatchEvent("click");
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`Body \textcolor{blue}{typo}.`);
  await page.getByTestId("text-format-color").dispatchEvent("click");
  await page.getByTestId("text-format-color-red").dispatchEvent("click");
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`Body \textcolor{red}{typo}.`);
  await page.getByTestId("text-format-color").dispatchEvent("click");
  await page.getByTestId("text-format-color-none").dispatchEvent("click");
  await expect.poll(() => readStoreSource(page)).toContain("Body typo.");

  // List buttons: a caret in the itemize item lights the bullets button;
  // Numbered renames the environment; clicking the active kind dissolves
  // the item back into prose; Bulleted on prose re-creates a list.
  await selectInBuffer("List typo", 0);
  const bullets = page.getByTestId("text-format-bullets");
  const numbered = page.getByTestId("text-format-numbered");
  await expect(bullets).toHaveAttribute("aria-pressed", "true");
  await numbered.click();
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`\begin{enumerate}`);
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`\end{enumerate}`);
  await expect(numbered).toHaveAttribute("aria-pressed", "true");
  await numbered.click();
  await expect.poll(() => readStoreSource(page)).not.toContain(String.raw`\begin{enumerate}`);
  await expect.poll(() => readStoreSource(page)).toContain("List typo");
  await selectInBuffer("List typo", 0);
  await bullets.click();
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`\item List typo`);
  await expect.poll(() => readStoreSource(page)).toContain(String.raw`\begin{itemize}`);
});

test("nested figure editing: enter, edit the picture, and exit back to the deck", async ({ page }) => {
  const NESTED_SOURCE = [
    "\\documentclass{beamer}",
    "\\begin{document}",
    "\\begin{frame}{Nested demo}",
    "Intro line before the picture.",
    "\\begin{tikzpicture}",
    "\\node[draw, fill=blue!20] (a) at (0,0) {Alpha};",
    "\\node[draw] (b) at (3,1) {Beta};",
    "\\draw[->] (a) -- (b);",
    "\\end{tikzpicture}",
    "Text after the picture.",
    "\\end{frame}",
    "\\end{document}",
  ].join("\n");
  await setSource(page, NESTED_SOURCE);

  const activeRootId = () =>
    page.evaluate(() =>
      (window as unknown as {
        __TIKZ_EDITOR_APP_TEST_API__: { getActiveFigureId: () => string | null };
      }).__TIKZ_EDITOR_APP_TEST_API__.getActiveFigureId()
    );

  // Enter by double-clicking the embedded picture's object region.
  const pictureRegion = page.locator(
    '[data-hit-region-key^="deck-object:"][data-hit-region-deck-object-id*="tikz"]'
  );
  await expect.poll(async () => pictureRegion.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  const box = (await pictureRegion.first().boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("nested-figure-breadcrumb")).toBeVisible();
  await expect.poll(activeRootId).toBe("frame:0:tikzpicture:0");
  // Deck chrome is gone while nested.
  await expect(page.getByTestId("deck-step-scrubber")).toHaveCount(0);

  // Drag the Alpha node by its element hit region (the node's center is
  // its text region, so press near the border), and the REAL source
  // updates through the masked apply + patch replay.
  const alphaRegion = page
    .locator('[data-hit-region-target-id="path:0"]:not([data-hit-region-interaction-mode="text"])')
    .first();
  await expect.poll(async () => alphaRegion.count()).toBeGreaterThan(0);
  const alphaBox = (await alphaRegion.boundingBox())!;
  const startX = alphaBox.x + 3;
  const startY = alphaBox.y + alphaBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).not.toContain("(a) at (0,0)");
  await expect.poll(() => readStoreSource(page)).toContain("\\documentclass{beamer}");
  await expect.poll(() => readStoreSource(page)).toContain("Text after the picture.");

  // Breadcrumb exits back to the slide; deck chrome returns.
  await page.getByTestId("nested-figure-breadcrumb-exit").click();
  await expect(page.getByTestId("nested-figure-breadcrumb")).toHaveCount(0);
  await expect.poll(activeRootId).toBe("frame:0");

  // Re-enter with Enter on the selected picture, then the Esc ladder
  // (clear selection, then exit) walks back out.
  await expect.poll(async () => pictureRegion.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  const box2 = (await pictureRegion.first().boundingBox())!;
  await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await expect(
    page.locator('[data-testid="deck-object-selection"] rect')
  ).toHaveAttribute("data-deck-object-kind", "tikzpicture");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("nested-figure-breadcrumb")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("nested-figure-breadcrumb")).toHaveCount(0);
  await expect.poll(activeRootId).toBe("frame:0");
});
