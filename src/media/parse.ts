import { LIMITS } from "../config.ts";
import { X_IMAGE_HOST, X_IMAGE_PATH, X_ORIGIN, X_VIDEO_HOST } from "../x/site.ts";
import type { MediaItem, MediaPost, PostIdentity } from "./types.ts";

// 保存形式の許可リスト．ファイル名の検証と画像URLの解析で同じ定義を使う．
const IMAGE_EXTENSIONS = ["jpg", "png", "webp", "gif", "avif"];
const FILE_EXTENSIONS = [...IMAGE_EXTENSIONS, "mp4"];

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isPostId(value: unknown): value is string {
  // IDをNumberに変換すると桁落ちする．25桁は入力検証用の防御的な上限．
  return typeof value === "string" && /^\d{1,25}$/.test(value);
}

export function isUsername(value: unknown): value is string {
  // Xのユーザー名形式．URL解析側でもこの検証を再利用する．
  return typeof value === "string" && /^[a-zA-Z0-9_]{1,15}$/.test(value);
}

export function parsePostLink(href: string): PostIdentity | undefined {
  try {
    const url = new URL(href, X_ORIGIN);
    if (url.origin !== X_ORIGIN) return;
    const match = url.pathname.match(/^\/([^/]+)\/status\/([^/]+)(?:\/|$)/);
    if (match && isUsername(match[1]) && isPostId(match[2])) {
      return { username: match[1], postId: match[2] };
    }
  } catch {
    // XのDOM変更や不正なリンクは無視する．
  }
}

export function imageMedia(source: string): MediaItem | undefined {
  try {
    const url = new URL(source);
    if (
      url.protocol !== "https:" ||
      url.hostname !== X_IMAGE_HOST ||
      url.port ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(X_IMAGE_PATH)
    )
      return;
    url.pathname = url.pathname.replace(/:(?:orig|large|medium|small|thumb|\d+x\d+)$/, "");
    const format = (url.searchParams.get("format") ?? url.pathname.match(/\.(\w+)$/)?.[1] ?? "jpg")
      .toLowerCase()
      .replace("jpeg", "jpg");
    if (!IMAGE_EXTENSIONS.includes(format)) return;
    url.searchParams.set("format", format);
    url.searchParams.set("name", "orig");
    url.hash = "";
    return { kind: "photo", url: url.href, ext: format };
  } catch {
    return;
  }
}

export function isMp4Url(value: unknown): value is string {
  if (typeof value !== "string" || value.length > LIMITS.mediaUrlLength) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === X_VIDEO_HOST &&
      !url.port &&
      !url.username &&
      !url.password &&
      /\.mp4$/i.test(url.pathname) &&
      !url.pathname.startsWith("/dm_video/")
    );
  } catch {
    return false;
  }
}

