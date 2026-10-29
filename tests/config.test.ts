import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LIMITS } from "../src/config.ts";
import { extractPosts, validatePost } from "../src/media/parse.ts";
import {
  isPostAnalyticsPath, isPostMediaPath, isSupportedXPage, isSupportedXUrl,
  isXMediaPage, isXPostApiUrl, X_EXCLUDE_MATCHES, X_EXCLUDED_PATHS, X_MATCH_PATTERN, X_ORIGIN,
} from "../src/x/site.ts";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("開発・本番の両Manifestで対象サイトと除外画面の定義が一致する", () => {
  for (const mode of ["dev", "prod"]) {
    const manifest = readJson(`../public/manifest.${mode}.json`);
    for (const entry of manifest.content_scripts) {
      assert.deepEqual(entry.matches, [X_MATCH_PATTERN], `${mode}: matches`);
      assert.deepEqual(entry.exclude_matches, X_EXCLUDE_MATCHES, `${mode}: exclude_matches`);
    }
  }
});

test("パッケージ・ロックファイル・両Manifestのバージョンと説明にずれがない", () => {
  const pkg = readJson("../package.json");
  const lock = readJson("../package-lock.json");
  const dev = readJson("../public/manifest.dev.json");
  const prod = readJson("../public/manifest.prod.json");
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(lock.name, pkg.name);
  for (const manifest of [dev, prod]) {
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.description, pkg.description);
  }
  assert.equal(dev.name, prod.name);
  assert.equal(dev.short_name, prod.short_name);
});

test("対象画面と除外画面の判定をContent ScriptとBackgroundで共有する", () => {
  for (const path of ["/home", "/search", "/i/bookmarks", "/example", "/example/media", "/example/status/123"]) {
    assert.equal(isSupportedXPage(path), true);
    assert.equal(isSupportedXUrl(X_ORIGIN + path), true);
  }
  for (const path of X_EXCLUDED_PATHS) {
    for (const suffix of ["", "/", "/123"]) {
      assert.equal(isSupportedXPage(path + suffix), false);
      assert.equal(isSupportedXUrl(X_ORIGIN + path + suffix), false);
    }
  }
  assert.equal(isSupportedXPage("/messages-other"), true, "経路の境界を確認する");
});

test("許可ドメインを部分一致に緩めない", () => {
  for (const source of ["https://x.com.evil.test/home", "http://x.com/home", "https://evil.test/home", "not a URL"]) {
    assert.equal(isSupportedXUrl(source), false);
  }
});

test("APIの操作名だけでDMを除外し，ランダムなハッシュ部分とは区別する", () => {
  assert.equal(isXPostApiUrl(`${X_ORIGIN}/i/api/graphql/dmHash/HomeTimeline`), true);
  assert.equal(isXPostApiUrl(`${X_ORIGIN}/i/api/graphql/hash/DMConversationTimeline`), false);
  assert.equal(isXPostApiUrl("https://x.com.evil.test/i/api/graphql/hash/HomeTimeline"), false);
  assert.equal(isXPostApiUrl(`${X_ORIGIN}/resource`), false);
});

test("DOM側で使う投稿リンクとメディアタブのURL判定", () => {
  assert.equal(isPostMediaPath("/example/status/123/photo/1"), true);
  assert.equal(isPostMediaPath("/example/status/123/video/1"), true);
  assert.equal(isPostMediaPath("/example/status/123"), false);
  assert.equal(isPostAnalyticsPath("/example/status/123/analytics"), true);
  assert.equal(isPostAnalyticsPath("/example/status/123/photo/1"), false);
  assert.equal(isXMediaPage("/example/media/"), true);
  assert.equal(isXMediaPage("/example/status/123"), false);
});

test("メディア解析と受信検証で同じ防御上限を使う", () => {
  const entities = Array.from({ length: LIMITS.mediaPerPost + 1 }, (_, index) => ({
    type: "photo", media_url_https: `https://pbs.twimg.com/media/test${index}.jpg`,
  }));
  const [post] = extractPosts({ rest_id: "123", legacy: { extended_entities: { media: entities } },
    core: { user_results: { result: { legacy: { screen_name: "example" } } } } });
  assert.equal(post.media.length, LIMITS.mediaPerPost);
  assert.ok(validatePost(post));
  assert.equal(validatePost({ ...post, media: [...post.media, post.media[0]] }), undefined);
});
