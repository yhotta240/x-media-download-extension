import { imageMedia, parsePostLink } from "../media/parse.ts";
import type { MediaItem, MediaPost, PostIdentity } from "../media/types.ts";

export const ARTICLE = 'article[data-testid="tweet"]';
export const HOST = "[data-xmd-host]";

export type PostTarget = {
  root: HTMLElement;
  container: HTMLElement;
  post: MediaPost;
  quote: boolean;
  tile?: boolean;
};

function quoteRoots(article: HTMLElement): HTMLElement[] {
  return [
    ...article.querySelectorAll<HTMLElement>('div[role="link"], [data-testid="quoteTweet"]'),
  ].filter(
    (node) =>
      node.closest(ARTICLE) === article &&
      !!node.querySelector('[data-testid="User-Name"]') &&
      !node.parentElement?.closest('div[role="link"], [data-testid="quoteTweet"]'),
  );
}

function identity(root: HTMLElement, excluded: HTMLElement[]): PostIdentity | undefined {
  const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].filter(
    (link) =>
      link.closest(ARTICLE) === root.closest(ARTICLE) &&
      !excluded.some((quote) => quote.contains(link)),
  );
  const preferred =
    links.find((link) => link.querySelector("time")) ??
    links.find((link) => /\/analytics(?:\?|$)/.test(link.pathname)) ??
    links.find((link) => /\/(photo|video)\/\d+/.test(link.pathname));
  return preferred ? parsePostLink(preferred.href) : undefined;
}

function visibleMedia(root: HTMLElement, excluded: HTMLElement[]): MediaItem[] {
  const owns = (node: Element) =>
    node.closest(ARTICLE) === root.closest(ARTICLE) &&
    !excluded.some((quote) => quote.contains(node)) &&
    !node.closest('[data-testid="card.wrapper"], [hidden], [aria-hidden="true"]');
  const warnings = root.querySelectorAll(
    '[data-testid="sensitiveMediaInterstitial"], [data-testid="sensitiveMediaWarning"]',
  );
  if ([...warnings].some(owns)) return [];
  const media: MediaItem[] = [];
  const seen = new Set<string>();
  for (const node of root.querySelectorAll<HTMLElement>(
    '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]',
  )) {
    if (!owns(node)) continue;
    const parentMedia = node.parentElement?.closest(
      '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]',
    );
    if (parentMedia && root.contains(parentMedia)) continue;
    if (
      node.matches('[data-testid="videoPlayer"]') ||
      node.querySelector('video, [data-testid="videoPlayer"]')
    ) {
      media.push({
        kind: "video",
        url: null,
        ext: "mp4",
        error: "動画の配信情報を取得できませんでした",
      });
    } else {
      const image = node.querySelector<HTMLImageElement>('img[src*="pbs.twimg.com/media/"]');
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
  const bar = [...article.querySelectorAll<HTMLElement>('[role="group"]')].find(
    (node) =>
      node.closest(ARTICLE) === article &&
      !quotes.some((quote) => quote.contains(node)) &&
      !!node.querySelector('[data-testid="reply"], [data-testid="like"], [data-testid="unlike"]'),
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
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
    if (link.closest(ARTICLE) || !/\/(photo|video)\/\d+/.test(link.pathname)) continue;
    const id = parsePostLink(link.href);
    const container = link.parentElement;
    if (!id || !container || !link.querySelector('img, video, [data-testid="videoPlayer"]'))
      continue;
    const media = visibleMedia(link, []);
    if (!media.length) {
      const image = link.querySelector<HTMLImageElement>('img[src*="pbs.twimg.com/media/"]');
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
