import assert from "node:assert/strict";
import test from "node:test";
import { DownloadManager } from "../src/background/downloads.ts";
import type { MediaPost } from "../src/media/types.ts";
import type { ArchiveService, ArchiveSnapshot } from "../src/archive/types.ts";
import type { LogEntry } from "../src/utils/logger.ts";

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
      local: {
        async get(_key?: unknown, callback?: (values: Record<string, unknown>) => void) {
          const values = structuredClone(local);
          callback?.(values);
          return values;
        },
        set(values: Record<string, unknown>, callback: () => void) {
          Object.assign(local, structuredClone(values));
          callback();
        },
      },
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
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: api });
  return { api, session, local, items, requests,
    logs() { return (local.app_logs ?? []) as LogEntry[]; },
    failRequest(index: number) { failAt = index; } };
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
  assert.equal((await manager.status("123"))?.state, "success");
  assert.equal(mock.logs().length, 0);
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

test("downloadId保存前の保存名決定でも停止しない", async () => {
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

test("受理直後のSW停止では保存要求を二重発行しない", async () => {
  const mock = mockChrome();
  await new DownloadManager(mock.api).accept(post, { tabId: 1 });
  const job = mock.session["xmd:job:123"] as { entries: { state: string }[] };
  job.entries[0].state = "starting";
  mock.items.set(80, { id: 80, url: post.media[0].url, state: "complete", byExtensionId: "test-extension" });
  const restarted = new DownloadManager(mock.api);
  await restarted.recover();
  assert.equal(mock.requests.length, 1, "2個目のメディアだけを開始する");
  assert.equal(mock.items.get(80)?.state, "complete");
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
  assert.equal(mock.items.get(2)?.state, "complete");
  assert.equal(mock.logs().length, 1);
  assert.match(mock.logs()[0].message, /1件成功，1件失敗/);
  assert.match(mock.logs()[0].detail!, /example_123_1.jpg: USER_CANCELED/);
  await manager.refresh(2);
  await new DownloadManager(mock.api).recover();
  assert.equal(mock.logs().length, 1, "完了済みジョブの確認・復元で再記録しない");
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

function mockArchive() {
  let result: ArchiveSnapshot = { state: "building" };
  const prepared: string[] = [];
  const released: string[] = [];
  const service: ArchiveService = {
    async prepare(jobId) { prepared.push(jobId); return result; },
    async release(jobId) { released.push(jobId); },
  };
  return { service, prepared, released, result(value: ArchiveSnapshot) { result = value; } };
}

test("ZIP生成中はキューを塞がず，設定変更・SW再起動後も元のジョブで1件だけ保存する", async () => {
  const mock = mockChrome();
  const archive = mockArchive();
  mock.local.settings = { multipleMediaMode: "zip" };
  const manager = new DownloadManager(mock.api, archive.service);
  const first = await manager.accept(post, { tabId: 1 });
  assert.equal((await manager.status("123"))?.state, "processing");
  assert.equal(mock.requests.length, 0);
  assert.equal((await manager.accept(post, { tabId: 2 })).jobId, first.jobId);
  // ZIP生成中に設定を変更しても，進行中のジョブの保存方法は変えない．
  mock.local.settings = { multipleMediaMode: "individual" };
  const restarted = new DownloadManager(mock.api, archive.service);
  await restarted.recover();
  archive.result({ state: "ready", url: "blob:chrome-extension://test-extension/archive", failed: false });
  await restarted.archiveChanged(first.jobId);
  await restarted.archiveChanged(first.jobId);
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].filename, "example_123.zip");
  assert.equal(await restarted.filenameFor({ id: 1, url: mock.requests[0].url as string,
    byExtensionId: "test-extension" }), "example_123.zip");
  assert.equal((await restarted.status("123"))?.state, "processing");
  assert.equal(archive.released.length, 0);
  mock.items.get(1)!.state = "complete";
  await restarted.refresh(1);
  assert.equal((await restarted.status("123"))?.state, "success");
  assert.deepEqual(archive.released, [first.jobId]);
  assert.ok(archive.prepared.every((id) => id === first.jobId));
});

test("ZIPの一部失敗・全件失敗・保存キャンセルはエラーとし，一時データを解放する", async () => {
  for (const failure of ["partial", "all", "cancel"] as const) {
    const mock = mockChrome();
    const archive = mockArchive();
    mock.local.settings = { multipleMediaMode: "zip" };
    archive.result(failure === "all" ? { state: "error", error: "全件取得失敗" } : {
      state: "ready", url: "blob:chrome-extension://test-extension/archive", failed: failure === "partial",
      errors: failure === "partial" ? ["example_123_1.jpg: HTTP 403"] : [],
    });
    const manager = new DownloadManager(mock.api, archive.service);
    const job = await manager.accept(post, { tabId: 1 });
    await manager.status("123");
    if (failure !== "all") {
      mock.items.get(1)!.state = failure === "cancel" ? "interrupted" : "complete";
      await manager.refresh(1);
    }
    assert.equal((await manager.status("123"))?.state, "error", failure);
    assert.equal(mock.requests.length, failure === "all" ? 0 : 1, failure);
    assert.deepEqual(archive.released, [job.jobId], failure);
    assert.equal(mock.logs().length, 1);
    assert.match(mock.logs()[0].message, failure === "partial" ? /1件成功，1件失敗/ : /0件成功，2件失敗/);
    if (failure === "partial") assert.match(mock.logs()[0].detail!, /HTTP 403/);
    if (failure === "partial") assert.equal(mock.items.get(1)!.state, "complete");
  }
});

test("ZIP設定でも1件は直接保存し，完了直後のSW停止でもZIPの後片付けを復元する", async () => {
  const mock = mockChrome();
  const archive = mockArchive();
  mock.local.settings = { multipleMediaMode: "zip" };
  const manager = new DownloadManager(mock.api, archive.service);
  await manager.accept({ ...post, media: [post.media[0]] }, { tabId: 1 });
  await manager.status("123");
  assert.equal(mock.requests[0].filename, "example_123_1.jpg");
  assert.equal(archive.prepared.length, 0);
  mock.items.get(1)!.state = "complete";
  await manager.refresh(1);
  const zipJob = await manager.accept(post, { tabId: 1 });
  archive.result({ state: "ready", url: "blob:chrome-extension://test-extension/archive", failed: false });
  await manager.status("123");
  // completeの保存後，release前にSWが止まった状態を再現する．
  const stored = mock.session["xmd:job:123"] as { state: string; entries: { state: string }[] };
  stored.state = "success";
  stored.entries[0].state = "complete";
  await new DownloadManager(mock.api, archive.service).recover();
  assert.deepEqual(archive.released, [zipJob.jobId]);
});
