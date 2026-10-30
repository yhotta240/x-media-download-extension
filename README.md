# X Media Download

Xのポストに含まれる画像・動画をワンクリックで保存できるChrome拡張機能です．

## 主な機能

- ポスト内の画像・動画・GIFを保存
- 画像は最大解像度，動画・GIFは取得可能な最高画質のMP4で保存
- 引用ポスト・メディアタブにも対応

## インストール

### Chrome Web Store からインストール

準備中…

### 手動インストール

Node.js（`^22.12.0 || >=24.0.0`）とnpmを使用する．

```bash
git clone https://github.com/yhotta240/x-media-download-extension.git
cd x-media-download-extension
npm ci
npm run build
```

Chromeの `chrome://extensions/` でデベロッパーモードを有効にし，「パッケージ化されていない拡張機能を読み込む」から `dist/` を選択する．

## 使い方

Xのポストにあるダウンロードボタンを押すと保存できます．詳しい操作は[チュートリアル](docs/tutorial.md)を確認してください．

## 開発

- 開発ビルド：`npm run watch`
- テスト：`npm test`
- UI検証：`npm run test:ui` を実行し，表示されたURLを開く．

## ライセンス

[chrome-extension-starter-kit](https://github.com/yhotamos/chrome-extension-starter-kit)を使用．MITライセンス．

## 作者

yhotta240
