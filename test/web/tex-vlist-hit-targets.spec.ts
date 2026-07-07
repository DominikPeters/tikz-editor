import { describe, expect, it } from "vitest";
import {
  getKnuthPlassVListGeometrySnapshot,
  getKnuthPlassVListSourceHit,
  getKnuthPlassVListSourceHitFromSnapshot,
  getKnuthPlassVListTreeHitFromSnapshot,
} from "../../packages/core/src/text/knuth-plass/index";
import type {
  VListGeometrySnapshot,
  VListGeometryTreeNode,
  VListItemGeometry,
  VListLabelHitResult
} from "../../packages/core/src/text/knuth-plass/index";
import { clientPoint, px } from "../../packages/core/src/coords/index.js";
import { layoutSimpleTexParagraph } from "../../packages/core/src/text/tex/index.js";
import { registerTexVListLayoutsOnOutputJax } from "../../packages/core/src/text/tex/vlist/index.js";

function registeredSnapshotForSource(
  source: string,
  options: { readonly fallbackPolicy?: "whole-node" | "placeholder" } = {}
): VListGeometrySnapshot {
  const result = layoutSimpleTexParagraph(source, {
    paragraphId: "tex:vlist-hit-source",
    width: 150,
    parindent: 0,
    tolerance: 200,
    hyphenator: { hyphenate: () => [] },
    fallbackPolicy: options.fallbackPolicy,
  });
  if (!result.vlistLayout) {
    throw new Error(`expected registered vlist layout: ${result.fallbackReason ?? "missing layout"}`);
  }
  const outputJax = {};
  registerTexVListLayoutsOnOutputJax(outputJax, [{
    paragraphId: "tex:vlist-hit-source",
    layout: result.vlistLayout,
  }]);
  return getKnuthPlassVListGeometrySnapshot({
    outputJax,
    paragraphId: "tex:vlist-hit-source",
    containerElement: {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    },
  });
}

function centerPoint(item: {
  readonly clientLeft: number;
  readonly clientRight: number;
  readonly clientTop: number;
  readonly clientBottom: number;
}) {
  return clientPoint(
    px((item.clientLeft + item.clientRight) / 2),
    px((item.clientTop + item.clientBottom) / 2)
  );
}

function labelHit(params: {
  labelStart: number | null;
  labelEnd: number | null;
  paragraphStart?: number;
}): VListLabelHitResult {
  return {
    label: {
      kind: "hbox",
      hboxRole: "list-label",
      listLabelKind: "custom",
      listLabelPlacement: "margin",
      listKind: "enumerate",
      listDepth: 1,
      listLabelDepth: 1,
      listItemIndex: 1,
      listLabelBlockIndex: 0,
      displayAlignDelimiter: null,
      displayAlignRowIndex: null,
      vlistPath: [0],
      localLeft: 0,
      localRight: 4,
      localTop: 0,
      localBottom: 4,
      sourceStart: params.labelStart,
      sourceEnd: params.labelEnd,
      placeholderReason: null,
      clientLeft: 0,
      clientRight: 4,
      clientTop: 0,
      clientBottom: 4,
    },
    paragraph: params.paragraphStart == null
      ? null
      : {
          blockIndex: 0,
          vlistPath: [1],
          localLeft: 10,
          localRight: 20,
          localTop: 0,
          localBottom: 8,
          lineIndices: [0],
          sourceHitPolicy: "caret",
          sourceStart: params.paragraphStart,
          sourceEnd: params.paragraphStart + 10,
          clientLeft: 10,
          clientRight: 20,
          clientTop: 0,
          clientBottom: 8,
        },
  };
}

function itemHit(
  kind: VListItemGeometry["kind"],
  sourceStart: number | null,
  sourceEnd: number | null,
  clientBounds: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } = { left: 0, right: 10, top: 0, bottom: 10 }
): VListItemGeometry {
  return {
    kind,
    vlistPath: [2],
    localLeft: 0,
    localRight: 10,
    localTop: 0,
    localBottom: 10,
    sourceStart,
    sourceEnd,
    placeholderReason: kind === "placeholder" ? "Unsupported TeX command in vertical mode." : null,
    hboxRole: kind === "hbox" ? "list-label" : null,
    listLabelKind: kind === "hbox" ? "default" : null,
    listLabelPlacement: kind === "hbox" ? "margin" : null,
    listKind: kind === "hbox" ? "enumerate" : null,
    listDepth: kind === "hbox" ? 1 : null,
    listLabelDepth: kind === "hbox" ? 1 : null,
    listItemIndex: kind === "hbox" ? 1 : null,
    listLabelBlockIndex: kind === "hbox" ? 0 : null,
    displayAlignDelimiter: null,
    displayAlignRowIndex: null,
    clientLeft: clientBounds.left,
    clientRight: clientBounds.right,
    clientTop: clientBounds.top,
    clientBottom: clientBounds.bottom,
  };
}

