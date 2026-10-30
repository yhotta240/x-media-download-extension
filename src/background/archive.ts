import {
  ARCHIVE_PAGE,
  ARCHIVE_TARGET,
  type ArchiveFile,
  type ArchiveService,
  type ArchiveSnapshot,
} from "../archive/types.ts";

export class OffscreenArchive implements ArchiveService {
  private api: typeof chrome;

  constructor(api: typeof chrome) {
    this.api = api;
  }

  private async exists(): Promise<boolean> {
    // clients.matchAllは既存の最低対応バージョン（Chrome 111）でも利用できる．
    const worker = globalThis as unknown as {
      clients: { matchAll(options: { includeUncontrolled: boolean }): Promise<{ url: string }[]> };
    };
    const clients = await worker.clients.matchAll({ includeUncontrolled: true });
    return clients.some((client) => client.url === this.api.runtime.getURL(ARCHIVE_PAGE));
  }

  async prepare(jobId: string, files: ArchiveFile[]): Promise<ArchiveSnapshot> {
    // 呼び出し元のDownloadManagerが直列化するため，作成・破棄は競合しない．
    if (!(await this.exists())) {
      await this.api.offscreen.createDocument({
        url: ARCHIVE_PAGE,
        reasons: [this.api.offscreen.Reason.BLOBS],
        justification: "複数メディアのZIP生成と保存完了までのBlob URL保持",
      });
    }
    return this.api.runtime.sendMessage({ target: ARCHIVE_TARGET, type: "build", jobId, files });
  }

  async release(jobId: string): Promise<void> {
    if (!(await this.exists())) return;
    const result = await this.api.runtime.sendMessage({
      target: ARCHIVE_TARGET,
      type: "release",
      jobId,
    });
    if (result?.idle) await this.api.offscreen.closeDocument();
  }
}
