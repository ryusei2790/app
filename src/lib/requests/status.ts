/**
 * @file lib/requests/status.ts
 * @description 要望の状態と文の形（mywork#573 第2弾）。画面からも読むので DB に触るものは置かない（DB は ./store.ts）。
 */

export const REQUEST_TEXT_MAX = 300;
export const REQUEST_STATUSES = ["received", "in_progress", "done", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const STATUS_LABELS: Record<RequestStatus, string> = {
  received: "受付",
  in_progress: "対応中",
  done: "完了",
  declined: "見送り",
};

export interface FeatureRequestRow {
  id: string;
  text: string;
  status: RequestStatus;
  createdAt: string;
}

/** 要望文の形をそろえる（空・長すぎは null） */
export function cleanRequestText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= REQUEST_TEXT_MAX ? t : null;
}

export function isRequestStatus(v: unknown): v is RequestStatus {
  return typeof v === "string" && (REQUEST_STATUSES as readonly string[]).includes(v);
}
