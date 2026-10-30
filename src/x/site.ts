/**
 * XのURL・配信元・対象画面のルール．ドメインやルーティングの変更はここで対応する．
 * 対象画面を変更するときは，public/manifest.*.jsonの宣言も合わせて更新する．
 * CDNホスト名の完全一致は安全性の制約でもある．安易に任意ホストを許可しないこと．
 */
export const X_ORIGIN = "https://x.com";
export const X_MATCH_PATTERN = `${X_ORIGIN}/*`;
export const X_IMAGE_HOST = "pbs.twimg.com";
export const X_VIDEO_HOST = "video.twimg.com";
export const X_IMAGE_PATH = "/media/";
const X_EXCLUDED_PATHS = ["/messages", "/i/chat", "/i/broadcasts", "/i/spaces"] as const;

export function isSupportedXPage(pathname: string): boolean {
  return !X_EXCLUDED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isSupportedXUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return url.origin === X_ORIGIN && isSupportedXPage(url.pathname);
  } catch {
    return false;
  }
}

export function isXMediaPage(pathname: string): boolean {
  return /\/media\/?$/.test(pathname);
}

export function isPostMediaPath(pathname: string): boolean {
  return /\/(photo|video)\/\d+/.test(pathname);
}

export function isPostAnalyticsPath(pathname: string): boolean {
  return /\/analytics(?:\?|$)/.test(pathname);
}

/** APIの経路・操作名が変わった場合の修正箇所．追加通信は行わず閲覧済み応答だけを対象とする． */
export function isXPostApiUrl(source: string): boolean {
  try {
    const url = new URL(source, X_ORIGIN);
    return (
      url.origin === X_ORIGIN &&
      url.pathname.startsWith("/i/api/graphql/") &&
      !/dm|chat|message/i.test(url.pathname.split("/").pop() ?? "")
    );
  } catch {
    return false;
  }
}
