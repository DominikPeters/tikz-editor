import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\section{One}
% Keep with A
\begin{frame}[label=a]{A}First.\only<2>{Later.}\end{frame}
\begin{frame}{B}\hyperlink{a}{Back}\end{frame}
\section{Two}
\subsection{Details}
\begin{frame}{C}Third.\end{frame}
\begin{frame}{D}Fourth.\end{frame}
\end{document}`;
const nav = (page: Page) => page.getByTestId("figure-navigator");
const card = (page: Page, title: string) => nav(page).getByRole("button", { name: new RegExp(`^\\d+\\. ${title}$`, "u") });
const selected = (page: Page) => nav(page).locator('[data-slide-id] button[aria-pressed="true"]');
const activeFrame = (page: Page) => page.evaluate(() =>
  (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getActiveFigureId: () => string | null } }).__TIKZ_EDITOR_APP_TEST_API__.getActiveFigureId());
async function pasteSlides(target: Locator, source: string) {
  await target.evaluate((element, text) => {
    const data = new DataTransfer(); data.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, source);
}

async function dock(page: Page, width: number) {
  await setSource(page, SOURCE);
  await page.evaluate(slideWidth => {
    const tab = (id: string, name: string) => ({ type: "tab", id, component: id, name });
    localStorage.setItem("tikz-editor:dock-layout", JSON.stringify({
      global: {}, borders: [], layout: { type: "row", children: [
        { type: "tabset", weight: slideWidth, children: [tab("figure-navigator", "Slides")] },
        { type: "tabset", weight: 100 - slideWidth, children: [tab("canvas", "Canvas")] }
      ] }
    }));
  }, width);
  await page.reload();
  await setSource(page, SOURCE);
}
async function dragTo(page: Page, from: Locator, to: Locator, edge: "before" | "after") {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await from.dispatchEvent("dragstart", { dataTransfer: transfer });
  const box = (await to.boundingBox())!;
  const position = { clientX: box.x + box.width / 2, clientY: box.y + (edge === "before" ? 2 : box.height - 2) };
  await to.dispatchEvent("dragover", { ...position, dataTransfer: transfer });
  await expect.poll(() => to.evaluate(element => element.closest("[data-slide-id], [data-section-id]")?.getAttribute("data-drop"))).toBe(edge);
  await to.dispatchEvent("drop", { ...position, dataTransfer: transfer });
  await transfer.dispose();
}

test.beforeEach(async ({ page }) => { await resetStorageBeforeNavigation(page); });

for (const layout of ["strip", "vertical", "grid"] as const) {
  test(`keeps the ${layout} slide list in place when clicking a slide after scrolling`, async ({ page }) => {
    await gotoApp(page);
    if (layout !== "strip") await dock(page, layout === "vertical" ? 18 : 40);
    const source = String.raw`\documentclass{beamer}
