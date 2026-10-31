import { ARCHIVE_CHANGED, ARCHIVE_PAGE } from "../archive/types.ts";
import { asRecord, isPostId, validatePost } from "../media/parse.ts";
import { type DownloadReply, GET_DOWNLOAD, START_DOWNLOAD } from "../media/types.ts";
import { logError } from "../utils/logger.ts";
import { isSupportedXUrl } from "../x/site.ts";
import { DownloadManager } from "./downloads.ts";

const manager = new DownloadManager(chrome);

function isXPage(sender: chrome.runtime.MessageSender): boolean {
  try {
    return (
      sender.id === chrome.runtime.id &&
      sender.tab?.id !== undefined &&
      (sender.frameId ?? 0) === 0 &&
      isSupportedXUrl(sender.url ?? "")
    );
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const request = asRecord(message);
  if (
    request?.type === ARCHIVE_CHANGED &&
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL(ARCHIVE_PAGE) &&
    !sender.tab &&
    typeof request.jobId === "string"
  ) {
    void (async () => {
      try {
        await manager.archiveChanged(request.jobId as string);
        sendResponse({ ok: true });
      } catch (error) {
        console.warn("ZIPの保存状態を更新できませんでした", error);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
  if (!request || ![START_DOWNLOAD, GET_DOWNLOAD].includes(String(request.type))) return;
  if (!isXPage(sender)) {
    sendResponse({ ok: false, error: "対象外のページです" });
    return;
  }
  void (async () => {
    try {
      if (request.type === START_DOWNLOAD) {
        const post = validatePost(request.post);
        if (!post?.media.length) throw new Error("保存対象のメディアがありません");
        const status = await manager.accept(post, {
          tabId: sender.tab?.id as number,
          ...(sender.documentId ? { documentId: sender.documentId } : {}),
        });
        sendResponse({ ok: true, status } satisfies DownloadReply);
        await manager.status(post.postId);
      } else {
        if (!isPostId(request.postId)) throw new Error("不正なポストIDです");
        const status = await manager.status(request.postId);
        sendResponse(
          status ? { ok: true, status } : { ok: false, error: "保存状態が見つかりません" },
        );
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "ダウンロード処理に失敗しました",
      });
      if (request.type === START_DOWNLOAD) {
        try {
          await logError("保存を開始できませんでした", "background", error);
        } catch (logError) {
          console.warn("エラーログを記録できませんでした", logError);
        }
      }
    }
  })();
  return true;
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) {
    suggest();
    return;
  }
  void (async () => {
    let filename: string | undefined;
    try {
      filename = await manager.filenameFor(item);
    } catch (error) {
      console.warn("保存名の取得に失敗しました", error);
    }
    // 対象外・取得失敗でも必ず応答して，Chromeの保存処理を止めない．
    suggest(filename ? { filename, conflictAction: "uniquify" } : undefined);
  })();
  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current || delta.error?.current) {
    void manager
      .refresh(delta.id)
      .catch((error) => console.warn("保存状態の更新に失敗しました", error));
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const { enabled } = await chrome.storage.local.get("enabled");
    if (enabled === undefined) await chrome.storage.local.set({ enabled: true });
    await manager.recover();
  })().catch((error) => console.warn("初期設定の読み込みに失敗しました", error));
});

void manager.recover().catch((error) => console.warn("保存状態の復元に失敗しました", error));
