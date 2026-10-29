import type { JobState } from "../media/types.ts";

type ButtonState = "idle" | JobState;
const PATHS: Record<ButtonState, string> = {
  idle: "M11 3h2v10.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V3zM4 17h2v3h12v-3h2v5H4v-5z",
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
