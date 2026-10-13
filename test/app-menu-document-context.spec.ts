import { describe, expect, it } from "vitest";
import { APP_MENU_DEFINITION, APP_MENU_COMMAND_IDS, appMenuForDocument } from "../packages/app/src/app-menu/index.js";

describe("document and presentation menus", () => {
  it("adds Present for decks and keeps drawing tools accessible inside an embedded diagram", () => {
    const drawing = appMenuForDocument(APP_MENU_DEFINITION, { kind: "tikz", nestedDrawing: false, presenting: false });
    expect(drawing.some(section => section.id === "present")).toBe(false);
    const deck = appMenuForDocument(APP_MENU_DEFINITION, { kind: "beamer", nestedDrawing: false, presenting: false });
    expect(deck.some(section => section.id === "present")).toBe(true);
    expect(deck.some(section => section.id === "path")).toBe(false);
    // On a slide, Insert's drawing tools open the slide's drawing layer.
    const insert = deck.find(section => section.id === "insert")!;
    expect(insert.items.some(item => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.INSERT_RECT)).toBe(true);
    const nested = appMenuForDocument(APP_MENU_DEFINITION, { kind: "beamer", nestedDrawing: true, presenting: false });
    expect(nested.some(section => section.id === "path")).toBe(true);
    expect(nested.some(section => section.id === "present")).toBe(true);
  });
  it("retains session controls on a TikZ tab and routes the focused viewer's close action as Close Window", () => {
    const menu = appMenuForDocument(APP_MENU_DEFINITION, { kind: "tikz", nestedDrawing: false, presenting: true, focus: "presenter" });
    const present = menu.find(section => section.id === "present")!;
    expect(present.items.some(item => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.PRESENT_END)).toBe(true);
    expect(present.items.some(item => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.PRESENT_CURRENT)).toBe(false);
    const close = menu.find(section => section.id === "file")!.items.find(item => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.CLOSE_DOCUMENT);
    expect(close).toMatchObject({ label: "Close Window" });
  });
});
