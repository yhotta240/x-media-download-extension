import { Zip, ZipPassThrough } from "fflate";
import { imageMedia, isMp4Url } from "../media/parse.ts";
import type { ArchiveFile } from "./types.ts";

/** 再圧縮せず，取得を完了できたファイルだけを表示順に格納する． */
export async function buildZip(
  files: ArchiveFile[],
  signal?: AbortSignal,
  fetchMedia: typeof fetch = fetch,
): Promise<{ blob: Blob; failed: boolean; errors: string[] }> {
  const chunks: BlobPart[] = [];
  let zipError: Error | null = null;
  let size = 0;
  const zip = new Zip((error, data) => {
    size += data?.length ?? 0;
    // このZIP形式の32bit上限を超えた場合，壊れたファイルとして保存しない．
    if (size >= 0xffffffff) zipError = new Error("ZIPのサイズが対応範囲を超えています");
    else if (error) zipError = error;
    else if (!zipError) chunks.push(data as Uint8Array<ArrayBuffer>);
  });
  let count = 0;
  const errors: string[] = [];
  for (const file of files) {
    let bytes: Uint8Array;
    try {
      if (!file.url || (!imageMedia(file.url) && !isMp4Url(file.url)))
        throw new Error(file.error ?? "保存可能なメディアURLがありません");
      const response = await fetchMedia(file.url, { credentials: "include", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(
        `${file.filename}: ${error instanceof Error ? error.message : "取得に失敗しました"}`,
      );
      continue;
    }
    // 取得中に失敗したファイルを途中までZIPへ入れないため，ここで初めて追加する．
    const entry = new ZipPassThrough(file.filename);
    zip.add(entry);
    entry.push(bytes, true);
    if (zipError) throw zipError;
    count++;
  }
  if (!count) throw new Error(`保存できるメディアがありません\n${errors.join("\n")}`);
  zip.end();
  if (zipError) throw zipError;
  return { blob: new Blob(chunks, { type: "application/zip" }), failed: errors.length > 0, errors };
}
