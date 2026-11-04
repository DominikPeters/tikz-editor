import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Supply picker results, keeping all other bridge operations on the real backend. */
async function installImagePicker(browser, paths) {
  await browser.execute(selectedPaths => {
    const pending = [...selectedPaths];
    window.__DESKTOP_IMAGE_PICKER_CALLS__ = [];
    window.__TIKZ_EDITOR_DESKTOP_TEST_API__.setBridgeOverride({
      openBinary: async (_path, options) => {
        window.__DESKTOP_IMAGE_PICKER_CALLS__.push(options);
        if (pending.length === 0) throw new Error("Unexpected image picker request");
        const selected = pending.shift();
        return selected === null ? null : await window.__TAURI_INTERNALS__.invoke("desktop_open_binary", {
          path: selected, ...options
        });
      }
    });
  }, paths);
}

async function source(browser) {
  return await browser.execute(() => window.__TIKZ_EDITOR_APP_TEST_API__.getSource());
}

async function expectSource(browser, expected) {
  await browser.waitUntil(async () => await browser.execute(value => {
    const api = window.__TIKZ_EDITOR_APP_TEST_API__;
    return api.getSource() === value && api.getSnapshotSource() === value && api.getPendingRequestId() === null;
  }, expected), { timeout: 30_000, timeoutMsg: `Image edit did not settle to ${expected}` });
}

async function imageHref(browser) {
  return await browser.execute(() => {
    const image = document.querySelector('[data-testid="canvas-svg-layer"] image');
    return image?.getAttribute("href") ?? image?.getAttribute("xlink:href") ?? "";
  });
}

async function expectImage(browser, previous = "") {
  await browser.waitUntil(async () => {
    const href = await imageHref(browser);
    return href.startsWith("data:image/") && href !== previous;
  }, { timeout: 15_000, timeoutMsg: "Native image did not render on the slide" });
  return await imageHref(browser);
}

async function selectImage(browser) {
  await browser.$('[data-hit-region-deck-object-id*="\u003agraphics\u003a"]').waitForExist({ timeout: 15_000 });
  // The embedded driver's element.click() calls HTMLElement.click(), which
  // SVG hit regions do not implement. Pointer actions exercise the canvas handler.
  const center = await browser.execute(() => {
    const rect = document.querySelector('[data-hit-region-deck-object-id*=":graphics:"]').getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  });
  await browser.action("pointer").move({ ...center, origin: "viewport" }).down().up().perform();
  await browser.$("//button[normalize-space(.)='Replace Image…']").waitForDisplayed({ timeout: 10_000 });
}

function tinyPdf() {
  const stream = "1 0 0 rg 0 0 90 60 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    ...Array(3).fill("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 90 60] /Resources << >> /Contents 6 0 R >>"),
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  return pdf + `xref\n0 7\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

export async function scenarioDesktopImages(browser, { dispatchCommand, restoreBridge }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tikz desktop images "));
  const documentPath = path.join(directory, "slides.tex");
  const originalPath = path.join(directory, "images", "original.pdf");
  const replacementPath = path.join(directory, "images", "replacement image.svg");
  fs.mkdirSync(path.dirname(originalPath));
  fs.writeFileSync(originalPath, tinyPdf());
  fs.writeFileSync(replacementPath, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="blue"/></svg>');
  const original = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Native images}
\includegraphics[width=3cm,height=2cm,keepaspectratio,trim=1 2 3 4,clip,page=3]{images/original.pdf}
\end{frame}
\end{document}`;
  fs.writeFileSync(documentPath, original);
  try {
    await browser.execute(() => window.__DESKTOP_E2E_UNSAVED_DECISIONS__.push(...Array(20).fill("discard")));
    await dispatchCommand(browser, "file.close-all-documents");
    await browser.waitUntil(async () => (await browser.$$('[data-testid^="tab-switch-"]')).length === 1);
    await installImagePicker(browser, [null, replacementPath, originalPath]);
    await browser.execute(async file => {
      const opened = await window.__TAURI_INTERNALS__.invoke("desktop_open_text", { path: file, addToRecent: false });
      window.__TIKZ_EDITOR_DESKTOP_TEST_API__.triggerOpenRequest(opened);
    }, documentPath);
    await expectSource(browser, original);
    const originalHref = await expectImage(browser);
    await selectImage(browser);

    // Cancellation neither changes source nor creates an undo entry.
    await browser.$("//button[normalize-space(.)='Replace Image…']").click();
    await browser.waitUntil(async () => await browser.execute(() => window.__DESKTOP_IMAGE_PICKER_CALLS__.length === 1));
    await expectSource(browser, original);
    assert.equal(await browser.execute(() => window.__TIKZ_EDITOR_APP_TEST_API__.getCommandState("edit.undo").enabled), false);

    await browser.$("//button[normalize-space(.)='Replace Image…']").click();
    const replaced = original.replace(",page=3", "").replace("images/original.pdf", "images/replacement image.svg");
    await expectSource(browser, replaced);
    const replacedHref = await expectImage(browser, originalHref);
    assert.match(replacedHref, /^data:image\/svg\+xml;base64,/u);
    assert.match(Buffer.from(replacedHref.split(",")[1], "base64").toString("utf8"), /fill="blue"/u);
    await browser.saveScreenshot(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "tikz-desktop-image-replacement.png"));
    assert.equal(await browser.$("//button[normalize-space(.)='Replace Image…']").isDisplayed(), true, "replacement keeps image selected");
    assert.equal(await browser.$('[aria-label="Page"]').isExisting(), false, "SVG has no PDF page control");
    await dispatchCommand(browser, "edit.undo");
    await expectSource(browser, original);
    assert.equal(await expectImage(browser, replacedHref), originalHref);
    await dispatchCommand(browser, "edit.redo");
    await expectSource(browser, replaced);
    await expectImage(browser, originalHref);

    // The native save and reload must keep the relative reference and resolve it again.
    await dispatchCommand(browser, "file.save-document");
    await browser.waitUntil(() => fs.readFileSync(documentPath, "utf8") === replaced);
    await browser.refresh();
    await expectSource(browser, replaced);
    await expectImage(browser);
    await installImagePicker(browser, [originalPath]);
    await selectImage(browser);
    await browser.$("//button[normalize-space(.)='Replace Image…']").click();
    const pdfAgain = replaced.replace("images/replacement image.svg", "images/original.pdf");
    await expectSource(browser, pdfAgain);
    await expectImage(browser, replacedHref);
    assert.equal(await browser.$('[aria-label="Page"]').getValue(), "1", "replacement PDF starts on page one");
    assert.deepEqual(await browser.execute(() => window.__DESKTOP_IMAGE_PICKER_CALLS__), [{ addToRecent: false, kind: "graphics" }]);
    assert.equal((await source(browser)).includes("__tikz_assets__"), false, "desktop keeps native references");
  } catch (error) {
    console.error("[desktop-images]", await browser.execute(() => ({
      source: window.__TIKZ_EDITOR_APP_TEST_API__.getSource(),
      snapshot: window.__TIKZ_EDITOR_APP_TEST_API__.getSnapshotSource(),
      pending: window.__TIKZ_EDITOR_APP_TEST_API__.getPendingRequestId(),
      url: location.href,
      errors: window.__DESKTOP_E2E_ERRORS__ ?? [],
      warnings: (window.__DESKTOP_E2E_WARNINGS__ ?? []).slice(0, 5)
    })));
    throw error;
  } finally {
    await restoreBridge();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