\begin{document}
${Array.from({ length: 24 }, (_, i) => String.raw`\begin{frame}{Item ${i + 1}}Content.\end{frame}`).join("\n")}
\end{document}`;
    await setSource(page, source);
    await expect(nav(page)).toHaveAttribute("data-layout", layout);
    await card(page, "Item 1").click();
    const viewport = page.getByTestId("figure-navigator-strip");
    const target = card(page, "Item 18");
    await target.evaluate(button => button.scrollIntoView({ block: "center", inline: "center" }));
    const position = await viewport.evaluate(async element => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return { left: element.scrollLeft, top: element.scrollTop };
    });
    expect(layout === "strip" ? position.left : position.top).toBeGreaterThan(0);
    const box = (await target.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => activeFrame(page)).toBe("frame:17");
    await expect(target).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => viewport.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })))
      .toEqual(position);
    await expect(target).toBeInViewport();
    await expect(target).toBeFocused();
    await page.keyboard.press("End");
    await expect.poll(() => activeFrame(page)).toBe("frame:23");
    await expect(card(page, "Item 24")).toBeInViewport();
  });
}

test("mirrors the active overlay, shows other slides' final overlays, and keeps an empty deck editable", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE);
  await expect(nav(page).getByRole("button", { name: "New slide", exact: true })).toHaveCount(0);
  await card(page, "A").click();
  await expect(nav(page)).toHaveAttribute("data-layout", "strip");
  await expect(nav(page).locator("img")).toHaveCount(4);
  const image = await card(page, "A").locator("img").getAttribute("src");
  expect(decodeURIComponent(image!).includes(`data-source-start="${SOURCE.indexOf("Later.")}"`)).toBe(false);
  await expect(card(page, "A").getByTestId("navigator-step-badge")).toHaveText("2");
  await page.getByTestId("deck-step-next").click();
  await expect.poll(async () => decodeURIComponent((await card(page, "A").locator("img").getAttribute("src"))!)
    .includes(`data-source-start="${SOURCE.indexOf("Later.")}"`)).toBe(true);
  await page.getByTestId("deck-step-prev").click();
  await card(page, "B").click();
  await expect.poll(async () => decodeURIComponent((await card(page, "A").locator("img").getAttribute("src"))!)
    .includes(`data-source-start="${SOURCE.indexOf("Later.")}"`)).toBe(true);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(nav(page)).toBeVisible();
  await expect(nav(page).getByText("No slides", { exact: true })).toBeVisible();
  await expect(nav(page)).toBeFocused();
  expect(await readStoreSource(page)).toContain("\\section{Two}");
  await pasteSlides(nav(page), "\\begin{frame}\n\n\\end{frame}");
  await expect(nav(page).getByRole("button", { name: "Slide 1", exact: true })).toBeFocused();
  expect(await readStoreSource(page)).toContain("\\begin{frame}\n\n\\end{frame}");
});

test("reuses the main render while editing without active-slide thumbnail requests or loading flashes", async ({ page }) => {
  await page.addInitScript(() => {
    const requests: number[] = [];
    (window as unknown as { slideThumbnailRequests: number[] }).slideThumbnailRequests = requests;
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message: unknown, transfer?: Transferable[]) {
      const request = message as { type?: string; deckFrameIndex?: number };
      if (request.type === "render" && request.deckFrameIndex != null) requests.push(request.deckFrameIndex);
      postMessage.call(this, message, transfer ?? []);
    };
  });
  await gotoApp(page);
  const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Editing}Before.\only<2>{Later.}\end{frame}
\begin{frame}{Other}Other content.\end{frame}
\end{document}`;
  await setSource(page, source); await card(page, "Editing").click();
  await expect(card(page, "Editing").locator("img")).toBeVisible();
  await card(page, "Editing").evaluate(button => {
    const state = window as unknown as { slideThumbnailRequests: number[]; slideLoadingFlashes: number };
    state.slideThumbnailRequests.length = 0; state.slideLoadingFlashes = 0;
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.textContent?.includes("Rendering…")) state.slideLoadingFlashes += 1;
      }
    });
    observer.observe(button, { subtree: true, childList: true });
  });
  const previewText = () => card(page, "Editing").locator("img").evaluate(image => {
    const src = (image as HTMLImageElement).src;
    const svg = new DOMParser().parseFromString(decodeURIComponent(src.slice(src.indexOf(",") + 1)), "image/svg+xml");
    return Array.from(svg.querySelectorAll("[data-tex-glyph]"), glyph => String.fromCodePoint(Number(glyph.getAttribute("data-tex-glyph")))).join("");
  });
  const canvasText = () => page.getByTestId("canvas-svg-layer").evaluate(layer =>
    Array.from(layer.querySelectorAll("[data-tex-glyph]"), glyph => String.fromCodePoint(Number(glyph.getAttribute("data-tex-glyph")))).join(""));
  for (const text of ["First edit.", "Second edit.", "Third edit."]) {
    await setSource(page, source.replace("Before.", text));
    await expect.poll(previewText).toContain(text.replaceAll(" ", ""));
    expect(await previewText()).toBe(await canvasText());
  }
  await page.getByTestId("deck-step-next").click();
  await expect.poll(previewText).toContain("Later.");
  expect(await previewText()).toBe(await canvasText());
  const observations = await page.evaluate(() => {
    const state = window as unknown as { slideThumbnailRequests: number[]; slideLoadingFlashes: number };
    return { requests: state.slideThumbnailRequests, flashes: state.slideLoadingFlashes };
  });
  expect(observations.requests).not.toContain(0);
  expect(observations.flashes).toBe(0);
});

