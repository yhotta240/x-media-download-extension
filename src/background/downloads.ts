import { LIMITS } from "../config.ts";
import { mediaFilename } from "../media/parse.ts";
import { DOWNLOAD_STATUS, type JobStatus, type MediaPost } from "../media/types.ts";

type Client = { tabId: number; documentId?: string };
type DownloadEntry = {
  url: string | null;
  filename: string;
  state: "queued" | "starting" | "in_progress" | "complete" | "interrupted";
  downloadId?: number;
  error?: string;
};
type DownloadJob = {
  postId: string;
  jobId: string;
  createdAt: number;
  state: "processing" | "success" | "error";
  clients: Client[];
  entries: DownloadEntry[];
};
const PREFIX = "xmd:job:";

export function jobStatus(job: DownloadJob): JobStatus {
  return {
    postId: job.postId,
    jobId: job.jobId,
    state: job.state,
    completed: job.entries.filter((entry) => entry.state === "complete").length,
    total: job.entries.length,
    ...(job.state === "error"
      ? {
          error: job.entries.find((entry) => entry.error)?.error ?? "ダウンロードに失敗しました",
        }
      : {}),
  };
}

/** ジョブとdownloadIdはsessionに保存し，SWの停止後も状態を復元する． */
export class DownloadManager {
  private api: typeof chrome;
  // 実行中のイベントの排他制御のみ．ジョブの正本は常にstorage.sessionにある．
  private queue: Promise<unknown> = Promise.resolve();

  constructor(api: typeof chrome) {
    this.api = api;
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    const next = (async () => {
      try {
        await previous;
      } catch {
        /* 前の失敗で後続を止めない． */
      }
      return action();
    })();
    this.queue = next;
    return next;
  }

  private async load(postId: string): Promise<DownloadJob | undefined> {
    const key = PREFIX + postId;
    return (await this.api.storage.session.get(key))[key] as DownloadJob | undefined;
  }

  private async allJobs(): Promise<DownloadJob[]> {
    return Object.entries(await this.api.storage.session.get(null))
      .filter(([key]) => key.startsWith(PREFIX))
      .map(([, value]) => value as DownloadJob);
  }

  /** 他の拡張機能が保存名を決定する環境でも，本拡張機能の要求には指定名を提案する． */
  async filenameFor(
    item: Pick<chrome.downloads.DownloadItem, "id" | "url" | "byExtensionId">,
  ): Promise<string | undefined> {
    if (item.byExtensionId !== this.api.runtime.id) return;
    // download()の完了待ちと競合させないため，排他キューには入れず保存済みジョブを読む．
    const entries = (await this.allJobs()).flatMap((job) => job.entries);
    const assigned = entries.find((entry) => entry.downloadId === item.id);
    if (assigned) return assigned.filename;
    // downloadIdの保存より先にイベントが届く場合だけ，開始中のURLと照合する．
    const pending = entries.filter(
      (entry) =>
        entry.state === "starting" && entry.downloadId === undefined && entry.url === item.url,
    );
    return pending.length === 1 ? pending[0].filename : undefined;
  }

  private async save(job: DownloadJob): Promise<void> {
    await this.api.storage.session.set({ [PREFIX + job.postId]: job });
    for (const client of job.clients) {
      try {
        await this.api.tabs.sendMessage(
          client.tabId,
          { type: DOWNLOAD_STATUS, status: jobStatus(job) },
          client.documentId ? { documentId: client.documentId } : { frameId: 0 },
        );
      } catch {
        /* 元ページが閉じられてもダウンロードは継続する． */
      }
    }
  }

