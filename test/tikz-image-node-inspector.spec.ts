import { describe, expect, it } from "vitest";
import { includegraphicsSections, replaceIncludegraphicsFile, setIncludegraphicsOption } from "../packages/core/src/beamer/index.js";
import { imageNodeCommandSpan } from "../packages/core/src/edit/graphics-node-size.js";
import { parseTikz } from "../packages/core/src/parser/index.js";

const picture = (body: string) => String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
  ${body}
\end{tikzpicture}`;

function spanOf(source: string, elementId = "path:1") {
  return imageNodeCommandSpan(source, parseTikz(source).figure.body, elementId);
}

function apply(source: string, result: ReturnType<typeof setIncludegraphicsOption>): string {
  if (result.kind !== "success") throw new Error(result.kind === "unsupported" ? result.reason : "error");
  return result.newSource;
}

describe("image nodes in the TikZ inspector", () => {
  it("finds the command of a node that holds only an image", () => {
    const source = picture(String.raw`\node[inner sep=0pt] at (2,1) { \includegraphics[width=3cm]{photo.png} };`);
    const span = spanOf(source);
    expect(span && source.slice(span.from, span.to)).toBe(String.raw`\includegraphics[width=3cm]{photo.png}`);
    expect(spanOf(picture(String.raw`\node at (2,1) {A \includegraphics{photo.png}};`))).toBeNull();
    expect(spanOf(source, "path:0")).toBeNull();
  });

  it("shows File and Size with centimetre lengths and no crop", () => {
    const source = picture(String.raw`\node[inner sep=0pt] at (2,1) {\includegraphics[width=3cm]{figures/photo.png}};`);
    const sections = includegraphicsSections(source, spanOf(source)!, { lengthSuffix: { width: "cm", height: "cm" }, crop: false });
    expect(sections.map(section => section.id)).toEqual(["image", "size"]);
    const fields = sections.flatMap(section => section.fields);
    expect(fields.find(field => field.id === "file")).toMatchObject({ kind: "file", name: "photo.png" });
    expect(fields.find(field => field.id === "width")).toMatchObject({ kind: "number", value: 3, unit: "cm" });
    expect(fields.find(field => field.id === "height")).toMatchObject({ write: { kind: "setGraphicsOption", key: "height", suffix: "cm" } });
  });

  it("sets, adds and removes options and replaces the file inside the node", () => {
    const source = picture(String.raw`\node[inner sep=0pt] at (2,1) {\includegraphics[width=3cm]{photo.png}};`);
    const width = apply(source, setIncludegraphicsOption(source, spanOf(source)!, "width", "4cm"));
    expect(width).toContain(String.raw`{\includegraphics[width=4cm]{photo.png}};`);
    const flag = apply(width, setIncludegraphicsOption(width, spanOf(width)!, "keepaspectratio", true));
    expect(flag).toContain(String.raw`\includegraphics[width=4cm, keepaspectratio]{photo.png}`);
    const removed = apply(flag, setIncludegraphicsOption(flag, spanOf(flag)!, "width", null));
    expect(removed).toContain(String.raw`\includegraphics[keepaspectratio]{photo.png}`);
    const replaced = apply(removed, replaceIncludegraphicsFile(removed, spanOf(removed)!, "figures/other.jpg"));
    expect(replaced).toContain(String.raw`\includegraphics[keepaspectratio]{figures/other.jpg}`);
    expect(replaced).toContain(String.raw`\draw (0,0) -- (1,1);`);
  });
});
