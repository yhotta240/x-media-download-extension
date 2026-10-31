import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import { buildZip } from "../src/archive/zip.ts";
import { normalizeSettings } from "../src/settings.ts";

test("未保存・旧設定・不正な保存方式は個別保存とし，ZIP設定を復元する", () => {
  for (const value of [undefined, null, {}, { multipleMediaMode: "other" }]) {
    assert.equal(normalizeSettings(value).multipleMediaMode, "individual");
  }
  assert.deepEqual(normalizeSettings({ multipleMediaMode: "zip", other: true }), {
    multipleMediaMode: "zip", other: true,
  });
});

const files = [
  { url: "https://pbs.twimg.com/media/a?format=jpg&name=orig", filename: "example_123_1.jpg" },
  { url: "https://video.twimg.com/a.mp4", filename: "example_123_2.mp4" },
];

test("画像・動画を再圧縮せず，元の名前・順序・内容でZIPへ保存する", async () => {
  const bytes = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7])];
  const calls: string[] = [];
  const fetchMedia = (async (url: string) => {
    calls.push(url);
    return new Response(bytes[files.findIndex((file) => file.url === url)]);
  }) as typeof fetch;
  const result = await buildZip(files, undefined, fetchMedia);
  assert.equal(result.failed, false);
  assert.deepEqual(calls, files.map((file) => file.url));
  const zip = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(new DataView(zip.buffer).getUint16(8, true), 0, "ZIPの格納方式は無圧縮");
  const extracted = unzipSync(zip);
  assert.deepEqual(Object.keys(extracted), files.map((file) => file.filename));
  assert.deepEqual(Object.values(extracted), bytes);
});

test("取得途中で失敗したメディアをZIPへ混入させず，元の連番で成功分を残す", async () => {
  const fetchMedia = (async (url: string) => {
    if (url === files[0].url) return {
      ok: true, async arrayBuffer() { throw new Error("NETWORK_FAILED"); },
    };
    return new Response(new Uint8Array([9, 8]));
  }) as typeof fetch;
  const result = await buildZip([...files, { url: null, filename: "example_123_3.mp4" }], undefined, fetchMedia);
  assert.equal(result.failed, true);
  assert.deepEqual(result.errors, [
    "example_123_1.jpg: NETWORK_FAILED",
    "example_123_3.mp4: 保存可能なメディアURLがありません",
  ]);
  const extracted = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(extracted), ["example_123_2.mp4"]);
  assert.deepEqual(extracted["example_123_2.mp4"], new Uint8Array([9, 8]));
  await assert.rejects(buildZip([files[0]], undefined, fetchMedia), /保存できるメディアがありません/);
});
