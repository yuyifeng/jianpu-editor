import {
  parseScoreDocument,
  serializeScore,
  type Score,
  type ScoreDocumentError,
} from "./domain";

export const JSON_FILE_ACCEPT = ".json,application/json";
export const SCORE_JSON_MIME_TYPE = "application/json;charset=utf-8";

const UNSAVED_NEW_SCORE_MESSAGE =
  "当前乐谱尚未成功保存。新建将丢失这些修改，是否继续？";
const IMPORT_SCORE_MESSAGE = "导入将替换当前乐谱并清除撤销历史，是否继续？";

export type ScoreImportResult =
  | { readonly ok: true; readonly score: Score }
  | { readonly ok: false; readonly error: ScoreDocumentError };

export interface DownloadEnvironment {
  readonly document: Pick<Document, "createElement" | "body">;
  readonly url: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

export function importScoreJson(json: string): ScoreImportResult {
  const parsed = parseScoreDocument(json);
  return parsed.ok
    ? { ok: true, score: parsed.value.score }
    : { ok: false, error: parsed.error };
}

export function createScoreExport(score: Score): {
  readonly filename: string;
  readonly content: string;
  readonly mimeType: typeof SCORE_JSON_MIME_TYPE;
} {
  const safeTitle =
    score.title
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .split("")
      .map((character) => (character.charCodeAt(0) <= 31 ? "-" : character))
      .join("")
      .replace(/\.+$/g, "")
      .slice(0, 80) || "未命名歌曲";

  return {
    filename: `${safeTitle}.jianpu.json`,
    content: serializeScore(score),
    mimeType: SCORE_JSON_MIME_TYPE,
  };
}

export function confirmNewScore(
  hasUnsavedChanges: boolean,
  confirm: (message: string) => boolean = (message) => window.confirm(message),
): boolean {
  return !hasUnsavedChanges || confirm(UNSAVED_NEW_SCORE_MESSAGE);
}

export function confirmScoreImport(
  confirm: (message: string) => boolean = (message) => window.confirm(message),
): boolean {
  return confirm(IMPORT_SCORE_MESSAGE);
}

export function selectJsonFile(
  documentRef: Document = document,
): Promise<File | null> {
  return new Promise((resolve) => {
    const input = documentRef.createElement("input");
    let settled = false;
    const settle = (file: File | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(file);
    };

    input.type = "file";
    input.accept = JSON_FILE_ACCEPT;
    input.addEventListener("change", () => settle(input.files?.[0] ?? null), {
      once: true,
    });
    input.addEventListener("cancel", () => settle(null), { once: true });
    input.click();
  });
}

export async function readJsonFile(file: Pick<File, "text">): Promise<string> {
  return file.text();
}

export function downloadScoreJson(
  score: Score,
  environment: DownloadEnvironment = { document, url: URL },
): void {
  const exported = createScoreExport(score);
  const blob = new Blob([exported.content], { type: exported.mimeType });
  const objectUrl = environment.url.createObjectURL(blob);
  const anchor = environment.document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = exported.filename;
  anchor.hidden = true;
  try {
    environment.document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    environment.url.revokeObjectURL(objectUrl);
  }
}
