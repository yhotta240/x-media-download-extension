import assert from "node:assert/strict";
import test from "node:test";
import { DownloadManager } from "../src/background/downloads.ts";
import type { MediaPost } from "../src/media/types.ts";

const post: MediaPost = { username: "example", postId: "123",
  media: [{ kind: "photo", url: "https://pbs.twimg.com/media/a?format=jpg&name=orig", ext: "jpg" },
    { kind: "video", url: "https://video.twimg.com/a.mp4", ext: "mp4" }] };

function mockChrome() {
  const session: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const items = new Map<number, Record<string, unknown>>();
  const requests: Record<string, unknown>[] = [];
  let failAt = -1;
  const api = {
    runtime: { id: "test-extension" },
    storage: {
      session: {
        async get(key: string | null) { return structuredClone(key ? { [key]: session[key] } : session); },
        async set(values: Record<string, unknown>) { Object.assign(session, structuredClone(values)); },
        async remove(keys: string[]) { for (const key of keys) delete session[key]; },
      },
      local: { async get() { return structuredClone(local); } },
    },
    tabs: { async sendMessage() {} },
    downloads: {
      async download(options: Record<string, unknown>) {
        requests.push(options);
        if (requests.length === failAt) throw new Error("USER_CANCELED");
        const id = requests.length;
        items.set(id, { id, url: options.url, state: "in_progress", byExtensionId: "test-extension" });
        return id;
      },
      async search(query: { id?: number }) {
        if (query.id === undefined) return [...items.values()];
        return items.has(query.id) ? [items.get(query.id)] : [];
      },
    },
  } as unknown as typeof chrome;
  return { api, session, local, items, requests, failRequest(index: number) { failAt = index; } };
}

test("Chromeが要求を受理しただけでは成功にしない", async () => {
  const mock = mockChrome();
  const manager = new DownloadManager(mock.api);
  const status = await manager.accept(post, { tabId: 1 });
  assert.equal(status.state, "processing");
  assert.equal((await manager.status(post.postId))?.state, "processing");
  assert.equal(mock.requests.length, 2);
  for (const [index, options] of mock.requests.entries()) {
    assert.equal(options.conflictAction, "uniquify");
    assert.equal(options.filename, `example_123_${index + 1}.${index ? "mp4" : "jpg"}`);
    assert.equal("saveAs" in options, false, "Chromeの保存先確認設定を上書きしない");
  }
  mock.items.get(1)!.state = "complete";
  await manager.refresh(1);
  assert.equal((await manager.status("123"))?.state, "processing");
  mock.items.get(2)!.state = "complete";
  await manager.refresh(2);
  assert.deepEqual((await manager.status("123"))?.completed, 2);
  assert.equal((await manager.status("123"))?.state, "success");
});

test("同時クリック・別タブからの要求でも多重実行しない", async () => {
  const mock = mockChrome();
  const manager = new DownloadManager(mock.api);
  const [first, second] = await Promise.all([
    manager.accept(post, { tabId: 1 }), manager.accept(post, { tabId: 2 }),
  ]);
  assert.equal(first.jobId, second.jobId);
  await Promise.all([manager.status("123"), manager.status("123")]);
  assert.equal(mock.requests.length, 2);
});

test("Chromeの保存名決定時に画像・動画の指定名を復元し，他の保存には干渉しない", async () => {
  const mock = mockChrome();
  const manager = new DownloadManager(mock.api);
  await manager.accept(post, { tabId: 1 });
  await manager.status(post.postId);
  const restarted = new DownloadManager(mock.api);
  for (const [index, media] of post.media.entries()) {
    const item = { id: index + 1, url: media.url!, byExtensionId: "test-extension" };
    assert.equal(await restarted.filenameFor(item), `example_123_${index + 1}.${media.ext}`);
    assert.equal(await restarted.filenameFor({ ...item, byExtensionId: "other-extension" }), undefined);
    assert.equal(await restarted.filenameFor({ ...item, byExtensionId: undefined }), undefined);
  }
  assert.equal(await restarted.filenameFor({ id: 90, url: post.media[0].url!,
    byExtensionId: "test-extension" }), undefined);
});

