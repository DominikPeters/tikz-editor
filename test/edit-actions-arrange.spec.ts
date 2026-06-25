import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";

describe("applyEditAction – alignElements", () => {
  const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,2) -- (3,2);
\end{tikzpicture}`;

  it("returns unsupported when fewer than two unique elements are selected", () => {
    const result = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:0", " "],
      mode: "left"
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("at least 2");
    }
  });

  it("aligns left/center/right using selection bounds", () => {
    const left = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "left"
    });
    expect(left.kind).toBe("success");
    if (left.kind === "success") {
      expect(left.newSource).toContain("\\draw (0,2) -- (1,2);");
    }

    const center = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "center"
    });
    expect(center.kind).toBe("success");
    if (center.kind === "success") {
      expect(center.newSource).toContain("\\draw (1,0) -- (2,0);");
      expect(center.newSource).toContain("\\draw (1,2) -- (2,2);");
    }

    const right = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "right"
    });
    expect(right.kind).toBe("success");
    if (right.kind === "success") {
      expect(right.newSource).toContain("\\draw (2,0) -- (3,0);");
    }
  });

  it("aligns top/middle/bottom in world y-up coordinates", () => {
    const top = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "top"
    });
    expect(top.kind).toBe("success");
    if (top.kind === "success") {
      expect(top.newSource).toContain("\\draw (0,2) -- (1,2);");
    }

    const middle = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "middle"
    });
    expect(middle.kind).toBe("success");
    if (middle.kind === "success") {
      expect(middle.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(middle.newSource).toContain("\\draw (2,1) -- (3,1);");
    }

    const bottom = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "bottom"
    });
    expect(bottom.kind).toBe("success");
    if (bottom.kind === "success") {
      expect(bottom.newSource).toContain("\\draw (2,0) -- (3,0);");
    }
  });

  it("returns unsupported for no-op aligns", () => {
    const aligned = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;
    const result = applyEditAction(aligned, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "left"
    });
    expect(result.kind).toBe("unsupported");
  });

  it("fails atomically when any selected element is non-rewritable", () => {
    const mixed = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
\end{tikzpicture}`;

    const result = applyEditAction(mixed, [], {
      kind: "alignElements",
      elementIds: ["path:2", "path:3"],
      mode: "left"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("unsupported coordinate forms");
    }
  });
});

describe("applyEditAction – distributeElements", () => {
  it("returns unsupported when fewer than three unique elements are selected", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:1"],
      axis: "horizontal"
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("at least 3");
    }
  });

  it("distributes horizontal gaps with endpoints fixed", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "horizontal"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (5,0) -- (6,0);");
      expect(result.newSource).toContain("\\draw (10,0) -- (11,0);");
    }
  });

  it("distributes vertical gaps with endpoints fixed", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,10) -- (1,10);
  \draw (0,6) -- (1,6);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "vertical"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,10) -- (1,10);");
      expect(result.newSource).toContain("\\draw (0,5) -- (1,5);");
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    }
  });

  it("returns unsupported for no-op distributions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,4) -- (1,4);
  \draw (0,2) -- (1,2);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "vertical"
    });
    expect(result.kind).toBe("unsupported");
  });

  it("fails atomically when any selected element is non-rewritable", () => {
    const mixed = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const result = applyEditAction(mixed, [], {
      kind: "distributeElements",
      elementIds: ["path:2", "path:3", "path:4"],
      axis: "horizontal"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("unsupported coordinate forms");
    }
  });
});
