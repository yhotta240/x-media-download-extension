export const ARCHIVE_TARGET = "xmd:archive";
export const ARCHIVE_CHANGED = "xmd:archive-changed";
export const ARCHIVE_PAGE = "offscreen.html";

export type ArchiveFile = { url: string | null; filename: string; error?: string };
export type ArchiveSnapshot =
  | { state: "building" }
  | { state: "ready"; url: string; failed: boolean; errors?: string[] }
  | { state: "error"; error: string };

export interface ArchiveService {
  prepare(jobId: string, files: ArchiveFile[]): Promise<ArchiveSnapshot>;
  release(jobId: string): Promise<void>;
}
