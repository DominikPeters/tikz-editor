import type {
  SvgPatchOp,
  SvgRenderModel,
  SvgRenderPart,
  SvgViewBox
} from "@tikz-editor/core/svg/index";
import { fmt } from "./geometry";

const SVG_NS = "http://www.w3.org/2000/svg";

export class SvgDomPatcher {
  private readonly rootSvg: SVGSVGElement;
  private readonly defsElement: SVGDefsElement;
  private readonly contentLayer: SVGGElement;
  private readonly elementByPartId = new Map<string, SVGElement>();
  private readonly fingerprintByPartId = new Map<string, string>();
  private readonly domParser = new DOMParser();

  constructor(private readonly host: HTMLElement) {
    this.rootSvg = document.createElementNS(SVG_NS, "svg");
    this.rootSvg.setAttribute("role", "img");
    this.rootSvg.setAttribute("aria-label", "TikZ SVG preview");
    this.rootSvg.setAttribute("draggable", "false");
    this.rootSvg.style.display = "block";
    this.rootSvg.style.width = "100%";
    this.rootSvg.style.height = "100%";
    this.rootSvg.style.webkitUserSelect = "none";
    this.rootSvg.style.userSelect = "none";
    this.rootSvg.style.setProperty("-webkit-user-drag", "none");

    this.defsElement = document.createElementNS(SVG_NS, "defs");
    this.contentLayer = document.createElementNS(SVG_NS, "g");
    this.contentLayer.setAttribute("data-layer", "content");

    this.rootSvg.append(this.defsElement, this.contentLayer);
    this.host.replaceChildren(this.rootSvg);
  }

  dispose(): void {
    this.elementByPartId.clear();
    this.fingerprintByPartId.clear();
    if (this.host.contains(this.rootSvg)) {
      this.rootSvg.remove();
    }
  }

  applyOperations(operations: readonly SvgPatchOp[]): void {
    const changedParts = operations.flatMap((operation) =>
      operation.kind === "upsertPart" && this.fingerprintByPartId.get(operation.part.partId) !== operation.part.fingerprint
        ? [operation.part] : []);
    const parsed = this.parsePartElements(changedParts);
    for (const operation of operations) {
      this.applyOperation(operation, parsed);
    }
  }

  private applyOperation(operation: SvgPatchOp, parsed: ReadonlyMap<SvgRenderPart, SVGElement>): void {
    switch (operation.kind) {
      case "replaceAll":
        this.replaceAll(operation.model);
        return;
      case "replaceDefs":
        this.replaceDefs(operation.defs);
        return;
      case "setViewBox":
        this.setViewBox(operation.viewBox);
        return;
      case "removePart":
        this.removePart(operation.partId);
        return;
      case "upsertPart":
        this.upsertPart(operation.part, operation.afterPartId, parsed.get(operation.part));
        return;
    }
  }

  private replaceAll(model: SvgRenderModel): void {
    this.setViewBox(model.viewBox);
    this.replaceDefs(model.defs);
    this.elementByPartId.clear();
    this.fingerprintByPartId.clear();
    this.contentLayer.replaceChildren();
    const parsed = this.parsePartElements(model.parts);
    const content = document.createDocumentFragment();
    for (const part of model.parts) {
      const element = parsed.get(part)!;
      content.appendChild(element);
      this.elementByPartId.set(part.partId, element);
      this.fingerprintByPartId.set(part.partId, part.fingerprint);
    }
    this.contentLayer.appendChild(content);
  }

  private replaceDefs(defs: readonly string[]): void {
    this.defsElement.innerHTML = defs.join("");
  }

  private setViewBox(viewBox: SvgViewBox): void {
    this.rootSvg.setAttribute("viewBox", `${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}`);
  }

  private removePart(partId: string): void {
    const element = this.elementByPartId.get(partId);
    if (element?.parentNode) {
      element.remove();
    }
    this.elementByPartId.delete(partId);
    this.fingerprintByPartId.delete(partId);
  }

  private upsertPart(part: SvgRenderPart, afterPartId: string | null, parsed?: SVGElement): void {
    const existing = this.elementByPartId.get(part.partId);
    const existingFingerprint = this.fingerprintByPartId.get(part.partId);

    let element = existing;
    if (!element || existingFingerprint !== part.fingerprint) {
      const replacement = parsed ?? this.parsePartElement(part);
      if (element?.parentNode === this.contentLayer) {
        this.contentLayer.replaceChild(replacement, element);
      } else {
        this.contentLayer.appendChild(replacement);
      }
      element = replacement;
      this.elementByPartId.set(part.partId, element);
      this.fingerprintByPartId.set(part.partId, part.fingerprint);
    }

    // The DOM already owns the part order. Using its sibling links avoids
    // filtering/copying the complete order array for each changed part.
    const anchor = afterPartId && afterPartId !== part.partId ? this.elementByPartId.get(afterPartId) : null;
    let beforeNode = afterPartId == null ? this.contentLayer.firstChild : anchor?.nextSibling ?? null;
    if (beforeNode === element) beforeNode = element.nextSibling;
    if (element.parentNode !== this.contentLayer || element.nextSibling !== beforeNode) {
      this.contentLayer.insertBefore(element, beforeNode);
    }
  }

  private parsePartElements(parts: readonly SvgRenderPart[]): Map<SvgRenderPart, SVGElement> {
    const elements = new Map<SvgRenderPart, SVGElement>();
    if (parts.length === 0) return elements;
    // Each render part normally has one root. Parse them in one XML document,
    // retaining the per-part fallback for malformed or multi-root fragments.
    const parsed = this.domParser.parseFromString(
      `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink">${parts.map((part) => part.markup).join("")}</svg>`,
      "image/svg+xml"
    );
    const children = Array.from(parsed.documentElement.children);
    if (!parsed.querySelector("parsererror") && children.length === parts.length && children.every(isSvgElementNode)) {
      parts.forEach((part, index) => {
        const element = children[index];
        element.setAttribute("data-part-id", part.partId);
        elements.set(part, element);
      });
    } else {
      for (const part of parts) elements.set(part, this.parsePartElement(part));
    }
    return elements;
  }

  private parsePartElement(part: SvgRenderPart): SVGElement {
    const xmlParsed = this.domParser.parseFromString(
      `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink">${part.markup}</svg>`,
      "image/svg+xml"
    );
    const parserError = xmlParsed.querySelector("parsererror");
    if (!parserError) {
      const xmlElement = xmlParsed.documentElement.firstElementChild;
      if (isSvgElementNode(xmlElement)) {
        xmlElement.setAttribute("data-part-id", part.partId);
        return xmlElement;
      }
    }

    // Fallback parser for browser engines that are stricter in `image/svg+xml` mode.
    const container = document.createElementNS(SVG_NS, "g");
    container.innerHTML = part.markup;
    const fallbackElement = container.firstElementChild;
    if (isSvgElementNode(fallbackElement)) {
      fallbackElement.setAttribute("data-part-id", part.partId);
      return fallbackElement;
    }

    throw new Error(`Invalid SVG markup for part ${part.partId}`);
  }
}

function isSvgElementNode(node: Element | null): node is SVGElement {
  return Boolean(node?.namespaceURI === SVG_NS);
}
