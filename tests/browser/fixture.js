const bridge = "x-media-download:v1";
history.replaceState({}, "", "/i/chat");
let ready = false;
const listeners = [];
const storageListeners = [];
const calls = [];
const jobs = new Map();
const fixtures = new Map();
const photo = (name) => ({ kind: "photo", url: `https://pbs.twimg.com/media/${name}?format=jpg&name=orig`, ext: "jpg" });
const video = { kind: "video", url: "https://video.twimg.com/fixture/1280x720/video.mp4", ext: "mp4" };
const image = (name) => `<div data-testid="tweetPhoto" class="media"><img alt="投稿画像" src="https://pbs.twimg.com/media/${name}?format=jpg&name=small"></div>`;
const movie = '<div data-testid="tweetPhoto" class="media"><div data-testid="videoPlayer">投稿動画</div></div>';
const bar = '<div role="group"><button data-testid="reply">返信</button><button data-testid="like">いいね</button><button>共有</button></div>';

function article(id, content, name = "example") {
  return `<article data-testid="tweet" id="post-${id}"><a href="https://x.com/${name}/status/${id}"><time>${name} · 1時間</time></a>${content}${bar}</article>`;
}
function addPost(id, media, quotedPostId) {
  fixtures.set(id, { postId: id, username: "example", media, ...(quotedPostId ? { quotedPostId } : {}) });
}
addPost("101", []);
addPost("102", [photo("one"), photo("two")]);
addPost("103", [], "104");
addPost("104", [photo("quote")]);
addPost("105", [photo("mixed"), video]);
addPost("106", [{ kind: "video", url: null, ext: "mp4" }]);
addPost("107", [], "108");
addPost("108", [video]);
addPost("109", [photo("repost")]);
addPost("110", [photo("tile-one"), photo("tile-two")]);
addPost("111", [photo("hidden")]);
document.getElementById("posts").innerHTML =
  article("101", `<p>リンクカードのみ</p><div data-testid="card.wrapper">${image("card")}</div>`) +
  article("102", `<p>複数画像</p>${image("one")}${image("two")}`) +
  article("103", `<p>引用する側にはメディアなし</p><div role="link"><div data-testid="User-Name">引用元</div><a href="https://x.com/example/status/105">本文中の別ポストへのリンク</a><a href="https://x.com/example/status/104/photo/1">引用画像</a>${image("quote")}</div>`) +
  article("105", `<p>画像・動画の混在</p>${image("mixed")}${movie}`) +
  article("106", `<p>MP4を取得できない動画</p>${movie}`) +
  article("107", `<p>引用動画（カードに投稿リンクなし）</p><div role="link"><div data-testid="User-Name">引用元</div>${movie}</div>`) +
  article("109", `<p>リポストされた元ポスト</p>${image("repost")}`) +
  `<div class="grid" id="tile"><a href="https://x.com/example/status/110/photo/1">${image("tile-one")}</a></div>` +
  article("111", `<div data-testid="sensitiveMediaInterstitial">メディアを表示する</div>${image("hidden")}`) +
  article("115", `<p>独立した入れ子ポスト</p>${article("116", image("nested"))}`);

window.addEventListener("message", (event) => {
  if (event.data?.channel === bridge && event.data.type === "ready") {
    ready = true;
    publish();
  }
});
function publish() { window.postMessage({ channel: bridge, type: "posts", posts: [...fixtures.values()] }, location.origin); }

Object.defineProperty(window, "chrome", { configurable: true, value: {
  storage: { local: { async get() { return { enabled: true }; } }, onChanged: { addListener(fn) { storageListeners.push(fn); } } },
  runtime: {
    onMessage: { addListener(fn) { listeners.push(fn); } },
    async sendMessage(message) {
      if (message.type === "xmd:status") return { ok: true, status: jobs.get(message.postId) };
      calls.push(message.post);
      const status = { postId: message.post.postId, jobId: crypto.randomUUID(), state: "processing" };
      jobs.set(status.postId, status);
      setTimeout(() => {
        const error = message.post.media.some((item) => !item.url);
        const finished = { ...status, state: error ? "error" : "success" };
        jobs.set(status.postId, finished);
        for (const listener of listeners) listener({ type: "xmd:update", status: finished });
      }, 100);
      return { ok: true, status };
    },
  },
} });

const results = [];
const wait = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const button = (id) => document.querySelector(`#post-${id} .xmd-button`);
function assert(condition, label) {
  if (!condition) throw new Error(label);
  results.push(`✓ ${label}`);
}
async function until(check) {
  for (let i = 0; i < 70; i++) { if (check()) return; await wait(50); }
  throw new Error("UI更新の待機タイムアウト");
}

