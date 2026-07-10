import type {
  SvgPatchOp,
  SvgRenderModel,
  SvgRenderPart,
  SvgViewBox
} from "@tikz-editor/core/svg/index";
import {
  nextPartIdInOrder,
  removePartOrder,
  upsertPartOrder
} from "@tikz-editor/core/svg/order";

const SVG_NS = "http://www.w3.org/2000/svg";

export class SvgDomPatcher {
  private readonly rootSvg: SVGSVGElement;
  private readonly defsElement: SVGDefsElement;
  private readonly contentLayer: SVGGElement;
  private readonly elementByPartId = new Map<string, SVGElement>();
  private readonly fingerprintByPartId = new Map<string, string>();
  private readonly domParser = new DOMParser();
  private partOrder: string[] = [];

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
    this.partOrder = [];
    if (this.host.contains(this.rootSvg)) {
      this.rootSvg.remove();
    }
  }

  applyOperations(operations: readonly SvgPatchOp[]): void {
    for (const operation of operations) {
      this.applyOperation(operation);
    }
  }

  private applyOperation(operation: SvgPatchOp): void {
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
        this.upsertPart(operation.part, operation.afterPartId);
        return;
    }
  }

  private replaceAll(model: SvgRenderModel): void {
    this.setViewBox(model.viewBox);
    this.replaceDefs(model.defs);
    this.elementByPartId.clear();
    this.fingerprintByPartId.clear();
    this.partOrder = [];
    this.contentLayer.replaceChildren();
    for (const part of model.parts) {
      const element = this.parsePartElement(part);
      this.contentLayer.appendChild(element);
      this.elementByPartId.set(part.partId, element);
      this.fingerprintByPartId.set(part.partId, part.fingerprint);
      this.partOrder.push(part.partId);
    }
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
    this.partOrder = removePartOrder(this.partOrder, partId);
  }

  private upsertPart(part: SvgRenderPart, afterPartId: string | null): void {
    const existing = this.elementByPartId.get(part.partId);
    const existingFingerprint = this.fingerprintByPartId.get(part.partId);
    const nextOrder = upsertPartOrder(this.partOrder, part.partId, afterPartId);

    let element = existing;
    if (!element || existingFingerprint !== part.fingerprint) {
      const replacement = this.parsePartElement(part);
      if (element?.parentNode === this.contentLayer) {
        this.contentLayer.replaceChild(replacement, element);
      } else {
        this.contentLayer.appendChild(replacement);
      }
      element = replacement;
      this.elementByPartId.set(part.partId, element);
      this.fingerprintByPartId.set(part.partId, part.fingerprint);
    }

    const beforePartId = nextPartIdInOrder(nextOrder, part.partId);
    const beforeNode = beforePartId ? this.elementByPartId.get(beforePartId) ?? null : null;
    if (beforePartId && !beforeNode) {
      throw new Error(`Missing anchor node for part ${beforePartId}`);
    }
    if (beforeNode && beforeNode.parentNode !== this.contentLayer) {
      throw new Error(`Anchor node ${beforePartId} is detached from the content layer`);
    }
    if (element.parentNode !== this.contentLayer || element.nextSibling !== beforeNode) {
      this.contentLayer.insertBefore(element, beforeNode);
    }
    this.partOrder = nextOrder;
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

function fmt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function isSvgElementNode(node: Element | null): node is SVGElement {
  return Boolean(node?.namespaceURI === SVG_NS);
}
