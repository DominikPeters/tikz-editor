import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { graphicBytesBase64 } from "../packages/app/src/imported-graphics";

describe("imported graphic binary encoding", () => {
  it.each([0, 1, 255, 32767, 32768, 32769, 100_001])("preserves every byte for %i-byte inputs, including chunk boundaries", (size) => {
    const bytes = new Uint8Array(size);
    for (let index = 0; index < size; index++) bytes[index] = index % 256;
    expect(graphicBytesBase64(bytes.buffer)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
