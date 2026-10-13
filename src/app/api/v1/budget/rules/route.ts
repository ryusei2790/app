/**
 * @file api/v1/budget/rules/route.ts
 * @description 予算の対応表（カテゴリー／メモの語句 → 費目）の一覧・追加（社長のみ: S12）。
 * GET  /api/v1/budget/rules … 対応表・費目・使えるカテゴリー（画面の対応表の編集に使う）
 * POST /api/v1/budget/rules … { category_id?, memo_keyword?, frame_id (null=枠の外), priority? }
 *   カテゴリーか語句のどちらかは必須。カテゴリーは自分か共通のもの、費目は自分のもの（違えば 404: S9）
 * 振り分けは集計のたびに決めるので、ここを変えると過去の月の集計も変わる（M7）。
 */

import { created, error, ok, readJsonBody, requireOwner } from "@/lib/api-helpers";
import { withUserDb } from "@/lib/db";
import { checkCategory } from "@/lib/ownership";
import { ensureBudgetDefaults, loadFrames, loadRules, serializeFrame, serializeRule } from "@/lib/budget/store";
import { parseRuleFields } from "@/lib/budget/rule-input";

/** GET /api/v1/budget/rules */
export async function GET() {
  const { user, response } = await requireOwner();
  if (response) return response;

  const data = await withUserDb(user.id, async (db) => {
    await ensureBudgetDefaults(db, user.id);
    const [rules, frames, categories] = await Promise.all([
      loadRules(db, user.id),
      loadFrames(db, user.id),
      db.category.findMany({
        where: { OR: [{ userId: user.id }, { userId: null }], type: "expense" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return { rules, frames, categories };
  });
  return ok({
    rules: data.rules.map(serializeRule),
    frames: data.frames.map(serializeFrame),
    categories: data.categories,
  });
}

/** POST /api/v1/budget/rules */
export async function POST(request: Request) {
  const { user, response } = await requireOwner();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;

  const parsed = parseRuleFields(body, { requireFrame: true });
  if (!parsed.ok) return error("VALIDATION_ERROR", parsed.message, 422);
  const f = parsed.value;
  if (!f.categoryId && !f.memoKeyword) {
    return error("VALIDATION_ERROR", "category_id か memo_keyword のどちらかは必須です", 422);
  }

  return withUserDb(user.id, async (db) => {
    // 参照先が自分のものか（RLS の WITH CHECK でも止まるが、500 ではなく 404 を返す）
    if (f.categoryId) {
      const c = await checkCategory(db, user.id, f.categoryId);
      if (!c.ok) return error("NOT_FOUND", c.message, 404);
    }
    if (f.frameId && !(await db.budgetFrame.findFirst({ where: { id: f.frameId, userId: user.id }, select: { id: true } }))) {
      return error("NOT_FOUND", "指定された費目が見つかりません", 404);
    }
    // priority 省略時は最後に足す
    const last = await db.budgetRule.aggregate({ where: { userId: user.id }, _max: { priority: true } });
    const rule = await db.budgetRule.create({
      data: {
        userId: user.id,
        categoryId: f.categoryId ?? null,
        memoKeyword: f.memoKeyword ?? null,
        frameId: f.frameId ?? null,
        priority: f.priority ?? (last._max.priority ?? 0) + 1,
      },
      select: { id: true },
    });
    const rules = await loadRules(db, user.id);
    return created(serializeRule(rules.find((r) => r.id === rule.id)!));
  });
}
