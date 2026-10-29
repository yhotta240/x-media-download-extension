import { imageMedia, parsePostLink } from "../media/parse.ts";
import type { MediaItem, MediaPost, PostIdentity } from "../media/types.ts";
import { isPostAnalyticsPath, isPostMediaPath } from "../x/site.ts";
import { X_DOM } from "./x-dom.ts";

/**
 * XのDOMから保存対象を組み立てるアダプター．親子関係が変わった場合はこのファイルを修正する．
 * ボタンの状態管理・Chromeへの保存要求はindex.tsに置き，X固有の要素判定を混在させない．
 */

export type PostTarget = {
  root: HTMLElement;
  container: HTMLElement;
  post: MediaPost;
  quote: boolean;
  tile?: boolean;
};

// 引用カードには標準アクションバーがない．投稿者表示を含む独立したカードとして判定する．
function quoteRoots(article: HTMLElement): HTMLElement[] {
  return [...article.querySelectorAll<HTMLElement>(X_DOM.quote)].filter(
    (node) =>
      node.closest(X_DOM.article) === article &&
      !!node.querySelector(X_DOM.quoteAuthor) &&
      !node.parentElement?.closest(X_DOM.quote),
  );
}

function identity(root: HTMLElement, excluded: HTMLElement[]): PostIdentity | undefined {
  const links = [...root.querySelectorAll<HTMLAnchorElement>(X_DOM.postLink)].filter(
    (link) =>
      link.closest(X_DOM.article) === root.closest(X_DOM.article) &&
      !excluded.some((quote) => quote.contains(link)),
  );
  const preferred =
    links.find((link) => link.querySelector(X_DOM.timestamp)) ??
    links.find((link) => isPostAnalyticsPath(link.pathname)) ??
    links.find((link) => isPostMediaPath(link.pathname));
  return preferred ? parsePostLink(preferred.href) : undefined;
}

function visibleMedia(root: HTMLElement, excluded: HTMLElement[]): MediaItem[] {
  const owns = (node: Element) =>
    node.closest(X_DOM.article) === root.closest(X_DOM.article) &&
    !excluded.some((quote) => quote.contains(node)) &&
    !node.closest(X_DOM.excludedMedia);
  const warnings = root.querySelectorAll(X_DOM.sensitiveWarning);
  if ([...warnings].some(owns)) return [];
  const media: MediaItem[] = [];
  const seen = new Set<string>();
  for (const node of root.querySelectorAll<HTMLElement>(X_DOM.media)) {
    if (!owns(node)) continue;
    const parentMedia = node.parentElement?.closest(X_DOM.media);
    if (parentMedia && root.contains(parentMedia)) continue;
    if (node.matches(X_DOM.video) || node.querySelector(X_DOM.videoContent)) {
      media.push({
        kind: "video",
        url: null,
        ext: "mp4",
        error: "動画の配信情報を取得できませんでした",
      });
    } else {
      const image = node.querySelector<HTMLImageElement>(X_DOM.image);
      const photo = image ? imageMedia(image.currentSrc || image.src) : undefined;
      if (photo?.url && !seen.has(photo.url)) {
        seen.add(photo.url);
        media.push(photo);
      }
    }
  }
  return media;
}

function buildPost(
  id: PostIdentity,
  visible: MediaItem[],
  cache: Map<string, MediaPost>,
): MediaPost {
  const known = cache.get(id.postId);
  return known?.media.length ? known : { ...id, media: visible };
}

export function articleTargets(article: HTMLElement, cache: Map<string, MediaPost>): PostTarget[] {
  const quotes = quoteRoots(article);
  const main = identity(article, quotes);
  const targets: PostTarget[] = [];
  const bar = [...article.querySelectorAll<HTMLElement>(X_DOM.actionBar)].find(
    (node) =>
      node.closest(X_DOM.article) === article &&
      !quotes.some((quote) => quote.contains(node)) &&
      !!node.querySelector(X_DOM.postActions),
  );
  const media = visibleMedia(article, quotes);
  if (main && bar && media.length) {
    targets.push({
      root: article,
      container: bar,
      post: buildPost(main, media, cache),
      quote: false,
    });
  }
  for (const quote of quotes) {
    const visible = visibleMedia(quote, []);
    const knownId = main ? cache.get(main.postId)?.quotedPostId : undefined;
    const known = knownId ? cache.get(knownId) : undefined;
    const id = known ?? identity(quote, []);
    if (id && visible.length) {
      targets.push({
        root: quote,
        container: quote,
        post: buildPost(id, visible, cache),
        quote: true,
      });
    }
  }
  return targets;
}

/** プロフィールのメディアタブにはアクションバーがないため，タイル右下に配置する． */
export function tileTargets(root: ParentNode, cache: Map<string, MediaPost>): PostTarget[] {
  const targets = new Map<HTMLElement, PostTarget>();
  for (const link of root.querySelectorAll<HTMLAnchorElement>(X_DOM.postLink)) {
    if (link.closest(X_DOM.article) || !isPostMediaPath(link.pathname)) continue;
    const id = parsePostLink(link.href);
    // 現行グリッドではリンクの直親がタイル．ラッパー階層の変更時は配置先をここで直す．
    const container = link.parentElement;
    if (!id || !container || !link.querySelector(X_DOM.tileMedia)) continue;
    const media = visibleMedia(link, []);
    if (!media.length) {
      const image = link.querySelector<HTMLImageElement>(X_DOM.image);
      const photo = image ? imageMedia(image.currentSrc || image.src) : undefined;
      if (photo) media.push(photo);
    }
    if (!media.length) continue;
    const known = cache.get(id.postId);
    // グリッドには一部の画像しかない場合があるため，全件データを確認できた場合だけ表示する．
    if (!known?.media.length) continue;
    targets.set(container, { root: container, container, post: known, quote: false, tile: true });
  }
  return [...targets.values()];
}
