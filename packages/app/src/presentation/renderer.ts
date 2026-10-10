import { prepareBeamerDocument, type PreparedBeamerDocument } from "@tikz-editor/core/beamer";
import { createBeamerTexMathFontProfile, createBeamerTexTextFontProfile } from "@tikz-editor/core/beamer/theme/font";
import { expandMacroBindingsMapped } from "@tikz-editor/core/macros";
import { createIdentityMappedText } from "@tikz-editor/core/text/source-map";
import { computerModernTexMetricProvider, createTexDerivedInlineMathBoxProvider, layoutSimpleTexParagraph, renderTexParagraphSvgBody, texLength } from "@tikz-editor/core/text/tex";
import { BoundedLru } from "../bounded-lru";
import { prepareDocumentGraphicsContext, type PreparedDocumentGraphicsContext } from "../image-asset-cache";
import type { DocumentFileRef } from "../store/types";
import { yieldToBrowser } from "../yield-to-browser";
import type { PresentationRenderer } from "./controller";
import type { PresentationCursor, PresentationFrame, PresentationPage } from "./types";

function renderNotes(prepared: PreparedBeamerDocument, cursor: PresentationCursor, graphics: PreparedDocumentGraphicsContext): string | null {
  const text = prepared.speakerNotes(cursor.frame, cursor.step);
  if (!text.trim()) return null;
  const role = { ...prepared.theme.fonts["normal-text"], sizePt: 11, lineHeightPt: 14 };
  const profile = createBeamerTexTextFontProfile(role);
  const mapped = expandMacroBindingsMapped(createIdentityMappedText(text), prepared.frameEditingEnvironment(cursor.frame).macros);
  const layout = layoutSimpleTexParagraph(mapped.text, { paragraphId: "presenter-notes", width: texLength(300),
    font: profile.resolveTextFont(profile.defaultFontState, texLength(11), computerModernTexMetricProvider),
    metricProvider: computerModernTexMetricProvider, textFontProfile: profile, alignment: "ragged-right", baselineSkip: 14,
    graphicsResolver: graphics.resolver, fallbackPolicy: "placeholder", sourceMap: mapped.sourceMap,
    mathBoxProvider: createTexDerivedInlineMathBoxProvider({ baseAtPt: texLength(11), fontProfile: createBeamerTexMathFontProfile(role) }) });
  if (!layout.report || !layout.vlistLayout) return null;
  const body = renderTexParagraphSvgBody(layout.report, { lineHeightPt: texLength(14), vlistLayout: layout.vlistLayout,
    metricProvider: computerModernTexMetricProvider, textFontProfile: profile, baseFontSizePt: texLength(11) });
  const height = Math.max(14, Number(layout.vlistLayout.metrics.height) + Number(layout.vlistLayout.metrics.depth));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 316 ${height + 16}" width="316" height="${height + 16}"><g transform="translate(8 8)">${body}</g></svg>`;
}

