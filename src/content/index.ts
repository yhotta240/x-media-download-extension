import { asRecord, validatePost } from "../media/parse.ts";
import {
  BRIDGE_CHANNEL,
  DOWNLOAD_STATUS,
  type DownloadReply,
  GET_DOWNLOAD,
  type JobStatus,
  type MediaPost,
  START_DOWNLOAD,
} from "../media/types.ts";
import { createButton, setButtonState } from "./button.ts";
import { ARTICLE, articleTargets, HOST, type PostTarget, tileTargets } from "./posts.ts";

const cache = new Map<string, MediaPost>();
const activeJobs = new Map<string, JobStatus>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const polling = new Set<string>();
const targets = new WeakMap<HTMLElement, PostTarget>();
const pending = new Set<HTMLElement>();
let enabled = true;
let scheduled = false;
let tilesDirty = false;

function supportedPage(): boolean {
  return !/^\/(messages|i\/(chat|broadcasts|spaces))(?:\/|$)/.test(location.pathname);
}

function updateButtons(postId: string): void {
  const status = activeJobs.get(postId);
  for (const host of document.querySelectorAll<HTMLElement>(HOST)) {
    if (host.dataset.postId !== postId) continue;
    const button = host.querySelector("button");
    if (button) setButtonState(button, status?.state ?? "idle", status?.error);
  }
}

function applyStatus(status: JobStatus): void {
  const old = activeJobs.get(status.postId);
  // 古いジョブの通知で，再実行中の表示を上書きしない．
  if (old && old.jobId !== status.jobId && old.jobId !== "pending") return;
  activeJobs.set(status.postId, status);
  updateButtons(status.postId);
  if (status.state !== "processing" && !timers.has(status.postId)) {
    timers.set(
      status.postId,
      setTimeout(() => {
        activeJobs.delete(status.postId);
        timers.delete(status.postId);
        updateButtons(status.postId);
      }, 2200),
    );
  }
}

async function poll(postId: string): Promise<void> {
  if (polling.has(postId)) return;
  polling.add(postId);
  try {
    while (activeJobs.get(postId)?.state === "processing") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (activeJobs.get(postId)?.state !== "processing") break;
      const reply: DownloadReply = await chrome.runtime.sendMessage({ type: GET_DOWNLOAD, postId });
      if (!reply?.ok) throw new Error(reply?.error ?? "保存状態を取得できませんでした");
      applyStatus(reply.status);
    }
  } catch (error) {
    const current = activeJobs.get(postId);
    if (current)
      applyStatus({
        ...current,
        state: "error",
        error: error instanceof Error ? error.message : "拡張機能を再読み込みしてください",
      });
  } finally {
    polling.delete(postId);
  }
}

async function download(host: HTMLElement): Promise<void> {
  const target = targets.get(host);
  if (!target || !enabled || !supportedPage() || activeJobs.has(target.post.postId)) return;
  const post = target.post;
  const starting: JobStatus = {
    postId: post.postId,
    jobId: "pending",
    state: "processing",
    completed: 0,
    total: post.media.length,
  };
  activeJobs.set(post.postId, starting);
  updateButtons(post.postId);
  try {
    const reply: DownloadReply = await chrome.runtime.sendMessage({ type: START_DOWNLOAD, post });
    if (!reply?.ok) throw new Error(reply?.error ?? "ダウンロードを開始できませんでした");
    applyStatus(reply.status);
    void poll(post.postId);
  } catch (error) {
    applyStatus({
      ...starting,
      state: "error",
      error: error instanceof Error ? error.message : "ダウンロードを開始できませんでした",
    });
  }
}

function attach(target: PostTarget): HTMLElement {
  let host = [...target.container.children].find((node) => node.matches(HOST)) as
    | HTMLElement
    | undefined;
  if (!host) {
    host = document.createElement("div");
    host.className = "xmd-host";
    host.dataset.xmdHost = "";
    const button = createButton(target.quote);
    const element = host;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void download(element);
    });
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    host.append(button);
    target.container.append(host);
  }
  host.dataset.quote = String(target.quote);
  host.dataset.postId = target.post.postId;
  targets.set(host, target);
  if (target.tile) target.container.classList.add("xmd-tile");
  const button = host.querySelector("button");
  if (button)
    setButtonState(
      button,
      activeJobs.get(target.post.postId)?.state ?? "idle",
      activeJobs.get(target.post.postId)?.error,
    );
  return host;
}

function processArticle(article: HTMLElement): void {
  if (!article.isConnected) return;
  const keep = new Set<HTMLElement>();
  if (enabled && supportedPage())
    for (const target of articleTargets(article, cache)) keep.add(attach(target));
  for (const host of article.querySelectorAll<HTMLElement>(HOST)) {
    if (host.closest(ARTICLE) === article && !keep.has(host)) host.remove();
  }
}

function flush(): void {
  scheduled = false;
  const batch = [...pending].slice(0, 15);
  for (const article of batch) {
    pending.delete(article);
    try {
      processArticle(article);
    } catch {
      /* DOM変更でXの操作を妨げない． */
    }
  }
  if (!pending.size && tilesDirty) {
    tilesDirty = false;
    const keep = new Set<HTMLElement>();
    if (enabled && supportedPage())
      for (const target of tileTargets(document, cache)) keep.add(attach(target));
    for (const host of document.querySelectorAll<HTMLElement>(HOST)) {
      if (!host.closest(ARTICLE) && !keep.has(host)) host.remove();
    }
  }
  if (pending.size) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flush);
}

function scan(): void {
  for (const article of document.querySelectorAll<HTMLElement>(ARTICLE)) pending.add(article);
  tilesDirty = true;
  schedule();
}

window.addEventListener("message", (event: MessageEvent) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.channel !== BRIDGE_CHANNEL ||
    event.data?.type !== "posts" ||
    !Array.isArray(event.data.posts) ||
    event.data.posts.length > 40
  )
    return;
  for (const value of event.data.posts) {
    const post = validatePost(value);
    if (post) {
      cache.delete(post.postId);
      cache.set(post.postId, post);
    }
  }
  while (cache.size > 400) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  scan();
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  const data = asRecord(message);
  const status = asRecord(data?.status);
  if (
    data?.type === DOWNLOAD_STATUS &&
    status &&
    typeof status.postId === "string" &&
    activeJobs.has(status.postId) &&
    ["processing", "success", "error"].includes(String(status.state))
  ) {
    applyStatus(status as JobStatus);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) {
    enabled = changes.enabled.newValue !== false;
    scan();
  }
});

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (!(mutation.target instanceof Element) || mutation.target.closest(HOST)) continue;
    const article = mutation.target.closest<HTMLElement>(ARTICLE);
    if (article) pending.add(article);
    for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement) || node.matches(HOST)) continue;
      if (node.matches(ARTICLE)) pending.add(node);
      for (const added of node.querySelectorAll<HTMLElement>(ARTICLE)) pending.add(added);
    }
    if (!article && /\/media\/?$/.test(location.pathname)) tilesDirty = true;
  }
  if (pending.size || tilesDirty) schedule();
});

async function initialize(): Promise<void> {
  try {
    const settings = await chrome.storage.local.get("enabled");
    enabled = settings.enabled !== false;
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "href", "data-testid"],
    });
    window.addEventListener("popstate", scan);
    window.postMessage({ channel: BRIDGE_CHANNEL, type: "ready" }, location.origin);
    scan();
  } catch (error) {
    console.warn("X Media Downloadを初期化できませんでした", error);
  }
}

void initialize();
