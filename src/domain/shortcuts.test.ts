import { describe, expect, it } from "vitest";

import {
  parseEditorShortcut,
  shortcutToEditorAction,
} from "./shortcuts";

describe("editor shortcut parsing", () => {
  it.each([
    ["1", { type: "input-degree", degree: 1 }],
    ["4", { type: "input-degree", degree: 4 }],
    ["7", { type: "input-degree", degree: 7 }],
    ["0", { type: "input-rest" }],
    ["Backspace", { type: "delete-backward" }],
    ["Delete", { type: "delete-forward" }],
  ])("maps unmodified %s to an editing command", (key, expected) => {
    expect(parseEditorShortcut({ key })).toEqual(expected);
  });

  it.each([
    ["a", "select-all"],
    ["c", "copy"],
    ["x", "cut"],
    ["v", "paste"],
    ["z", "undo"],
    ["y", "redo"],
  ])("supports Ctrl+%s and Meta+%s", (key, type) => {
    expect(parseEditorShortcut({ key, ctrlKey: true })).toEqual({ type });
    expect(parseEditorShortcut({ key, metaKey: true })).toEqual({ type });
  });

  it("supports Shift+primary+Z for redo", () => {
    expect(
      parseEditorShortcut({ key: "z", metaKey: true, shiftKey: true }),
    ).toEqual({ type: "redo" });
  });

  it("ignores composition, Alt combinations and modified number input", () => {
    expect(parseEditorShortcut({ key: "1", isComposing: true })).toBeNull();
    expect(parseEditorShortcut({ key: "1", altKey: true })).toBeNull();
    expect(parseEditorShortcut({ key: "1", shiftKey: true })).toBeNull();
    expect(parseEditorShortcut({ key: "1", ctrlKey: true })).toBeNull();
    expect(parseEditorShortcut({ key: "F2" })).toBeNull();
  });

  it("converts parsed shortcuts directly into reducer actions", () => {
    const shortcut = parseEditorShortcut({ key: "6" });

    expect(shortcut).not.toBeNull();
    if (shortcut === null) {
      throw new Error("Expected a parsed shortcut.");
    }
    expect(shortcutToEditorAction(shortcut)).toEqual({
      type: "input-degree",
      degree: 6,
    });
  });
});
