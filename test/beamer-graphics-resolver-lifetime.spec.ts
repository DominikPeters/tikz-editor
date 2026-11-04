import { expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { collectTestGarbage } from "./setup/gc.js";

it("lets a prepared document release replaced graphics resolvers and their assets", async () => {
  // Ordinary functional assertions cannot tell whether a cache still owns an
  // obsolete resolver and all its images.
  const prepared = prepareBeamerDocument(String.raw`\documentclass{beamer}
    \begin{document}\begin{frame}body\end{frame}\end{document}`);
  const references: WeakRef<object>[] = [];
  async function renderWithAssetRevision(index: number) {
    const resolver = {
      cacheKey: `revision:${index}`,
      resolve: () => ({ status: "missing" as const }),
      assetBytes: new Uint8Array(1024),
    };
    await prepared.renderFrame({ graphicsResolver: resolver });
    return new WeakRef(resolver);
  }
  for (let index = 0; index < 8; index++) {
    references.push(await renderWithAssetRevision(index));
  }
  await collectTestGarbage();
  expect(references.filter(reference => reference.deref())).toHaveLength(0);
  expect(prepared.document.frames).toHaveLength(1);
});