test("selects ranges and toggles, duplicates through the menu, and restores selection on undo", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE); await dock(page, 18);
  await expect(nav(page)).toHaveAttribute("data-layout", "vertical");
  await card(page, "A").click();
  await card(page, "C").click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(3);
  await expect.poll(() => activeFrame(page)).toBe("frame:0");
  await card(page, "B").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected(page)).toHaveCount(2);
  await card(page, "A").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(nav(page).locator("[data-slide-id]")).toHaveCount(6);
  await expect(selected(page)).toHaveCount(2);
  expect(await readStoreSource(page)).toContain("label=a-copy");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await expect(selected(page)).toHaveCount(2);
  await expect(card(page, "A")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(nav(page).locator("[data-slide-id]")).toHaveCount(6);
});

test("moves a group across a section boundary and preserves active overlay through undo", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE); await dock(page, 18);
  await card(page, "A").click();
  await page.getByRole("button", { name: "Next overlay" }).click();
  await card(page, "B").click({ modifiers: ["ControlOrMeta"] });
  const section = nav(page).locator('[data-section-id="section:2"]');
  await dragTo(page, card(page, "A"), section, "after");
  await expect.poll(() => readStoreSource(page)).not.toBe(SOURCE);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("\\subsection{Details}")).toBeLessThan(moved.indexOf("% Keep with A"));
  expect(moved.indexOf("{A}First")).toBeLessThan(moved.indexOf("{B}\\hyperlink"));
  await expect(selected(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Next overlay" })).toBeDisabled();
  await card(page, "A").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await expect(page.getByRole("button", { name: "Next overlay" })).toBeDisabled();
  await nav(page).getByRole("button", { name: "One", exact: true }).click();
  await expect(card(page, "A")).toHaveCount(0);
  await nav(page).getByRole("button", { name: "One", exact: true }).click();
  await expect(card(page, "A")).toBeVisible();
});

test("uses a grid in a wide panel and ignores a drag after the source changes", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE); await dock(page, 40);
  await expect(nav(page)).toHaveAttribute("data-layout", "grid");
  await card(page, "A").click();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await card(page, "A").dispatchEvent("dragstart", { dataTransfer: transfer });
  const changed = SOURCE.replace("Third.", "Edited in source.");
  await setSource(page, changed);
  await card(page, "D").dispatchEvent("dragover", { dataTransfer: transfer });
  await card(page, "D").dispatchEvent("drop", { dataTransfer: transfer });
  expect(await readStoreSource(page)).toBe(changed);
  await transfer.dispose();
});

test("reorders with a native pointer drag and keeps the moved slide active", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE); await dock(page, 18);
  await card(page, "D").click();
  await card(page, "D").dragTo(card(page, "A"), { targetPosition: { x: 30, y: 3 } });
  await expect.poll(() => readStoreSource(page)).not.toBe(SOURCE);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("{D}Fourth")).toBeLessThan(moved.indexOf("% Keep with A"));
  await expect.poll(() => activeFrame(page)).toBe("frame:0");
  await expect(card(page, "D")).toHaveAttribute("aria-pressed", "true");
});

