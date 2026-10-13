/**
 * @file api/v1/budget/frames/route.ts
 * @description 予算の費目の枠（月の上限・目標）を直す API（社長のみ: S12）。
 * PUT /api/v1/budget/frames  body: { frames: [{ id, monthly_limit, target? }] }
 *   - 金額は 0 以上の整数円（文字列・小数・負は 422）
 *   - 自分の枠でない id は 404（RLS でも見えないので、更新件数 0 で判定する）
 *   - 全部か無しか（1件でもだめなら何も変えない）
 */

import { error, ok, readJsonBody, requireOwner } from "@/lib/api-helpers";
import { isUuid, withUserDb } from "@/lib/db";
import { loadFrames, serializeFrame } from "@/lib/budget/store";

const MAX_LIMIT = 100_000_000;

function isYen(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_LIMIT;
}

class NotFound extends Error {}

export async function PUT(request: Request) {
  const { user, response } = await requireOwner();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;

  // 1. 入力の形を先に全部確かめる（DB に触る前に）
  const list = body.frames;
  if (!Array.isArray(list) || list.length > 50) return error("VALIDATION_ERROR", "frames は配列で指定してください", 422);
  const updates: Array<{ id: string; monthlyLimit: number; target?: number | null }> = [];
  for (const f of list) {
    if (!f || typeof f !== "object") return error("VALIDATION_ERROR", "frames の要素が不正です", 422);
    const { id, monthly_limit, target } = f as Record<string, unknown>;
    if (!isUuid(id)) return error("VALIDATION_ERROR", "id が不正です", 422);
    if (!isYen(monthly_limit)) return error("VALIDATION_ERROR", "monthly_limit は 0 以上の整数円です", 422);
    if (target !== undefined && target !== null && !isYen(target)) {
      return error("VALIDATION_ERROR", "target は 0 以上の整数円か null です", 422);
    }
    updates.push({ id, monthlyLimit: monthly_limit, ...(target !== undefined ? { target: target as number | null } : {}) });
  }

  // 2. 1トランザクションで更新。自分の枠でなければ巻き戻して 404
  try {
    const frames = await withUserDb(user.id, async (db) => {
      for (const u of updates) {
        const res = await db.budgetFrame.updateMany({
          where: { id: u.id, userId: user.id },
          data: { monthlyLimit: u.monthlyLimit, ...(u.target !== undefined ? { target: u.target } : {}) },
        });
        if (res.count === 0) throw new NotFound();
      }
      return loadFrames(db, user.id);
    });
    return ok({ frames: frames.map(serializeFrame) });
  } catch (e) {
    if (e instanceof NotFound) return error("NOT_FOUND", "指定された枠が見つかりません", 404);
    return error("INTERNAL_ERROR", "保存に失敗しました", 500);
  }
}
