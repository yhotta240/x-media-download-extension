# X Media Download

Xのポストに含まれる画像・動画をワンクリックで保存するChrome拡張機能．

現在は **0.0.1** の開発準備段階．ダウンロード機能は未実装．

## 開発

Node.js（`^22.12.0 || >=24.0.0`）とnpmを使用する．

```bash
npm ci
npm run watch
```

Chromeの `chrome://extensions/` でデベロッパーモードを有効にし，`dist/` を読み込む．対象サイトは `https://x.com/*`．

本番用ビルド：`npm run build`

## 開発基盤

[yhotamos/chrome-extension-starter-kit](https://github.com/yhotamos/chrome-extension-starter-kit)を使用．ライセンスはMIT．