function treeNode(params: {
  item?: VListItemGeometry | null;
  paragraph?: VListLabelHitResult["paragraph"];
  children?: readonly VListGeometryTreeNode[];
  bounds?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
}): VListGeometryTreeNode {
  const bounds = params.bounds ?? { left: 0, right: 10, top: 0, bottom: 10 };
  const item = params.item ?? null;
  return {
    itemKind: item?.kind ?? (params.paragraph ? "paragraph" : "vbox"),
    vlistPath: item?.vlistPath ?? params.paragraph?.vlistPath ?? [],
    localLeft: item?.localLeft ?? params.paragraph?.localLeft ?? null,
    localRight: item?.localRight ?? params.paragraph?.localRight ?? null,
    localTop: item?.localTop ?? params.paragraph?.localTop ?? null,
    localBottom: item?.localBottom ?? params.paragraph?.localBottom ?? null,
    sourceStart: item?.sourceStart ?? params.paragraph?.sourceStart ?? null,
    sourceEnd: item?.sourceEnd ?? params.paragraph?.sourceEnd ?? null,
    clientLeft: bounds.left,
    clientRight: bounds.right,
    clientTop: bounds.top,
    clientBottom: bounds.bottom,
    blockIndex: params.paragraph?.blockIndex ?? item?.listLabelBlockIndex ?? null,
    box: null,
    item,
    paragraph: params.paragraph ?? null,
    children: params.children ?? [],
  };
}

function treeHasItemKind(
  nodes: readonly VListGeometryTreeNode[],
  itemKind: string
): boolean {
  return nodes.some((node) =>
    node.itemKind === itemKind || treeHasItemKind(node.children, itemKind)
  );
}

