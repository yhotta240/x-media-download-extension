import assert from "node:assert/strict";
import test from "node:test";
import { extractPosts, imageMedia, isMp4Url, mediaFilename, parsePostLink, validatePost, videoMedia } from "../src/media/parse.ts";

const photo = (id: string) => ({ type: "photo", media_url_https: `https://pbs.twimg.com/media/${id}.jpg` });
const video = { type: "video", video_info: { variants: [
  { content_type: "application/x-mpegURL", url: "https://video.twimg.com/ext_tw_video/1/playlist.m3u8" },
  { content_type: "video/mp4", bitrate: 256000, url: "https://video.twimg.com/ext_tw_video/1/vid/320x180/a.mp4" },
  { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/ext_tw_video/1/vid/1280x720/a.mp4?tag=12" },
] } };
function tweet(postId: string, media: unknown[], extra = {}) {
  return { rest_id: postId, core: { user_results: { result: { core: { screen_name: "example" } } } },
    legacy: { extended_entities: { media } }, ...extra };
}

test("画像は配信形式を維持し，origを要求する", () => {
  assert.equal(imageMedia("https://pbs.twimg.com/media/test?format=png&name=small")?.url,
    "https://pbs.twimg.com/media/test?format=png&name=orig");
  assert.equal(imageMedia("https://pbs.twimg.com/media/test.jpg:large")?.ext, "jpg");
  assert.equal(imageMedia("https://pbs.twimg.com/media/test.jpg:large")?.url,
    "https://pbs.twimg.com/media/test.jpg?format=jpg&name=orig");
});

test("任意ホスト・HTTP・認証付きURL・アバターを保存対象にしない", () => {
  for (const url of ["http://pbs.twimg.com/media/a.jpg", "https://pbs.twimg.com.evil.test/media/a.jpg",
    "https://evil.test/a.jpg", "https://user@pbs.twimg.com/media/a.jpg",
    "https://pbs.twimg.com:444/media/a.jpg", "https://pbs.twimg.com/profile_images/a.jpg"]) {
    assert.equal(imageMedia(url), undefined);
  }
  assert.equal(isMp4Url("https://evil.test/a.mp4"), false);
  assert.equal(isMp4Url("https://video.twimg.com/dm_video/a.mp4"), false);
});

test("HLSを除き，最高ビットレートのMP4を選ぶ", () => {
  const selected = videoMedia(video.video_info.variants);
  assert.equal(selected.url, video.video_info.variants[2].url);
  assert.equal(selected.ext, "mp4");
});

test("ビットレート同値では解像度を比較する", () => {
  const selected = videoMedia([
    { content_type: "video/mp4", bitrate: 100, url: "https://video.twimg.com/a/320x180/a.mp4" },
    { content_type: "video/mp4", bitrate: 100, url: "https://video.twimg.com/a/1280x720/a.mp4" },
  ]);
  assert.match(selected.url ?? "", /1280x720/);
});

test("HLSのみ・DRM・URL欠落は失敗メディアとして残す", () => {
  for (const variants of [[], null, [{ content_type: "application/x-mpegURL", url: "https://video.twimg.com/a.m3u8" }]]) {
    assert.equal(videoMedia(variants).url, null);
    assert.equal(videoMedia(variants).ext, "mp4");
  }
});

test("DRMの指定があるMP4候補を保存しない", () => {
  const [post] = extractPosts(tweet("123", [{ ...video, drm_protected: true }]));
  assert.equal(post.media[0].url, null);
  assert.equal(videoMedia([{ ...video.video_info.variants[2], drm: { type: "widevine" } }]).url, null);
});

test("混在メディア・GIFを表示順に取り出す", () => {
  const [post] = extractPosts({ data: { result: tweet("123", [photo("one"), video,
    { ...video, type: "animated_gif" }, photo("four")]) } });
  assert.deepEqual(post.media.map((item) => item.kind), ["photo", "video", "video", "photo"]);
  assert.deepEqual(post.media.map((item, index) => mediaFilename(post, item, index + 1)),
    ["example_123_1.jpg", "example_123_2.mp4", "example_123_3.mp4", "example_123_4.jpg"]);
});

test("引用元・引用する側・リポスト元を独立した投稿として解析する", () => {
  const quoted = tweet("200", [photo("quote")]);
  const main = tweet("100", [photo("main")], { quoted_status_result: { result: quoted } });
  const repost = tweet("300", [], { legacy: { retweeted_status_result: { result: main } } });
  const posts = extractPosts({ entries: [repost] });
  assert.equal(posts.find((post) => post.postId === "100")?.quotedPostId, "200");
  assert.match(posts.find((post) => post.postId === "100")?.media[0].url ?? "", /main/);
  assert.match(posts.find((post) => post.postId === "200")?.media[0].url ?? "", /quote/);
  assert.equal(posts.find((post) => post.postId === "300")?.media.length, 0);
});

test("従来のユーザー情報と可視性ラッパーにも対応する", () => {
  const post = tweet("100", [photo("main")]);
  post.core.user_results.result = { legacy: { screen_name: "old_user" } } as never;
  assert.equal(extractPosts({ result: { tweet: post } })[0].username, "old_user");
});

test("ページ由来の投稿データを再検証し，パス注入を拒否する", () => {
  const post = extractPosts(tweet("123", [photo("one")]))[0];
  assert.ok(validatePost(post));
  assert.equal(validatePost({ ...post, username: "../test" }), undefined);
  assert.equal(validatePost({ ...post, postId: "1/../../" }), undefined);
  assert.equal(validatePost({ ...post, media: [{ kind: "video", url: "https://evil.test/a.mp4", ext: "mp4" }] }), undefined);
  assert.equal(validatePost({ ...post, media: [{ kind: "photo", url: "file:///c:/test", ext: "exe" }] }), undefined);
});

test("ポストリンクはXの投稿だけを受け付ける", () => {
  assert.deepEqual(parsePostLink("/some_user/status/123/photo/2"), { username: "some_user", postId: "123" });
  assert.equal(parsePostLink("https://evil.test/user/status/123"), undefined);
  assert.equal(parsePostLink("/some_user"), undefined);
});
