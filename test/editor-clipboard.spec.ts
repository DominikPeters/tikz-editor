import { describe, expect, it } from "vitest";
import { parseClipboardPayloadJson } from "../packages/app/src/ui/editor-clipboard";

describe("clipboard JSON validation", () => {
  it.each([null, [], true, 42, "clipboard", {},
    { version: 1, snippets: [null, {}, 42, " "] },
    { version: 2, snippets: ["valid text"] }
  ])("rejects unusable clipboard payloads: %j", (payload) => {
    expect(parseClipboardPayloadJson(JSON.stringify(payload))).toBeNull();
  });

  it("keeps valid snippets and normalizes untrusted optional metadata", () => {
    expect(parseClipboardPayloadJson(JSON.stringify({
      version: 1, snippets: [null, 42, {}, " ", "  \\draw (0,0);\r\n"],
      pasteBehavior: {}, pasteCount: "3", plainText: ["untrusted"]
    }))).toEqual({ version: 1, snippets: ["\\draw (0,0);"], plainText: "\\draw (0,0);",
      pasteBehavior: "offset", pasteCount: 0 });
  });
});