const WARNING_SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\def\unit{ms}
\begin{frame}{Latency}12\unit\end{frame}
\def\unit{s}
\begin{frame}{Throughput}Results\end{frame}
\end{document}`;
const review = (page: Page) => page.getByTestId("slide-move-review");

test("reviews a dragged move with exact definitions, supports cancel and confirmation, and undoes once", async ({ page }) => {
  await gotoApp(page); await dock(page, 18); await setSource(page, WARNING_SOURCE);
  await card(page, "Latency").click();
  await dragTo(page, card(page, "Latency"), card(page, "Throughput"), "after");
  await expect(review(page)).toBeVisible();
  await expect(review(page)).toContainText("would use a different definition of \\unit");
  await expect(review(page).locator("code")).toHaveText(["\\unit", "\\def\\unit{ms}", "\\def\\unit{s}"]);
  expect(await readStoreSource(page)).toBe(WARNING_SOURCE);
  await review(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review(page)).toHaveCount(0);
  expect(await readStoreSource(page)).toBe(WARNING_SOURCE);
  await card(page, "Latency").focus(); await page.keyboard.press("Alt+ArrowDown");
  await expect(review(page)).toBeVisible();
  await page.keyboard.press("Delete");
  expect(await readStoreSource(page)).toBe(WARNING_SOURCE);
  await review(page).getByRole("button", { name: "Move anyway", exact: true }).click();
  await expect.poll(() => readStoreSource(page)).not.toBe(WARNING_SOURCE);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("{Throughput}")).toBeLessThan(moved.indexOf("{Latency}"));
  await card(page, "Latency").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(WARNING_SOURCE);
});

test("opens the source panel and selects the clicked definition without moving the slide", async ({ page }) => {
  await gotoApp(page); await dock(page, 18); await setSource(page, WARNING_SOURCE);
  await card(page, "Latency").click(); await page.keyboard.press("Alt+ArrowDown");
  await review(page).getByRole("button", { name: "Show source: Current definition, line 3", exact: true }).click();
  await expect(review(page)).toHaveCount(0);
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("\\def\\unit{ms}");
  expect(await readStoreSource(page)).toBe(WARNING_SOURCE);
});

test("blocks crossing a conditional and expires review after a source edit", async ({ page }) => {
  await gotoApp(page); await dock(page, 18);
  const conditional = WARNING_SOURCE.replace("\\def\\unit{ms}", "\\iffalse").replace("\\def\\unit{s}", "\\fi");
  await setSource(page, conditional);
  await card(page, "Latency").click(); await page.keyboard.press("Alt+ArrowDown");
  await expect(review(page)).toContainText("crosses a conditional branch");
  await expect(review(page).getByRole("button", { name: "Move anyway" })).toHaveCount(0);
  expect(await readStoreSource(page)).toBe(conditional);
  await review(page).getByRole("button", { name: "Close", exact: true }).click();
  const owned = conditional.replace("\\iffalse", "\\begin{onlyenv}<1>").replace("\\fi\n", "\\end{onlyenv}\n");
  await setSource(page, owned);
  await card(page, "Latency").click(); await page.keyboard.press("Alt+ArrowDown");
  await expect(review(page)).toContainText("split an enclosing command");
  await expect(review(page).getByRole("button", { name: "Move anyway" })).toHaveCount(0);
  expect(await readStoreSource(page)).toBe(owned);
  await review(page).getByRole("button", { name: "Close", exact: true }).click();
  await setSource(page, WARNING_SOURCE);
  await card(page, "Latency").click(); await page.keyboard.press("Alt+ArrowDown");
  await expect(review(page)).toBeVisible();
  await setSource(page, WARNING_SOURCE + "\n% edited");
  await expect(review(page)).toHaveCount(0);
  await setSource(page, WARNING_SOURCE);
  await expect(review(page)).toHaveCount(0);
});

test("carries a private macro through keyboard reordering without a dialog and undoes it together", async ({ page }) => {
  await gotoApp(page); await dock(page, 18);
  const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Overview}Overview\end{frame}
% Number of samples
\newcommand{\sampleSize}{128}
\begin{frame}{Results}N=\sampleSize\end{frame}
\end{document}`;
  await setSource(page, source);
  await card(page, "Results").click(); await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => readStoreSource(page)).not.toBe(source);
  await expect(review(page)).toHaveCount(0);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("% Number of samples")).toBeLessThan(moved.indexOf("{Results}"));
  expect(moved.indexOf("{Results}")).toBeLessThan(moved.indexOf("{Overview}"));
  await card(page, "Results").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(source);
});


test("reorders KKT slides 2 and 3 without a warning and restores their source on undo", async ({ page }) => {
  const source = readFileSync(new URL("../../../test/fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url), "utf8");
  await gotoApp(page); await dock(page, 18); await setSource(page, source);
  const from = card(page, "Why KKT conditions matter"), to = card(page, "Problem form and notation");
  await from.click();
  await dragTo(page, from, to, "after");
  await expect.poll(() => readStoreSource(page)).not.toBe(source);
  await expect(review(page)).toHaveCount(0);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("\\begin{frame}{Problem form and notation}")).toBeLessThan(moved.indexOf("\\begin{frame}{Why KKT conditions matter}"));
  await from.focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(source);
  await from.focus(); await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => readStoreSource(page)).toBe(moved);
  await expect(review(page)).toHaveCount(0);
});


