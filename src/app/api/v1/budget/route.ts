/**
 * @file api/v1/budget/route.ts
 * @description 予算台帳（社長専用機能）の入口 API（S6）。
 * 中身（予算フレーム・経理部への書き出し）は 9/22 の予算台帳計画の順で後から作る。
 * いまは「社長だけが通れる」ことを固定するための入口だけを置く。
 * 未ログイン 401 / 一般ユーザー 403 / 社長（OWNER_USER_IDS）200。
 */

import { ok, requireOwner } from "@/lib/api-helpers";

/** GET /api/v1/budget — 予算台帳の状態 */
export async function GET() {
  const { response } = await requireOwner();
  if (response) return response;

  return ok({ enabled: true, status: "preparing" });
}
