/** ストアのURL形式が変わった場合はここだけを修正する．拡張機能IDは実行環境から受け取る． */
export function extensionStoreUrl(extensionId: string): string {
  return `https://chrome.google.com/webstore/detail/${extensionId}`;
}