describe("TeX vlist hit target source offsets", () => {
  it("prefers source-backed labels over generated-label paragraph ownership", () => {
    expect(getKnuthPlassVListSourceHit({
      labelHit: labelHit({ labelStart: 4, labelEnd: 9, paragraphStart: 20 }),
      itemHit: itemHit("placeholder", 30, 40),
    })).toEqual({ offset: 4 });
    expect(getKnuthPlassVListSourceHit({
      labelHit: labelHit({ labelStart: 4, labelEnd: 9, paragraphStart: 20 }),
      itemHit: itemHit("placeholder", 30, 40),
    })?.offset).toBe(4);
  });

  it("maps generated labels to the owning paragraph body start", () => {
    expect(getKnuthPlassVListSourceHit({
      labelHit: labelHit({ labelStart: null, labelEnd: null, paragraphStart: 20 }),
      itemHit: itemHit("placeholder", 30, 40),
    })).toEqual({ offset: 20 });
    expect(getKnuthPlassVListSourceHit({
      labelHit: labelHit({ labelStart: null, labelEnd: null, paragraphStart: 20 }),
      itemHit: itemHit("placeholder", 30, 40),
    })?.offset).toBe(20);
  });

  it("leaves paragraph body hits for caret geometry instead of selecting the paragraph", () => {
    const paragraphHit = {
        blockIndex: 0,
        vlistPath: [0],
        localLeft: 0,
        localRight: 100,
        localTop: 0,
        localBottom: 12,
        lineIndices: [0],
        sourceHitPolicy: "caret",
        sourceStart: 0,
        sourceEnd: 13,
        clientLeft: 0,
        clientRight: 100,
        clientTop: 0,
        clientBottom: 12,
    };
    expect(getKnuthPlassVListSourceHit({
      paragraphHit: {
        ...paragraphHit,
        sourceHitPolicy: "caret",
      },
    })).toBeNull();
    expect(getKnuthPlassVListSourceHit({
      paragraphHit: {
        ...paragraphHit,
        sourceHitPolicy: "source-range",
      },
    })).toEqual({
      offset: 0,
      selectionRange: { start: 0, end: 13 },
    });
  });

  it("maps source-backed non-text vlist items to source ranges", () => {
    expect(getKnuthPlassVListSourceHit({
      itemHit: itemHit("placeholder", 30, 40),
    })).toEqual({
      offset: 30,
      selectionRange: { start: 30, end: 40 },
    });
    expect(getKnuthPlassVListSourceHit({
      itemHit: itemHit("placeholder", 30, 40),
    })?.offset).toBe(30);
    expect(getKnuthPlassVListSourceHit({
      itemHit: itemHit("rule", 50, 56),
    })).toEqual({
      offset: 50,
      selectionRange: { start: 50, end: 56 },
    });
    expect(getKnuthPlassVListSourceHit({
      itemHit: itemHit("rule", 50, 56),
    })?.offset).toBe(50);
    expect(getKnuthPlassVListSourceHit({
      itemHit: itemHit("glue", 60, 72),
    })).toEqual({
      offset: 60,
      selectionRange: { start: 60, end: 72 },
    });
  });

  it("ignores anonymous items and non-label hboxes", () => {
    expect(getKnuthPlassVListSourceHit({
      itemHit: itemHit("placeholder", 30, 30),
    })).toBeNull();
    expect(getKnuthPlassVListSourceHit({
      itemHit: itemHit("hbox", 10, 14),
    })).toBeNull();
  });

  it("resolves source hits from a single vlist geometry snapshot", () => {
    const hit = labelHit({ labelStart: null, labelEnd: null, paragraphStart: 20 });
    const placeholder = itemHit("placeholder", 30, 40, { left: 10, right: 30, top: 10, bottom: 30 });
    const snapshot: VListGeometrySnapshot = {
      source: "registered",
      boxes: [],
      items: [
        placeholder,
        hit.label,
      ],
      labels: [hit.label],
      paragraphs: hit.paragraph ? [hit.paragraph] : [],
      placeholders: [],
      tree: [
        treeNode({
          bounds: { left: 0, right: 30, top: 0, bottom: 30 },
          children: [
            treeNode({
              item: hit.label,
              bounds: { left: 0, right: 4, top: 0, bottom: 4 },
            }),
            treeNode({
              item: placeholder,
              bounds: { left: 10, right: 30, top: 10, bottom: 30 },
            }),
            ...(hit.paragraph
              ? [
                  treeNode({
                    paragraph: hit.paragraph,
                    bounds: { left: 10, right: 20, top: 0, bottom: 8 },
                  }),
                ]
              : []),
          ],
        }),
      ],
    };

    expect(getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(px(2), px(2)),
    })).toEqual({ offset: 20 });
    expect(getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(px(24), px(24)),
    })).toEqual({
      offset: 30,
      selectionRange: { start: 30, end: 40 },
    });
    expect(getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(px(100), px(100)),
    })).toBeNull();
  });

  it("uses the deepest vlist tree node rather than a broad containing parent", () => {
    const outerPlaceholder = itemHit("placeholder", 5, 90, { left: 0, right: 100, top: 0, bottom: 100 });
    const innerRule = itemHit("rule", 30, 40, { left: 10, right: 20, top: 10, bottom: 20 });
    const snapshot: VListGeometrySnapshot = {
      source: "registered",
      boxes: [],
      items: [outerPlaceholder, innerRule],
      labels: [],
      paragraphs: [],
      placeholders: [],
      tree: [
        treeNode({
          item: outerPlaceholder,
          bounds: { left: 0, right: 100, top: 0, bottom: 100 },
          children: [
            treeNode({
              item: innerRule,
              bounds: { left: 10, right: 20, top: 10, bottom: 20 },
            }),
          ],
        }),
      ],
    };

    expect(getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(px(12), px(12)),
    })).toEqual({
      offset: 30,
      selectionRange: { start: 30, end: 40 },
    });
    expect(getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(px(50), px(50)),
    })).toEqual({
      offset: 5,
      selectionRange: { start: 5, end: 90 },
    });
  });

  it("can hit a descendant whose reported bounds extend outside its parent", () => {
    const childRule = itemHit("rule", 30, 40, { left: 60, right: 80, top: 60, bottom: 80 });
    const snapshot: VListGeometrySnapshot = {
      source: "registered",
      boxes: [],
      items: [childRule],
      labels: [],
      paragraphs: [],
      placeholders: [],
      tree: [
        treeNode({
          bounds: { left: 0, right: 40, top: 0, bottom: 40 },
          children: [
            treeNode({
              item: childRule,
              bounds: { left: 60, right: 80, top: 60, bottom: 80 },
            }),
          ],
        }),
      ],
    };

    expect(getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(px(70), px(70)),
    })).toEqual({
      offset: 30,
      selectionRange: { start: 30, end: 40 },
    });
  });

  it("resolves registered source hits for rules inside quote vboxes", () => {
    const source = String.raw`\begin{quote}Alpha \par \hrule width 24pt height 2pt depth 1pt Beta\end{quote}`;
    const ruleStart = source.indexOf(String.raw`\hrule`);
    const ruleEnd = source.indexOf("Beta");
    const snapshot = registeredSnapshotForSource(source);
    const rule = snapshot.items.find((item) => item.kind === "rule");
    if (!rule) {
      throw new Error("expected registered rule geometry");
    }

    expect(snapshot.source).toBe("registered");
    expect(rule).toMatchObject({
      sourceStart: ruleStart,
      sourceEnd: ruleEnd,
    });
    expect(snapshot.tree[0]).toMatchObject({
      itemKind: "vbox",
      box: { role: "quote" },
    });
    expect(rule.vlistPath.slice(0, 1)).toEqual(snapshot.tree[0]?.vlistPath);

    const point = centerPoint(rule);
    expect(getKnuthPlassVListTreeHitFromSnapshot({
      snapshot,
      clientPoint: point,
    })?.node.itemKind).toBe("rule");
    expect(getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: point,
    })).toEqual({
      offset: ruleStart,
      selectionRange: { start: ruleStart, end: ruleEnd },
    });
  });

  it("resolves registered source hits for explicit glue inside quote vboxes", () => {
    const source = String.raw`\begin{quote}Alpha \par \vspace{7pt} Beta\end{quote}`;
    const glueStart = source.indexOf(String.raw`\vspace`);
    const glueEnd = source.indexOf(" Beta");
    const snapshot = registeredSnapshotForSource(source);
    const glue = snapshot.items.find((item) => item.kind === "glue");
    if (!glue) {
      throw new Error("expected registered explicit glue geometry");
    }

    expect(glue).toMatchObject({
      sourceStart: glueStart,
      sourceEnd: glueEnd,
    });
    expect(glue.clientRight).toBeGreaterThan(glue.clientLeft);
    expect(glue.clientBottom).toBeGreaterThan(glue.clientTop);

    const point = centerPoint(glue);
    const treeHit = getKnuthPlassVListTreeHitFromSnapshot({
      snapshot,
      clientPoint: point,
    });
    expect(treeHit?.node.itemKind).toBe("glue");
    expect(treeHit?.box?.role).toBe("quote");
    expect(getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: point,
    })).toEqual({
      offset: glueStart,
      selectionRange: { start: glueStart, end: glueEnd },
    });
  });

  it("does not expose generated paragraph-boundary glue as source-backed item geometry", () => {
    const snapshot = registeredSnapshotForSource(
      String.raw`\begin{itemize}\item Alpha\item Beta\end{itemize}`
    );

    expect(snapshot.items.filter((item) => item.kind === "glue")).toEqual([]);
    expect(treeHasItemKind(snapshot.tree, "glue")).toBe(true);
  });

  it("resolves registered source hits for display-math placeholders inside list-item vboxes", () => {
    const source = String.raw`\begin{itemize}\item Alpha \par \[\unknown{x}\] \par More\end{itemize}`;
    const placeholderStart = source.indexOf(String.raw`\[`);
    const placeholderEnd = placeholderStart + String.raw`\[\unknown{x}\]`.length;
    const snapshot = registeredSnapshotForSource(source);
    const placeholder = snapshot.items.find((item) => item.kind === "placeholder");
    if (!placeholder) {
      throw new Error("expected registered placeholder geometry");
    }

    expect(snapshot.source).toBe("registered");
    expect(placeholder).toMatchObject({
      sourceStart: placeholderStart,
      sourceEnd: placeholderEnd,
      placeholderReason: "TeX display math rendering is not implemented for this formula.",
    });
    expect(snapshot.placeholders).toEqual([
      expect.objectContaining({
        sourceStart: placeholderStart,
        sourceEnd: placeholderEnd,
        reason: "TeX display math rendering is not implemented for this formula.",
      }),
    ]);

    const point = centerPoint(placeholder);
    const treeHit = getKnuthPlassVListTreeHitFromSnapshot({
      snapshot,
      clientPoint: point,
    });
    expect(treeHit?.node.itemKind).toBe("placeholder");
    expect(treeHit?.path.map((node) => node.itemKind)).toEqual([
      "vbox",
      "vbox",
      "placeholder",
    ]);
    expect(treeHit?.path.map((node) => node.box?.role ?? null)).toEqual([
      "list",
      "list-item",
      null,
    ]);
    expect(getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: point,
    })).toEqual({
      offset: placeholderStart,
      selectionRange: { start: placeholderStart, end: placeholderEnd },
    });
  });

  it("keeps unknown commands inside list items as paragraphs, not placeholders", () => {
    const source = String.raw`\begin{itemize}\item Alpha \par \unsupportedgraphics{plot.pdf} \par More\end{itemize}`;
    const snapshot = registeredSnapshotForSource(source);

    expect(snapshot.source).toBe("registered");
    expect(snapshot.placeholders).toEqual([]);
    expect(snapshot.items.filter((item) => item.kind === "placeholder")).toEqual([]);
    expect(treeHasItemKind(snapshot.tree, "placeholder")).toBe(false);
    expect(treeHasItemKind(snapshot.tree, "paragraph")).toBe(true);
  });
});
