export type SourceRenderOffsetMap = {
  sourceToRender: (sourceOffset: number) => number;
  renderToSource: (renderOffset: number) => number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function equivalentChars(source: string, render: string): boolean {
  if (source === render) {
    return true;
  }
  const sourceWhitespace = /\s/.test(source);
  const renderWhitespace = /\s/.test(render);
  return sourceWhitespace && renderWhitespace;
}

export function createSourceRenderOffsetMap(sourceText: string, renderText: string): SourceRenderOffsetMap {
  const sourceLength = sourceText.length;
  const renderLength = renderText.length;
  const width = renderLength + 1;
  const distance = Array.from<number>({ length: (sourceLength + 1) * (renderLength + 1) }).fill(0);

  for (let sourceIndex = 0; sourceIndex <= sourceLength; sourceIndex += 1) {
    distance[sourceIndex * width] = sourceIndex;
  }
  for (let renderIndex = 0; renderIndex <= renderLength; renderIndex += 1) {
    distance[renderIndex] = renderIndex;
  }

  for (let sourceIndex = 1; sourceIndex <= sourceLength; sourceIndex += 1) {
    for (let renderIndex = 1; renderIndex <= renderLength; renderIndex += 1) {
      const sourceChar = sourceText[sourceIndex - 1] ?? "";
      const renderChar = renderText[renderIndex - 1] ?? "";
      const substitutionCost = equivalentChars(sourceChar, renderChar) ? 0 : 1;
      const substitution = distance[(sourceIndex - 1) * width + (renderIndex - 1)] + substitutionCost;
      const deletion = distance[(sourceIndex - 1) * width + renderIndex] + 1;
      const insertion = distance[sourceIndex * width + (renderIndex - 1)] + 1;
      distance[sourceIndex * width + renderIndex] = Math.min(substitution, deletion, insertion);
    }
  }

  const operations: Array<"match" | "delete" | "insert"> = [];
  let sourceCursor = sourceLength;
  let renderCursor = renderLength;
  while (sourceCursor > 0 || renderCursor > 0) {
    const current = distance[sourceCursor * width + renderCursor];
    if (sourceCursor > 0 && renderCursor > 0) {
      const sourceChar = sourceText[sourceCursor - 1] ?? "";
      const renderChar = renderText[renderCursor - 1] ?? "";
      const substitutionCost = equivalentChars(sourceChar, renderChar) ? 0 : 1;
      const diagonal = distance[(sourceCursor - 1) * width + (renderCursor - 1)] + substitutionCost;
      if (substitutionCost === 0 && diagonal === current) {
        operations.push("match");
        sourceCursor -= 1;
        renderCursor -= 1;
        continue;
      }
    }
    if (sourceCursor > 0) {
      const deletion = distance[(sourceCursor - 1) * width + renderCursor] + 1;
      if (deletion === current) {
        operations.push("delete");
        sourceCursor -= 1;
        continue;
      }
    }
    if (renderCursor > 0) {
      const insertion = distance[sourceCursor * width + (renderCursor - 1)] + 1;
      if (insertion === current) {
        operations.push("insert");
        renderCursor -= 1;
        continue;
      }
    }
    if (sourceCursor > 0 && renderCursor > 0) {
      operations.push("match");
      sourceCursor -= 1;
      renderCursor -= 1;
      continue;
    }
    if (sourceCursor > 0) {
      operations.push("delete");
      sourceCursor -= 1;
      continue;
    }
    operations.push("insert");
    renderCursor -= 1;
  }
  operations.reverse();

  const sourceToRenderMap = Array.from<number>({ length: sourceLength + 1 }).fill(0);
  const renderToSourceMap = Array.from<number>({ length: renderLength + 1 }).fill(0);
  let sourceIndex = 0;
  let renderIndex = 0;
  sourceToRenderMap[0] = 0;
  renderToSourceMap[0] = 0;

  for (const operation of operations) {
    if (operation === "match") {
      sourceIndex += 1;
      renderIndex += 1;
      sourceToRenderMap[sourceIndex] = renderIndex;
      renderToSourceMap[renderIndex] = sourceIndex;
      continue;
    }
    if (operation === "delete") {
      sourceIndex += 1;
      sourceToRenderMap[sourceIndex] = renderIndex;
      continue;
    }
    renderIndex += 1;
    renderToSourceMap[renderIndex] = sourceIndex;
  }

  for (let index = 1; index <= sourceLength; index += 1) {
    if (!Number.isFinite(sourceToRenderMap[index])) {
      sourceToRenderMap[index] = sourceToRenderMap[index - 1] ?? 0;
    }
  }
  for (let index = 1; index <= renderLength; index += 1) {
    if (!Number.isFinite(renderToSourceMap[index])) {
      renderToSourceMap[index] = renderToSourceMap[index - 1] ?? 0;
    }
  }

  return {
    sourceToRender: (offset: number) => {
      const bounded = clamp(Math.floor(offset), 0, sourceLength);
      return sourceToRenderMap[bounded] ?? 0;
    },
    renderToSource: (offset: number) => {
      const bounded = clamp(Math.floor(offset), 0, renderLength);
      return renderToSourceMap[bounded] ?? 0;
    }
  };
}