function resolution(url: string): number {
  const match = url.match(/\/(\d+)x(\d+)\//);
  return match ? Number(match[1]) * Number(match[2]) : 0;
}

export function videoMedia(variants: unknown): MediaItem {
  const candidates = (Array.isArray(variants) ? variants : [])
    .map(asRecord)
    .filter(
      (variant): variant is Record<string, unknown> =>
        !!variant &&
        variant.content_type === "video/mp4" &&
        !variant.drm &&
        variant.drm_protected !== true &&
        isMp4Url(variant.url),
    );
  candidates.sort(
    (a, b) =>
      (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0) ||
      resolution(String(b.url)) - resolution(String(a.url)),
  );
  return candidates[0]
    ? { kind: "video", url: String(candidates[0].url), ext: "mp4" }
    : {
        kind: "video",
        url: null,
        ext: "mp4",
        error: "保存可能なMP4がありません（HLS・保護動画は非対応）",
      };
}

function parseEntity(value: unknown): MediaItem | undefined {
  const entity = asRecord(value);
  if (!entity) return;
  if (entity.type === "photo") {
    return (
      imageMedia(String(entity.media_url_https ?? entity.media_url ?? "")) ?? {
        kind: "photo",
        url: null,
        ext: "jpg",
        error: "画像URLを取得できませんでした",
      }
    );
  }
  if (entity.type === "video" || entity.type === "animated_gif") {
    const info = asRecord(entity.video_info);
    if (
      entity.drm_protected === true ||
      entity.is_drm_protected === true ||
      info?.drm ||
      info?.drm_protected === true
    ) {
      return { kind: "video", url: null, ext: "mp4", error: "保護された動画は保存できません" };
    }
    return videoMedia(info?.variants);
  }
}

/**
 * XのGraphQL応答のスキーマ変更時の修正箇所．DOM変更への対応（content/posts.ts）とは独立して行う．
 * 現在はlegacy.extended_entities.mediaとcore.user_resultsを解析し，旧形式にもフォールバックする．
 * ここから返すMediaPostはXの生データを含めず，UIと保存処理はその形式だけに依存する．
 */
export function extractPosts(data: unknown): MediaPost[] {
  const posts = new Map<string, MediaPost>();
  const stack = [data];
  const visited = new WeakSet<object>();
  let count = 0;
  while (stack.length && count++ < LIMITS.responseNodes) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const node = asRecord(value);
    if (!node) continue;
    const legacy = asRecord(node.legacy);
    const postId = node.rest_id ?? legacy?.id_str;
    const userResult = asRecord(asRecord(asRecord(node.core)?.user_results)?.result);
    const user = asRecord(userResult?.result) ?? userResult;
    const username = asRecord(user?.core)?.screen_name ?? asRecord(user?.legacy)?.screen_name;
    if (legacy && isPostId(postId) && isUsername(username)) {
      const entities = asRecord(legacy.extended_entities) ?? asRecord(legacy.entities);
      const media = (Array.isArray(entities?.media) ? entities.media : [])
        .map(parseEntity)
        .filter((item): item is MediaItem => !!item)
        .slice(0, LIMITS.mediaPerPost);
      const quoteResult = asRecord(asRecord(node.quoted_status_result)?.result);
      const quotedPostId = legacy.quoted_status_id_str ?? quoteResult?.rest_id;
      posts.set(postId, {
        postId,
        username,
        media,
        ...(isPostId(quotedPostId) ? { quotedPostId } : {}),
      });
    }
    stack.push(...Object.values(node));
  }
  return [...posts.values()];
}

/** ページからのメッセージは信用せず，拡張機能側でも再検証する． */
export function validatePost(value: unknown): MediaPost | undefined {
  const post = asRecord(value);
  if (
    !post ||
    !isPostId(post.postId) ||
    !isUsername(post.username) ||
    !Array.isArray(post.media) ||
    post.media.length > LIMITS.mediaPerPost
  )
    return;
  const media: MediaItem[] = [];
  for (const value of post.media) {
    const item = asRecord(value);
    if (!item || (item.kind !== "photo" && item.kind !== "video")) return;
    if (item.url === null) {
      media.push({
        kind: item.kind,
        url: null,
        ext: item.kind === "video" ? "mp4" : "jpg",
        error: "メディアのURLまたは対応形式を取得できませんでした",
      });
    } else if (item.kind === "photo" && typeof item.url === "string") {
      const photo = imageMedia(item.url);
      if (!photo) return;
      media.push(photo);
    } else if (item.kind === "video" && isMp4Url(item.url)) {
      media.push({ kind: "video", url: item.url, ext: "mp4" });
    } else return;
  }
  return {
    postId: post.postId,
    username: post.username,
    media,
    ...(isPostId(post.quotedPostId) ? { quotedPostId: post.quotedPostId } : {}),
  };
}

export function mediaFilename(post: PostIdentity, item: MediaItem, index: number): string {
  if (
    !isPostId(post.postId) ||
    !isUsername(post.username) ||
    !Number.isInteger(index) ||
    index < 1 ||
    !FILE_EXTENSIONS.includes(item.ext)
  ) {
    throw new Error("不正なファイル名です");
  }
  return `${post.username}_${post.postId}_${index}.${item.ext}`;
}