  async accept(post: MediaPost, client: Client): Promise<JobStatus> {
    return this.exclusive(async () => {
      const { enabled } = await this.api.storage.local.get("enabled");
      if (enabled === false) throw new Error("拡張機能が無効です");
      const current = await this.load(post.postId);
      if (current?.state === "processing") {
        if (
          !current.clients.some(
            (c) => c.tabId === client.tabId && c.documentId === client.documentId,
          )
        ) {
          current.clients.push(client);
          await this.save(current);
        }
        return jobStatus(current);
      }
      const job: DownloadJob = {
        postId: post.postId,
        jobId: crypto.randomUUID(),
        createdAt: Date.now(),
        state: "processing",
        clients: [client],
        entries: post.media.map((media, index) => ({
          url: media.url,
          filename: mediaFilename(post, media, index + 1),
          state: media.url ? "queued" : "interrupted",
          ...(media.url ? {} : { error: media.error ?? "メディアを取得できませんでした" }),
        })),
      };
      await this.save(job);
      const finished = (await this.allJobs())
        .filter((entry) => entry.state !== "processing")
        .sort((a, b) => b.createdAt - a.createdAt);
      if (finished.length > LIMITS.finishedJobs) {
        await this.api.storage.session.remove(
          finished.slice(LIMITS.finishedJobs).map((entry) => PREFIX + entry.postId),
        );
      }
      return jobStatus(job);
    });
  }

  private async inspect(entry: DownloadEntry): Promise<void> {
    if (entry.downloadId === undefined) return;
    const [item] = await this.api.downloads.search({ id: entry.downloadId });
    if (!item) {
      entry.state = "interrupted";
      entry.error = "ダウンロード状態を確認できませんでした";
    } else {
      entry.state = item.state;
      if (item.state === "interrupted") entry.error = item.error ?? "ダウンロードが中断されました";
    }
  }

  private async execute(job: DownloadJob): Promise<void> {
    for (const entry of job.entries) {
      if (entry.state === "starting" && entry.downloadId === undefined) {
        // download()の受理直後にSWが停止した場合は，既存要求を探す．再発行はしない．
        const candidates = await this.api.downloads.search({
          startedAfter: new Date(job.createdAt).toISOString(),
          limit: LIMITS.recoveryDownloads,
          orderBy: ["-startTime"],
        });
        const claimedIds = new Set(job.entries.map((item) => item.downloadId));
        const found = candidates.find(
          (item) =>
            item.url === entry.url &&
            item.byExtensionId === this.api.runtime.id &&
            !claimedIds.has(item.id),
        );
        if (found) entry.downloadId = found.id;
        else {
          entry.state = "interrupted";
          entry.error = "保存要求を復元できませんでした．もう一度お試しください";
        }
      }
      if (entry.state === "queued" && entry.url) {
        entry.state = "starting";
        await this.save(job);
        try {
          entry.downloadId = await this.api.downloads.download({
            url: entry.url,
            filename: entry.filename,
            conflictAction: "uniquify",
            // saveAsを省略し，Chromeの保存場所確認設定を尊重する．
          });
          entry.state = "in_progress";
        } catch (error) {
          entry.state = "interrupted";
          entry.error =
            error instanceof Error
              ? error.message
              : "保存がキャンセルされたか，開始できませんでした";
        }
        await this.save(job);
      }
      if (
        entry.downloadId !== undefined &&
        entry.state !== "complete" &&
        entry.state !== "interrupted"
      ) {
        await this.inspect(entry);
      }
    }
    const settled = job.entries.every(
      (entry) => entry.state === "complete" || entry.state === "interrupted",
    );
    if (settled)
      job.state = job.entries.every((entry) => entry.state === "complete") ? "success" : "error";
    await this.save(job);
  }

  async status(postId: string): Promise<JobStatus | undefined> {
    return this.exclusive(async () => {
      const job = await this.load(postId);
      if (!job) return;
      if (job.state === "processing") await this.execute(job);
      return jobStatus(job);
    });
  }

  async refresh(downloadId: number): Promise<void> {
    await this.exclusive(async () => {
      for (const job of await this.allJobs()) {
        if (
          job.state === "processing" &&
          job.entries.some((entry) => entry.downloadId === downloadId)
        ) {
          await this.execute(job);
        }
      }
    });
  }

  async recover(): Promise<void> {
    await this.exclusive(async () => {
      for (const job of await this.allJobs()) {
        if (job.state === "processing") await this.execute(job);
      }
    });
  }
}