async function run() {
  await until(() => ready);
  await wait();
  assert(!document.querySelector(".xmd-button"), "DMで初期化してもボタンを表示しない");
  // pushStateではpopstateは発火しない．SPAと同様にDOMと投稿情報を更新する．
  history.pushState({}, "", "/home");
  const posts = document.getElementById("posts");
  posts.innerHTML = posts.innerHTML;
  publish();
  await until(() => button("102") && button("107"));
  assert(!!button("102"), "DMからホームへのSPA遷移で再読み込みせずボタンを表示");
  assert(!button("101"), "メディアなしのポストには表示しない");
  assert(!button("111"), "未表示のセンシティブメディアには表示しない");
  await until(() => button("116"));
  assert(document.querySelectorAll("#post-115 .xmd-button").length === 1 &&
    !!document.querySelector("#post-116 .xmd-button"), "入れ子ポストのメディアとボタンを親へ混入させない");
  assert(document.querySelectorAll("#post-102 .xmd-button").length === 1, "複数画像でもボタンは1つ");
  assert(document.querySelectorAll("#post-103 .xmd-button").length === 1 && button("103").dataset.quote === "true", "引用だけのポストでは引用側だけに表示");
  assert(document.querySelector("#post-103 [data-post-id='104']"), "引用本文中の別ポストへのリンクと引用元を混同しない");
  assert(document.querySelector("#post-107 [data-post-id='108']"), "リンクのない引用動画も引用元のIDに対応");
  assert(document.querySelector("#tile .xmd-button"), "メディアタブのタイルにも表示");
  button("102").click(); button("102").click();
  assert(button("102").disabled && button("102").dataset.state === "processing", "クリック直後にボタンを無効化");
  await wait(150);
  assert(calls.length === 1 && calls[0].media.length === 2, "連続クリックを無視し，全画像を1要求で渡す");
  assert(button("102").dataset.state === "success", "実完了の通知で成功表示");
  button("103").click();
  await wait(150);
  assert(calls.at(-1).postId === "104", "引用のクリックで投稿本体を保存しない");
  button("105").click();
  await wait(150);
  assert(calls.at(-1).media[1].kind === "video" && calls.at(-1).media.length === 2, "画像と動画の表示順を維持");
  button("106").click();
  await wait(150);
  assert(button("106").dataset.state === "error", "取得不可メディアはエラー表示");
  const dynamic = document.createElement("div");
  dynamic.innerHTML = article("112", image("dynamic"));
  document.getElementById("posts").append(dynamic.firstElementChild);
  await until(() => button("112"));
  assert(!!button("112"), "無限スクロールで追加されたポストに対応");
  document.querySelector("#post-112 [data-testid='tweetPhoto']").remove();
  await until(() => !button("112"));
  assert(!button("112"), "メディア削除後は古いボタンを除去");
  publish(); publish();
  await wait();
  assert(document.querySelectorAll("#post-102 .xmd-button").length === 1, "再解析してもボタンを重複追加しない");
  for (const listener of storageListeners) listener({ enabled: { newValue: false } }, "local");
  await until(() => document.querySelectorAll(".xmd-button").length === 0);
  assert(!document.querySelector(".xmd-button"), "Popupの無効化を全表示に反映");
  for (const listener of storageListeners) listener({ enabled: { newValue: true } }, "local");
  await until(() => button("102"));
  assert(!!button("102"), "再有効化でボタンを復元");
  await until(() => button("102").dataset.state === "idle");
  assert(!button("102").disabled, "一定時間後に再ダウンロード可能");
  button("102").click(); await wait(150);
  assert(calls.filter((post) => post.postId === "102").length === 2, "完了後の再ダウンロードを受け付ける");
  const reused = document.getElementById("post-109");
  reused.querySelector("a").href = "https://x.com/example/status/114";
  reused.id = "post-114";
  await until(() => document.querySelector("#post-114 [data-post-id='114']"));
  button("114").click(); await wait(150);
  assert(calls.at(-1).postId === "114", "仮想スクロールで再利用されたDOMの投稿IDを更新");
  history.pushState({}, "", "/i/chat");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await until(() => !document.querySelector(".xmd-button"));
  assert(!document.querySelector(".xmd-button"), "SPAでDMへ移動した場合はボタンを非表示");
  history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await until(() => button("102"));
  document.title = `${results.length} UI tests passed`;
  document.getElementById("results").textContent = `${results.length}件のUI検証に成功\n${results.join("\n")}`;
}
run().catch((error) => {
  document.title = "UI tests failed";
  document.getElementById("results").style.color = "#f4212e";
  document.getElementById("results").textContent = `${results.join("\n")}\n✗ ${error.stack}`;
});
