import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const bundle = readFileSync(new URL("../dist/page.js", import.meta.url), "utf8");
const data = { csrf: "must-not-leave-page", data: { result: {
  rest_id: "123", legacy: { full_text: "本文は転送しない", extended_entities: {
    media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/example.jpg" }],
  } }, core: { user_results: { result: { legacy: { screen_name: "example" } } } },
} } };

function setup(url = "https://x.com/i/api/graphql/dmRandomHash/HomeTimeline", json: unknown = data) {
  const messages: { channel: string; posts: { postId: string; media: unknown[] }[] }[] = [];
  const handlers = new Map<string, (event: unknown) => void>();
  let calls = 0;
  let cloneFails = false;
  const response = {
    ok: true, url,
    clone() {
      if (cloneFails) throw new Error("Cannot clone");
      return { ok: true, url, async json() { return json; } };
    },
  };
  const window = {
    async fetch(..._args: unknown[]) { calls++; return response; },
    addEventListener(type: string, handler: (event: unknown) => void) { handlers.set(type, handler); },
    postMessage(message: unknown) { messages.push(message as typeof messages[number]); },
  };
  class Xhr {
    status = 200;
    responseURL = url;
    responseType = "";
    responseText = JSON.stringify(json);
    response = json;
    sends = 0;
    listeners: (() => void)[] = [];
    addEventListener(_type: string, fn: () => void) { this.listeners.push(fn); }
    send() { this.sends++; }
    load() { for (const handler of this.listeners.splice(0)) handler(); }
  }
  runInNewContext(bundle, { window, location: { origin: "https://x.com" }, XMLHttpRequest: Xhr, URL });
  function ready(origin = "https://x.com", source: unknown = window) {
    handlers.get("message")?.({ origin, source, data: { channel: "x-media-download:v1", type: "ready" } });
  }
  return { window, response, messages, ready, Xhr,
    calls: () => calls, failClone() { cloneFails = true; } };
}

test("MAIN取得処理は元のfetchレスポンスをそのまま返し，追加要求を発行しない", async () => {
  const app = setup();
  assert.equal(await app.window.fetch("/original-request"), app.response);
  assert.equal(app.calls(), 1);
  await new Promise(setImmediate);
  assert.equal(app.messages.length, 0, "ISOLATED worldの準備を待つ");
  app.ready();
  assert.equal(app.messages[0].posts[0].postId, "123", "ハッシュにdmを含んでも通常タイムラインは処理する");
  const serialized = JSON.stringify(app.messages);
  assert.ok(!serialized.includes("must-not-leave-page"));
  assert.ok(!serialized.includes("本文は転送しない"));
});

test("MAINのメッセージは同じwindowとoriginだけを受け付ける", async () => {
  const app = setup();
  await app.window.fetch("/request");
  await new Promise(setImmediate);
  app.ready("https://evil.test");
  app.ready("https://x.com", {});
  assert.equal(app.messages.length, 0);
  app.ready();
  assert.equal(app.messages.length, 1);
});

test("DM用レスポンスとX以外の通信を解析しない", async () => {
  for (const url of ["https://x.com/i/api/graphql/hash/DMConversationTimeline",
    "https://evil.test/i/api/graphql/hash/HomeTimeline", "https://x.com/other/resource"]) {
    const app = setup(url);
    app.ready();
    assert.equal(await app.window.fetch(url), app.response);
    await new Promise(setImmediate);
    assert.equal(app.messages.length, 0);
  }
});

test("レスポンスの複製や解析の失敗をXへ伝播しない", async () => {
  const app = setup();
  app.failClone();
  assert.equal(await app.window.fetch("/request"), app.response);
  const malformed = setup("https://x.com/i/api/graphql/hash/TweetDetail", null);
  malformed.ready();
  assert.equal(await malformed.window.fetch("/request"), malformed.response);
  await new Promise(setImmediate);
  assert.equal(malformed.messages.length, 0);
});

test("XHRの元のsendを呼び，取得済みレスポンスからのみ投稿情報を取り出す", () => {
  const app = setup();
  app.ready();
  const xhr = new app.Xhr();
  xhr.send();
  xhr.load();
  assert.equal(xhr.sends, 1);
  assert.equal(app.messages[0].posts[0].postId, "123");
  const broken = new app.Xhr();
  broken.responseText = "not json";
  assert.doesNotThrow(() => { broken.send(); broken.load(); });
});
