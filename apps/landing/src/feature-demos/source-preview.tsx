import { forwardRef } from "react";
import type { ReactNode } from "react";

export type SourceTokenKind =
  | "keyword"
  | "typeName"
  | "string"
  | "number"
  | "comment"
  | "punctuation"
  | "meta"
  | "text";

export type SourceToken = {
  kind: SourceTokenKind;
  text: string;
  className?: string;
};

export type SourceLine = readonly SourceToken[];

export type SourcePreviewProps = {
  lines: readonly SourceLine[];
  managedImperatively?: boolean;
  layoutItemId?: string;
};

export function sourceLine(...tokens: SourceToken[]): SourceLine {
  return tokens;
}

export const sourceText = (text: string): SourceToken => ({ kind: "text", text });
export const sourceKeyword = (text: string): SourceToken => ({ kind: "keyword", text });
export const sourceTypeName = (text: string): SourceToken => ({ kind: "typeName", text });
export const sourceString = (text: string): SourceToken => ({ kind: "string", text });
export const sourceNumber = (text: string): SourceToken => ({ kind: "number", text });
export const sourceComment = (text: string): SourceToken => ({ kind: "comment", text });
export const sourcePunctuation = (text: string): SourceToken => ({ kind: "punctuation", text });
export const sourceMeta = (text: string): SourceToken => ({ kind: "meta", text });

export function formatTikzNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const nearestInteger = Math.round(rounded);
  if (Math.abs(rounded - nearestInteger) < 1e-9) {
    return String(nearestInteger);
  }
  const text = rounded.toFixed(1);
  return Object.is(rounded, -0) ? "0" : text;
}

function getTokenClassName(token: SourceToken): string {
  return ["sourceToken", `sourceToken--${token.kind}`, token.className].filter(Boolean).join(" ");
}

export function renderSourcePreview(target: HTMLElement, lines: readonly SourceLine[]): void {
  const lineSignatures = lines.map(sourceLineSignature);
  const signature = lineSignatures.join("|");
  const previous = LAST_RENDERED_SOURCE.get(target);

  if (previous?.signature !== signature) {
    const mounted = mountSourcePreview(target, lines, signature, lineSignatures);
    if (previous) {
      mounted.lineElements.forEach((lineElement, lineIndex) => {
        if (previous.lineSignatures[lineIndex] !== lineSignatures[lineIndex]) {
          flashLineTokens(lineElement);
        }
      });
    }
    LAST_RENDERED_SOURCE.set(target, mounted);
    return;
  }

  let tokenIndex = 0;
  lines.forEach((line) => {
    line.forEach((token) => {
      const textNode = previous.textNodes[tokenIndex];
      if (textNode && textNode.nodeValue !== token.text) {
        textNode.nodeValue = token.text;
        if (textNode.parentElement) {
          flashChangedToken(textNode.parentElement);
        }
      }
      tokenIndex += 1;
    });
  });
}

type RenderedSourcePreview = {
  signature: string;
  lineSignatures: string[];
  textNodes: Text[];
  lineElements: HTMLElement[];
};

const LAST_RENDERED_SOURCE = new WeakMap<HTMLElement, RenderedSourcePreview>();

const FLASH_DURATION_MS = 600;
const FLASH_TIMERS = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function flashChangedToken(tokenElement: HTMLElement): void {
  tokenElement.classList.add("sourceToken--changed");
  const pending = FLASH_TIMERS.get(tokenElement);
  if (pending !== undefined) {
    clearTimeout(pending);
  }
  FLASH_TIMERS.set(
    tokenElement,
    setTimeout(() => {
      tokenElement.classList.remove("sourceToken--changed");
      FLASH_TIMERS.delete(tokenElement);
    }, FLASH_DURATION_MS)
  );
}

function flashLineTokens(lineElement: HTMLElement): void {
  lineElement.querySelectorAll<HTMLElement>(".sourceToken").forEach((tokenElement) => {
    if (tokenElement.textContent?.trim()) {
      flashChangedToken(tokenElement);
    }
  });
}

function sourceLineSignature(line: SourceLine): string {
  return line.map((token) => `${token.kind}:${token.className ?? ""}`).join(",");
}

function mountSourcePreview(
  target: HTMLElement,
  lines: readonly SourceLine[],
  signature: string,
  lineSignatures: string[]
): RenderedSourcePreview {
  const fragment = document.createDocumentFragment();
  const textNodes: Text[] = [];
  const lineElements: HTMLElement[] = [];

  lines.forEach((line) => {
    const lineElement = document.createElement("span");
    lineElement.className = "sourceLine";
    line.forEach((token) => {
      const tokenElement = document.createElement("span");
      tokenElement.className = getTokenClassName(token);
      const textNode = document.createTextNode(token.text);
      textNodes.push(textNode);
      tokenElement.append(textNode);
      lineElement.append(tokenElement);
    });
    fragment.append(lineElement);
    lineElements.push(lineElement);
  });

  target.replaceChildren(fragment);
  return { signature, lineSignatures, textNodes, lineElements };
}

export const SourcePreview = forwardRef<HTMLElement, SourcePreviewProps>(function SourcePreview(
  { lines, managedImperatively = false, layoutItemId },
  ref
): ReactNode {
  return (
    <pre className="sourcePreview" aria-label="TikZ source preview" data-layout-item={layoutItemId}>
      <code className="sourcePreviewCode" ref={ref}>
        {managedImperatively ? null : lines.map((line, lineIndex) => (
          <span className="sourceLine" key={lineIndex}>
            {line.map((token, tokenIndex) => (
              <span className={getTokenClassName(token)} key={`${lineIndex}-${tokenIndex}`}>
                {token.text}
              </span>
            ))}
          </span>
        ))}
      </code>
    </pre>
  );
});
