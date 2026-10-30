import type { JobState } from "../media/types.ts";

// 拡張機能自身が生成するDOM．X側のDOM変更には依存しない．
export const BUTTON_HOST = "[data-xmd-host]";

type ButtonState = "idle" | JobState;
const PATHS: Record<ButtonState, string> = {
  // Xの共有アイコンと同じ24x24座標・線幅・トレイ形状に揃えた下向き矢印．
  idle: "M12 16.41l5.7-5.7-1.41-1.42L13 12.59V3h-2v9.59l-3.3-3.3-1.41 1.42L12 16.41zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z",
  processing: "M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8V2z",
  success: "M9 16.17 4.83 12 3.41 13.41 9 19 21 7l-1.41-1.41L9 16.17z",
  error: "M11 6h2v8h-2V6zm0 10h2v2h-2v-2zM12 2 1 22h22L12 2zm0 4.2L19.6 20H4.4L12 6.2z",
};
const LABELS: Record<ButtonState, string> = {
  idle: "メディアをダウンロード",
  processing: "ダウンロード中",
  success: "ダウンロード完了",
  error: "ダウンロード失敗",
};

export function setButtonState(
  button: HTMLButtonElement,
  state: ButtonState,
  detail?: string,
): void {
  button.dataset.state = state;
  button.disabled = state !== "idle";
  button.setAttribute("aria-busy", String(state === "processing"));
  const label = `${button.dataset.quote === "true" ? "引用ポストの" : ""}${LABELS[state]}`;
  button.setAttribute("aria-label", label);
  button.title = detail ? `${label}：${detail}` : label;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", PATHS[state]);
  svg.append(path);
  button.replaceChildren(svg);
}

export function createButton(quote: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "xmd-button";
  button.dataset.quote = String(quote);
  setButtonState(button, "idle");
  return button;
}
