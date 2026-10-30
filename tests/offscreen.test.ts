import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import type { ArchiveSnapshot } from "../src/archive/types.ts";

test("Offscreenは即時応答し，同じジョブを再生成せず，直列生成とBlobの解放を行う", async () => {
  let listener: (message: unknown, sender: unknown, respond: (value: unknown) => void) => void;
  const notifications: string[] = [];
  const originalFetch = globalThis.fetch;
  const firstUrl = "https://pbs.twimg.com/media/one.jpg";
  const secondUrl = "https://video.twimg.com/two.mp4";
  const calls: string[] = [];
  let finishFirst: (response: Response) => void;
  const firstResponse = new Promise<Response>((resolve) => { finishFirst = resolve; });
  Object.assign(globalThis, { chrome: { runtime: {
    id: "test-extension",
    onMessage: { addListener(value: typeof listener) { listener = value; } },
    async sendMessage(message: { jobId: string }) { notifications.push(message.jobId); },
  } } });
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return url === firstUrl ? firstResponse : new Response(new Uint8Array([4, 5]));
  }) as typeof fetch;
  await import("../src/archive/offscreen.ts");
  const request = (type: string, jobId: string, url = firstUrl, sender: unknown = { id: "test-extension" }) => {
    let result: unknown;
    listener({ target: "xmd:archive", type, jobId, files: [{ url, filename: `${jobId}_123_1.jpg` }] },
      sender, (value) => { result = value; });
    return result;
  };
  try {
    assert.deepEqual(request("build", "first"), { state: "building" });
    assert.deepEqual(request("build", "first"), { state: "building" });
    assert.deepEqual(request("build", "second", secondUrl), { state: "building" });
    assert.deepEqual(calls, [firstUrl], "生成中も応答し，次のジョブの取得は待つ");
    assert.equal(request("build", "forbidden", firstUrl, { id: "test-extension", tab: { id: 1 } }), undefined);
    finishFirst!(new Response(new Uint8Array([1, 2, 3])));
    await new Promise(setImmediate);
    assert.deepEqual(calls, [firstUrl, secondUrl]);
    assert.deepEqual(notifications, ["first", "second"]);
    const first = request("build", "first") as ArchiveSnapshot;
    const second = request("build", "second", secondUrl) as ArchiveSnapshot;
    assert.equal(first.state, "ready");
    assert.equal(second.state, "ready");
    if (first.state !== "ready" || second.state !== "ready") return;
    const bytes = new Uint8Array(await (await originalFetch(first.url)).arrayBuffer());
    assert.deepEqual(unzipSync(bytes)["first_123_1.jpg"], new Uint8Array([1, 2, 3]));
    assert.deepEqual(request("release", "first"), { idle: false });
    await assert.rejects(originalFetch(first.url), /fetch failed/);
    assert.deepEqual(request("release", "second"), { idle: true });
    await assert.rejects(originalFetch(second.url), /fetch failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