async function decodeSvg(svg: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (typeof Image === "undefined") return;
  const image = new Image();
  if (typeof image.decode !== "function") return;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  let abort: (() => void) | undefined;
  try {
    image.src = url;
    await Promise.race([image.decode(), new Promise<never>((_resolve, reject) => {
      abort = () => { reject(new DOMException("Slide request was superseded.", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
    signal.throwIfAborted();
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
    URL.revokeObjectURL(url);
  }
}

export class BeamerPresentationRenderer implements PresentationRenderer {
  readonly frames: readonly PresentationFrame[];
  readonly prepared: PreparedBeamerDocument;
  private cache = new BoundedLru<string, PresentationPage>(48, 24 * 1024 * 1024);
  private counts = new Map<number, number>();
  private pending = new Map<string, { signal: AbortSignal; promise: Promise<PresentationPage> }>();
  private renderQueue: Promise<unknown> = Promise.resolve();
  private constructor(readonly source: string, private graphics: PreparedDocumentGraphicsContext) {
    this.prepared = prepareBeamerDocument(source);
    this.frames = this.prepared.document.frames.map((frame, index) => ({ index, title: frame.title?.value ?? `Slide ${index + 1}`, steps: this.prepared.frameStepCount(index) }));
  }
  static async create(source: string, fileRef: DocumentFileRef | null): Promise<BeamerPresentationRenderer> {
    return new BeamerPresentationRenderer(source, await prepareDocumentGraphicsContext({ source, documentFileRef: fileRef }));
  }
  async pageCount(frame: number, signal: AbortSignal): Promise<number> {
    const known = this.counts.get(frame);
    if (known !== undefined) return known;
    await this.page({ frame, step: 1, continuation: 1 }, signal);
    return this.counts.get(frame) ?? this.frames[frame]?.steps ?? 1;
  }
  async page(cursor: PresentationCursor, signal: AbortSignal): Promise<PresentationPage> {
    signal.throwIfAborted();
    const key = `${cursor.frame}:${cursor.step}:${cursor.continuation}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.pending.get(key);
    if (pending) {
      try {
        const page = await pending.promise;
        signal.throwIfAborted();
        return page;
      } catch (error) {
        if (!pending.signal.aborted || signal.aborted) throw error;
        return this.page(cursor, signal);
      }
    }
    const promise = this.renderQueue.then(async () => {
      signal.throwIfAborted();
      const result = await this.prepared.renderFrame({ frameIndex: cursor.frame, step: cursor.step, continuation: cursor.continuation,
        graphicsResolver: this.graphics.resolver, cooperative: { signal, budgetMs: 4, yieldControl: yieldToBrowser } });
      signal.throwIfAborted();
      this.counts.set(cursor.frame, (result.layout.continuation?.count ?? 1) + this.frames[cursor.frame].steps - 1);
      const page: PresentationPage = { cursor, svg: result.svg.svg, notesSvg: renderNotes(this.prepared, cursor, this.graphics) };
      await decodeSvg(page.svg, signal);
      signal.throwIfAborted();
      this.cache.set(key, page, (page.svg.length + (page.notesSvg?.length ?? 0)) * 2);
      return page;
    });
    this.pending.set(key, { signal, promise });
    this.renderQueue = promise.catch(() => {});
    try { return await promise; }
    finally { if (this.pending.get(key)?.promise === promise) this.pending.delete(key); }
  }
}

/** Preserve authored frame identity across reorder/edit, then fall back to the nearest surviving frame. */
export function remapPresentationCursor(previous: BeamerPresentationRenderer, next: BeamerPresentationRenderer, cursor: PresentationCursor): PresentationCursor {
  const oldFrames = previous.prepared.document.frames, newFrames = next.prepared.document.frames;
  const old = oldFrames[cursor.frame];
  if (!old || !newFrames.length) return { ...cursor, frame: Math.max(0, Math.min(cursor.frame, newFrames.length - 1)) };
  const exact = newFrames.findIndex(frame => next.source.slice(frame.span.from, frame.span.to) === previous.source.slice(old.span.from, old.span.to));
  const labeled = old.options?.label ? newFrames.findIndex(frame => frame.options?.label === old.options?.label) : -1;
  let frame = labeled >= 0 ? labeled : exact;
  if (frame < 0) {
    let prefix = 0;
    while (prefix < previous.source.length && prefix < next.source.length && previous.source[prefix] === next.source[prefix]) prefix++;
    let suffix = 0;
    while (suffix < previous.source.length - prefix && suffix < next.source.length - prefix && previous.source[previous.source.length - 1 - suffix] === next.source[next.source.length - 1 - suffix]) suffix++;
    const oldChangedEnd = previous.source.length - suffix;
    const shiftedStart = old.span.from >= oldChangedEnd ? old.span.from + next.source.length - previous.source.length : old.span.from;
    if (!(prefix <= old.span.from && oldChangedEnd >= old.span.to)) frame = newFrames.findIndex(candidate => candidate.span.from <= shiftedStart && candidate.span.to > shiftedStart);
    if (frame < 0) frame = Math.min(cursor.frame, newFrames.length - 1);
  }
  return { ...cursor, frame };
}
