/**
 * 拡張機能側の動作方針．XのDOM・配信仕様とは分けて管理する．
 * 上限は負荷とメモリ消費を抑えるための値であり，Xの投稿上限を表すものではない．
 */
export const LIMITS = {
  // 受信準備待ちのバッファと，受信側のキャッシュに使う上限．古い投稿から破棄する．
  cachedPosts: 400,
  // 送信側と受信側で共有するメッセージ1件あたりの投稿数．
  bridgePosts: 40,
  // 1フレームで処理するポスト数．スクロール中のDOM処理を分割する．
  postsPerFrame: 15,
  mediaPerPost: 16,
  responseNodes: 50_000,
  mediaUrlLength: 4096,
  // 完了済みジョブのみ間引く．処理中のジョブは件数で削除しない．
  finishedJobs: 60,
  recoveryDownloads: 100,
} as const;

export const TIMING = {
  // 成功・失敗を読める時間を確保し，その後に再ダウンロードを許可する．
  resultDisplayMs: 2200,
  // 完了通知の取りこぼしやService Worker再起動を補う問い合わせ間隔．
  statusPollMs: 1500,
} as const;

// 開発用WebSocketのサーバーとクライアントで共有する．片側だけの変更による接続切れを防ぐ．
export const DEV_RELOAD_PORT = 6571;
