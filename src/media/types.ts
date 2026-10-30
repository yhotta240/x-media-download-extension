export type MediaItem = {
  kind: "photo" | "video";
  url: string | null;
  ext: string;
  error?: string;
};

export type PostIdentity = { postId: string; username: string };

export type MediaPost = PostIdentity & {
  media: MediaItem[];
  quotedPostId?: string;
};

export type JobState = "processing" | "success" | "error";

export type JobStatus = {
  postId: string;
  jobId: string;
  state: JobState;
  error?: string;
};

export const BRIDGE_CHANNEL = "x-media-download:v1";
export const START_DOWNLOAD = "xmd:start";
export const GET_DOWNLOAD = "xmd:status";
export const DOWNLOAD_STATUS = "xmd:update";

export type DownloadReply = { ok: true; status: JobStatus } | { ok: false; error: string };
