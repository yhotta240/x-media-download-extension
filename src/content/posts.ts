import { imageMedia, parsePostLink } from "../media/parse.ts";
import type { MediaItem, MediaPost, PostIdentity } from "../media/types.ts";
import { isPostAnalyticsPath, isPostMediaPath } from "../x/site.ts";
import { BUTTON_HOST } from "./button.ts";
import { X_DOM } from "./x-dom.ts";

/**
 * XのDOMから保存対象を組み立てるアダプター．親子関係が変わった場合はこのファイルを修正する．
 * ボタンの状態管理・Chromeへの保存要求はindex.tsに置き，X固有の要素判定を混在させない．
 */

export type PostTarget = {
  container: HTMLElement;
  post: MediaPost;
  quote: boolean;
  tile?: boolean;
  iconSize?: string;
  hitPadding?: string;
  marginStart?: string;
};

/** Xのクラス名はコピーせず，標準ボタンの表示サイズ・配置方法だけを読み取る． */
function actionButtonLayout(
  bar: HTMLElement,
): Pick<PostTarget, "iconSize" | "hitPadding" | "marginStart"> {
  const layout: Pick<PostTarget, "iconSize" | "hitPadding" | "marginStart"> = {};
  const style = getComputedStyle(bar);
  const icon = bar.querySelector(X_DOM.postActions)?.querySelector("svg");
  let iconWidth = 0;
  if (icon) {
    const width = Number.parseFloat(getComputedStyle(icon).width);
    const fontSize = Number.parseFloat(style.fontSize);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(fontSize) && fontSize > 0) {
      iconWidth = width;
      // em比率にしておくことで，Xの文字サイズ設定の変更にも追従する．
      layout.iconSize = `${width / fontSize}em`;
    }
  }
  const nativeItems = [...bar.children].filter((item) => !item.matches(BUTTON_HOST));
  const beforeLast = nativeItems[nativeItems.length - 2];
  const last = nativeItems[nativeItems.length - 1];
  const previousStyle = beforeLast ? getComputedStyle(beforeLast) : undefined;
  const lastStyle = last ? getComputedStyle(last) : undefined;
  const pixels = (value: string | undefined) => Number.parseFloat(value ?? "") || 0;
  // 一覧ではブックマークの末尾marginも共有との間隔に含まれる．追加UI側に同じ間隔を再現する．
  const nativeMargin =
    pixels(previousStyle?.marginInlineEnd) + pixels(lastStyle?.marginInlineStart);
  // 詳細でも伸縮させず共有の直後に置く．クリック領域は隣の共有ボタンを覆わないよう制限する．
  const gap = Number.parseFloat(style.columnGap);
  const standardGap = Number.isFinite(gap) ? gap : 0;
  // 共有との間は最低でもアイコン幅の半分を空ける．一覧の標準間隔が広ければその値を維持する．
  const spacing = Math.max(standardGap + nativeMargin, iconWidth / 2);
  layout.marginStart = `${spacing - standardGap - pixels(lastStyle?.marginInlineEnd)}px`;
  layout.hitPadding = `${Math.max(0, spacing / 2)}px`;
  return layout;
}

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
      container: bar,
      post: buildPost(main, media, cache),
      quote: false,
      ...actionButtonLayout(bar),
    });
  }
  for (const quote of quotes) {
    const visible = visibleMedia(quote, []);
    const knownId = main ? cache.get(main.postId)?.quotedPostId : undefined;
    const known = knownId ? cache.get(knownId) : undefined;
    const id = known ?? identity(quote, []);
    if (id && visible.length) {
      targets.push({
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
    targets.set(container, { container, post: known, quote: false, tile: true });
  }
  return [...targets.values()];
}