test("keeps unknown uses quiet and explains a known operation through a macro", async ({ page }) => {
  await gotoApp(page); await dock(page, 18);
  const source = String.raw`\documentclass{beamer}
\newcommand{\custom}{\packageCommand}
\begin{document}
\begin{frame}{First}\custom\end{frame}
\begin{frame}{Second}Text\end{frame}
\end{document}`;
  await setSource(page, source);
  await card(page, "First").click(); await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => readStoreSource(page)).not.toBe(source);
  await expect(review(page)).toHaveCount(0);
  await card(page, "First").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(source);

  const mutation = source.replace("\\packageCommand", "\\setcounter{equation}{4}");
  await setSource(page, mutation);
  await card(page, "First").click(); await page.keyboard.press("Alt+ArrowDown");
  await expect(review(page)).toContainText("This macro executes \\setcounter, which changes a counter.");
  await expect(review(page).locator("code")).toHaveText(["\\custom", String.raw`\newcommand{\custom}{\setcounter{equation}{4}}`]);
  expect(await readStoreSource(page)).toBe(mutation);
  await review(page).getByRole("button", { name: "Show source: Definition, line 2", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(String.raw`\newcommand{\custom}{\setcounter{equation}{4}}`);
});


const UNITS_SOURCE = String.raw`\documentclass{beamer}
\newcommand{\unit}{ms}
\begin{document}
\begin{frame}{Latency}
Response time: 12\unit
\end{frame}
\renewcommand{\unit}{s}
\begin{frame}{Results}
Summary: 15\unit
\end{frame}
\end{document}`;

test("renders between-slide macro changes in the canvas and thumbnails", async ({ page }) => {
  await gotoApp(page); await dock(page, 18); await setSource(page, UNITS_SOURCE);
  await card(page, "Results").click();
  const canvasText = () => page.getByTestId("canvas-svg-layer").evaluate(layer =>
    Array.from(layer.querySelectorAll("[data-tex-glyph]"), glyph => String.fromCodePoint(Number(glyph.getAttribute("data-tex-glyph")))).join(""));
  await expect.poll(canvasText).toContain("15s");
  const thumbnailText = () => card(page, "Results").locator("img").evaluate(image => {
    const src = (image as HTMLImageElement).src;
    const svg = new DOMParser().parseFromString(decodeURIComponent(src.slice(src.indexOf(",") + 1)), "image/svg+xml");
    return Array.from(svg.querySelectorAll("[data-tex-glyph]"), glyph => String.fromCodePoint(Number(glyph.getAttribute("data-tex-glyph")))).join("");
  });
  await expect.poll(thumbnailText).toContain("15s");
  await setSource(page, UNITS_SOURCE.replace("{s}", "{seconds}"));
  await expect.poll(thumbnailText).toContain("15seconds");
  await card(page, "Latency").click();
  await expect.poll(canvasText).toContain("12ms");
});

test("keeps source dimming aligned with the active slide after reorder and undo", async ({ page }) => {
  await gotoApp(page); await dock(page, 18);
  const source = UNITS_SOURCE.replace("Summary: 15\\unit", "Summary.");
  await setSource(page, source);
  await page.evaluate(() => (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { runCommand: (id: string) => boolean } }).__TIKZ_EDITOR_APP_TEST_API__.runCommand("view.toggle-source-panel"));
  await expect(page.locator(".cm-content")).toBeVisible();
  await card(page, "Results").click(); await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => readStoreSource(page)).not.toBe(source);
  const dimmed = (text: string) => page.locator(".cm-line").filter({ hasText: text }).evaluate(line => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const values: boolean[] = [];
    while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) values.push(!!walker.currentNode.parentElement?.closest(".cm-figure-dimmed"));
    return values;
  });
  await expect.poll(async () => (await dimmed("Response time:")).every(Boolean)).toBe(true);
  await expect.poll(async () => (await dimmed("Summary.")).some(Boolean)).toBe(false);
  await expect(page.locator(".cm-activeLine")).toHaveText(String.raw`\begin{frame}{Results}`);
  await card(page, "Results").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(source);
  await expect.poll(async () => (await dimmed("Response time:")).every(Boolean)).toBe(true);
  await expect.poll(async () => (await dimmed("Summary.")).some(Boolean)).toBe(false);
  await expect(page.locator(".cm-activeLine")).toHaveText(String.raw`\begin{frame}{Results}`);
});

