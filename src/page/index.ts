import { LIMITS } from "../config.ts";
import { extractPosts } from "../media/parse.ts";
import { BRIDGE_CHANNEL, type MediaPost } from "../media/types.ts";
import { isXPostApiUrl as isPostResponse, isSupportedXPage } from "../x/site.ts";

// MAIN worldで実行する．認証情報や生のレスポンスを他のworldへ渡さない．
// Content Scriptの準備が済むまでだけ保持する．以後のキャッシュは受信側に任せる．
const pending = new Map<string, MediaPost>();
let ready = false;

function publish(posts: MediaPost[]): void {
  for (let i = 0; i < posts.length; i += LIMITS.bridgePosts) {
    window.postMessage(
      { channel: BRIDGE_CHANNEL, type: "posts", posts: posts.slice(i, i + LIMITS.bridgePosts) },
      location.origin,
    );
  }
}

function capture(data: unknown): void {
  // JSONの読み取り中に対象外画面へ遷移した場合も，投稿情報を転送しない．
  if (!isSupportedXPage(location.pathname)) return;
  const posts = extractPosts(data);
  if (ready) {
    publish(posts);
    return;
  }
  for (const post of posts) {
    pending.delete(post.postId);
    pending.set(post.postId, post);
  }
  while (pending.size > LIMITS.cachedPosts) {
    const first = pending.keys().next().value;
    if (first) pending.delete(first);
  }
}

async function captureResponse(response: Response): Promise<void> {
  try {
    if (isSupportedXPage(location.pathname) && response.ok && isPostResponse(response.url))
      capture(await response.clone().json());
  } catch {
    /* Xの表示には影響させない． */
  }
}

const originalFetch = window.fetch;
window.fetch = async function (this: Window, ...args: Parameters<typeof fetch>): Promise<Response> {
  const response = await originalFetch.apply(this, args);
  void captureResponse(response);
  return response;
};

const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (
  this: XMLHttpRequest,
  ...args: Parameters<XMLHttpRequest["send"]>
): void {
  this.addEventListener(
    "load",
    () => {
      try {
        if (
          !isSupportedXPage(location.pathname) ||
          this.status < 200 ||
          this.status >= 300 ||
          !isPostResponse(this.responseURL)
        )
          return;
        if (this.responseType === "json") capture(this.response);
        else if (!this.responseType || this.responseType === "text")
          capture(JSON.parse(this.responseText));
      } catch {
        /* Xの表示には影響させない． */
      }
    },
    { once: true },
  );
  originalSend.apply(this, args);
};

window.addEventListener("message", (event: MessageEvent) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.channel !== BRIDGE_CHANNEL ||
    event.data?.type !== "ready"
  )
    return;
  ready = true;
  publish([...pending.values()]);
  pending.clear();
});
