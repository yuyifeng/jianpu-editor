import type { EditorAction } from "./editing";
import type { ScaleDegree } from "./score";

export interface EditorKeyInput {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly isComposing?: boolean;
}

export type EditorShortcut =
  | { readonly type: "input-degree"; readonly degree: ScaleDegree }
  | { readonly type: "input-rest" }
  | { readonly type: "delete-backward" }
  | { readonly type: "delete-forward" }
  | { readonly type: "copy" }
  | { readonly type: "cut" }
  | { readonly type: "paste" }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "select-all" };

function isPrimaryModifier(input: EditorKeyInput): boolean {
  return Boolean(input.ctrlKey || input.metaKey);
}

export function parseEditorShortcut(
  input: EditorKeyInput,
): EditorShortcut | null {
  if (input.isComposing || input.altKey) {
    return null;
  }

  const key = input.key.toLowerCase();
  const primaryModifier = isPrimaryModifier(input);
  if (!primaryModifier && !input.shiftKey && /^[1-7]$/.test(key)) {
    return { type: "input-degree", degree: Number(key) as ScaleDegree };
  }
  if (!primaryModifier && !input.shiftKey && key === "0") {
    return { type: "input-rest" };
  }
  if (!primaryModifier && key === "backspace") {
    return { type: "delete-backward" };
  }
  if (!primaryModifier && key === "delete") {
    return { type: "delete-forward" };
  }
  if (!primaryModifier) {
    return null;
  }

  switch (key) {
    case "a":
      return { type: "select-all" };
    case "c":
      return { type: "copy" };
    case "x":
      return { type: "cut" };
    case "v":
      return { type: "paste" };
    case "y":
      return { type: "redo" };
    case "z":
      return { type: input.shiftKey ? "redo" : "undo" };
    default:
      return null;
  }
}

export function shortcutToEditorAction(
  shortcut: EditorShortcut,
): EditorAction {
  return shortcut;
}