test("copies and pastes selected slides through clipboard events and undoes once", async ({ page }) => {
  await gotoApp(page); await dock(page, 18);
  await card(page, "A").click(); await card(page, "B").click({ modifiers: ["Shift"] });
  const text = await card(page, "B").evaluate(button => {
    const data = new DataTransfer();
    button.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }));
    return data.getData("text/plain");
  });
  expect(text).toContain("% Keep with A");
  expect(text).toContain(String.raw`\begin{frame}{B}`);
  expect(text).not.toContain(String.raw`\begin{frame}{C}`);
  await card(page, "D").click();
  await card(page, "D").evaluate((button, text) => {
    const data = new DataTransfer(); data.setData("text/plain", text);
    button.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, text);
  await expect(nav(page).locator("[data-slide-id]")).toHaveCount(6);
  await expect(selected(page)).toHaveCount(2);
  const pasted = await readStoreSource(page);
  expect(pasted).toContain("[label=a-copy]");
  expect(pasted).toContain(String.raw`\hyperlink{a-copy}{Back}`);
  await selected(page).first().focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await expect(selected(page)).toHaveAttribute("aria-label", "4. D");
});

test("uses a counted stack as the multi-slide drag image and removes it on cancellation", async ({ page }) => {
  await gotoApp(page); await dock(page, 18);
  await expect.poll(() => card(page, "A").locator("img").evaluate(image => (image as HTMLImageElement).complete)).toBe(true);
  await card(page, "A").click(); await card(page, "B").click({ modifiers: ["Shift"] });
  const transfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    Object.defineProperty(transfer, "setDragImage", { value: (element: HTMLElement) => { element.dataset.usedAsDragImage = "true"; } });
    return transfer;
  });
  await card(page, "A").dispatchEvent("dragstart", { dataTransfer: transfer });
  const ghost = page.getByTestId("slide-drag-preview");
  await expect(ghost).toHaveText("2 slides");
  await expect(ghost).toHaveAttribute("data-used-as-drag-image", "true");
  await ghost.evaluate(element => { element.style.left = "20px"; element.style.top = "20px"; element.style.zIndex = "9999"; });
  await page.screenshot({ path: "/tmp/slide-drag-preview.png", clip: { x: 16, y: 16, width: 174, height: 122 } });
  await card(page, "A").dispatchEvent("dragend", { dataTransfer: transfer });
  await expect(ghost).toHaveCount(0);
  expect(await readStoreSource(page)).toBe(SOURCE);
  await transfer.dispose();
});


test("keeps a pasted slide's source boundaries and caret aligned after undo and redo", async ({ page }) => {
  await gotoApp(page); await dock(page, 18);
  const source = UNITS_SOURCE.replace("Summary: 15\\unit", "Summary.");
  await setSource(page, source);
  await page.evaluate(() => (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { runCommand: (id: string) => boolean } }).__TIKZ_EDITOR_APP_TEST_API__.runCommand("view.toggle-source-panel"));
  await expect(page.locator(".cm-content")).toBeVisible();
  await card(page, "Latency").click();
  await pasteSlides(card(page, "Latency"), "\\begin{frame}\n\n\\end{frame}");
  await expect(nav(page).locator("[data-slide-id]")).toHaveCount(3);
  const highlights = () => page.locator(".cm-line").evaluateAll(lines => lines.map(line => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let bright = "", dim = "";
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent ?? "";
      if (walker.currentNode.parentElement?.closest(".cm-figure-dimmed")) dim += text;
      else bright += text;
    }
    return { bright: bright.trim(), dim: dim.trim() };
  }));
  await expect.poll(async () => (await highlights()).filter(line => line.bright).map(line => line.bright))
    .toEqual([String.raw`\begin{frame}`, String.raw`\end{frame}`]);
  await expect(page.locator(".cm-activeLine")).toHaveText(String.raw`\begin{frame}`);
  await selected(page).focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(source);
  await expect.poll(async () => (await highlights()).filter(line => line.bright).map(line => line.bright))
    .toEqual([String.raw`\begin{frame}{Latency}`, String.raw`Response time: 12\unit`, String.raw`\end{frame}`]);
  await expect(page.locator(".cm-activeLine")).toHaveText(String.raw`\begin{frame}{Latency}`);
  await selected(page).focus(); await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(nav(page).locator("[data-slide-id]")).toHaveCount(3);
  await expect.poll(async () => (await highlights()).filter(line => line.bright).map(line => line.bright))
    .toEqual([String.raw`\begin{frame}`, String.raw`\end{frame}`]);
  await expect(page.locator(".cm-activeLine")).toHaveText(String.raw`\begin{frame}`);
});