test("downloadId保存前の保存名決定でも停止せず，曖昧なURL一致は採用しない", async () => {
  const mock = mockChrome();
  const manager = new DownloadManager(mock.api);
  const download = mock.api.downloads.download;
  const names: (string | undefined)[] = [];
  mock.api.downloads.download = (async (options: chrome.downloads.DownloadOptions) => {
    // Chromeがdownload()を解決する前に保存名を問い合わせる順序も再現する．
    names.push(await manager.filenameFor({ id: mock.requests.length + 1,
      url: options.url, byExtensionId: "test-extension" }));
    return download(options);
  }) as typeof mock.api.downloads.download;
  await manager.accept(post, { tabId: 1 });
  await manager.status(post.postId);
  assert.deepEqual(names, ["example_123_1.jpg", "example_123_2.mp4"]);

  const job = mock.session["xmd:job:123"] as { entries: {
    state: string; downloadId?: number; url: string; filename: string;
  }[] };
  job.entries[0].state = "starting";
  delete job.entries[0].downloadId;
  job.entries.push({ ...job.entries[0], filename: "other_123_3.jpg" });
  assert.equal(await manager.filenameFor({ id: 90, url: post.media[0].url!,
    byExtensionId: "test-extension" }), undefined);
});

test("SW再起動後にもdownloadIdと完了状態を引き継ぐ", async () => {
  const mock = mockChrome();
  const first = new DownloadManager(mock.api);
  await first.accept(post, { tabId: 1 });
  await first.status("123");
  mock.items.get(1)!.state = "complete";
  mock.items.get(2)!.state = "complete";
  const restarted = new DownloadManager(mock.api);
  await restarted.recover();
  assert.equal((await restarted.status("123"))?.state, "success");
  assert.equal(mock.requests.length, 2);
});

test("保存要求前のSW停止では未処理の項目を再開する", async () => {
  const mock = mockChrome();
  await new DownloadManager(mock.api).accept(post, { tabId: 1 });
  await new DownloadManager(mock.api).recover();
  assert.equal(mock.requests.length, 2);
});

test("受理直後のSW停止では保存要求を二重発行しない", async () => {
  const mock = mockChrome();
  await new DownloadManager(mock.api).accept(post, { tabId: 1 });
  const job = mock.session["xmd:job:123"] as { entries: { state: string }[] };
  job.entries[0].state = "starting";
  mock.items.set(80, { id: 80, url: post.media[0].url, state: "complete", byExtensionId: "test-extension" });
  const restarted = new DownloadManager(mock.api);
  await restarted.recover();
  assert.equal(mock.requests.length, 1, "2個目のメディアだけを開始する");
  assert.equal((await restarted.status("123"))?.completed, 1);
});

test("一部のキャンセルでも他のメディアを開始し，保存済みファイルを保持する", async () => {
  const mock = mockChrome();
  mock.failRequest(1);
  const manager = new DownloadManager(mock.api);
  await manager.accept(post, { tabId: 1 });
  await manager.status("123");
  assert.equal(mock.requests.length, 2);
  mock.items.get(2)!.state = "complete";
  const status = await manager.status("123");
  assert.equal(status?.state, "error");
  assert.equal(status?.completed, 1);
  assert.equal(mock.items.get(2)?.state, "complete");
});

test("ネットワーク中断と履歴消去を失敗と判定する", async () => {
  const mock = mockChrome();
  const manager = new DownloadManager(mock.api);
  await manager.accept(post, { tabId: 1 });
  await manager.status("123");
  mock.items.get(1)!.state = "interrupted";
  mock.items.get(1)!.error = "NETWORK_FAILED";
  mock.items.delete(2);
  const status = await manager.status("123");
  assert.equal(status?.state, "error");
  assert.equal(status?.error, "NETWORK_FAILED");
});

test("HLSのみの項目も連番に含め，取得できる画像を保存する", async () => {
  const mock = mockChrome();
  const manager = new DownloadManager(mock.api);
  await manager.accept({ ...post, media: [
    { kind: "video", url: null, ext: "mp4", error: "HLS非対応" }, post.media[0],
  ] }, { tabId: 1 });
  await manager.status("123");
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].filename, "example_123_2.jpg");
  mock.items.get(1)!.state = "complete";
  assert.equal((await manager.status("123"))?.state, "error");
});

test("処理完了後は新しいジョブで再ダウンロードできる", async () => {
  const mock = mockChrome();
  const manager = new DownloadManager(mock.api);
  const first = await manager.accept(post, { tabId: 1 });
  await manager.status("123");
  mock.items.get(1)!.state = "complete";
  mock.items.get(2)!.state = "complete";
  await manager.status("123");
  const next = await manager.accept(post, { tabId: 1 });
  assert.notEqual(next.jobId, first.jobId);
  await manager.status("123");
  assert.equal(mock.requests.length, 4);
});

test("Popupで無効にした場合は新しいダウンロードを受け付けない", async () => {
  const mock = mockChrome();
  mock.local.enabled = false;
  await assert.rejects(new DownloadManager(mock.api).accept(post, { tabId: 1 }), /無効/);
  assert.equal(mock.requests.length, 0);
});
