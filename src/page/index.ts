import { extractPosts } from "../media/parse.ts";
import { BRIDGE_CHANNEL, type MediaPost } from "../media/types.ts";

// MAIN worldで実行する．認証情報や生のレスポンスを他のworldへ渡さない．
const cache = new Map<string, MediaPost>();
let ready = false;

function publish(posts: MediaPost[]): void {
  for (let i = 0; i < posts.length; i += 40) {
    window.postMessage(
      { channel: BRIDGE_CHANNEL, type: "posts", posts: posts.slice(i, i + 40) },
      location.origin,
    );
  }
}

function capture(data: unknown): void {
  try {
    const posts = extractPosts(data);
    for (const post of posts) {
      cache.delete(post.postId);
      cache.set(post.postId, post);
    }
    while (cache.size > 400) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    if (ready) publish(posts);
  } catch {
    // 解析の失敗をXの処理に伝播させない．
  }
}

function isPostResponse(source: string): boolean {
  try {
    const url = new URL(source, location.origin);
    return (
      url.origin === "https://x.com" &&
      url.pathname.startsWith("/i/api/graphql/") &&
      !/dm|chat|message/i.test(url.pathname.split("/").pop() ?? "")
    );
  } catch {
    return false;
  }
}

async function captureResponse(response: Response): Promise<void> {
  try {
    if (response.ok && isPostResponse(response.url)) capture(await response.json());
  } catch {
    /* Xの表示には影響させない． */
  }
}

const originalFetch = window.fetch;
window.fetch = async function (this: Window, ...args: Parameters<typeof fetch>): Promise<Response> {
  const response = await originalFetch.apply(this, args);
  try {
    if (isPostResponse(response.url)) void captureResponse(response.clone());
  } catch {
    /* 本来のレスポンスを必ず返す． */
  }
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
        if (this.status < 200 || this.status >= 300 || !isPostResponse(this.responseURL)) return;
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
  publish([...cache.values()]);
});
