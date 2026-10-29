import { X_IMAGE_HOST, X_IMAGE_PATH } from "../x/site.ts";

const quote = 'div[role="link"], [data-testid="quoteTweet"]';
const photo = '[data-testid="tweetPhoto"]';
const video = '[data-testid="videoPlayer"]';

/**
 * XのDOM変更時に最初に確認するセレクター一覧．X生成のCSSクラスや子要素の番号は使わない．
 * 要素名・data-testidの変更はここ，親子関係や判定手順の変更はposts.tsで対応する．
 * テスト用DOMはtests/browser/fixture.jsに独立して記述し，変更後の実DOMに合わせて更新する．
 */
export const X_DOM = {
  article: 'article[data-testid="tweet"]',
  quote,
  quoteAuthor: '[data-testid="User-Name"]',
  postLink: 'a[href*="/status/"]',
  timestamp: "time",
  actionBar: '[role="group"]',
  // 閲覧数などの別groupをアクションバーと取り違えないための子要素．
  postActions: '[data-testid="reply"], [data-testid="like"], [data-testid="unlike"]',
  excludedMedia: '[data-testid="card.wrapper"], [hidden], [aria-hidden="true"]',
  sensitiveWarning:
    '[data-testid="sensitiveMediaInterstitial"], [data-testid="sensitiveMediaWarning"]',
  media: `${photo}, ${video}`,
  video,
  videoContent: `video, ${video}`,
  tileMedia: `img, video, ${video}`,
  image: `img[src*="${X_IMAGE_HOST}${X_IMAGE_PATH}"]`,
  // セレクターを変更したら，検出に必要な属性変更も監視できているか確認すること．
  observedAttributes: ["src", "href", "data-testid"],
} as const;
