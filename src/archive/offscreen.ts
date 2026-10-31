import { asRecord } from "../media/parse.ts";
import {
  ARCHIVE_CHANGED,
  ARCHIVE_TARGET,
  type ArchiveFile,
  type ArchiveSnapshot,
} from "./types.ts";
import { buildZip } from "./zip.ts";

type Task = { snapshot: ArchiveSnapshot; controller: AbortController };
const tasks = new Map<string, Task>();
const queue: { jobId: string; files: ArchiveFile[]; task: Task }[] = [];
let working = false;

async function drain(): Promise<void> {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const next = queue.shift();
      if (!next || tasks.get(next.jobId) !== next.task) continue;
      const { jobId, files, task } = next;
      try {
        const { blob, failed, errors } = await buildZip(files, task.controller.signal);
        if (tasks.get(jobId) !== task) continue;
        task.snapshot = { state: "ready", url: URL.createObjectURL(blob), failed, errors };
      } catch (error) {
        task.snapshot = {
          state: "error",
          error: error instanceof Error ? error.message : "ZIPを生成できませんでした",
        };
      }
      if (tasks.get(jobId) === task) {
        try {
          await chrome.runtime.sendMessage({ type: ARCHIVE_CHANGED, jobId });
        } catch {
          // SWの停止中でも結果を保持し，次の状態確認に応答する．
        }
      }
    }
  } finally {
    working = false;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const request = asRecord(message);
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    request?.target !== ARCHIVE_TARGET ||
    typeof request.jobId !== "string"
  )
    return;
  const task = tasks.get(request.jobId);
  if (request.type === "release") {
    task?.controller.abort();
    if (task?.snapshot.state === "ready") URL.revokeObjectURL(task.snapshot.url);
    tasks.delete(request.jobId);
    sendResponse({ idle: tasks.size === 0 });
  } else if (request.type === "build" && Array.isArray(request.files)) {
    if (task) {
      sendResponse(task.snapshot);
      return;
    }
    const created: Task = { snapshot: { state: "building" }, controller: new AbortController() };
    tasks.set(request.jobId, created);
    queue.push({ jobId: request.jobId, files: request.files as ArchiveFile[], task: created });
    sendResponse(created.snapshot);
    void drain();
  }
});
