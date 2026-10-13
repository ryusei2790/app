/**
 * @file api/v1/budget/rules/[id]/route.ts
 * @description 対応表の1行を変更（PUT）・削除（DELETE）する（社長のみ: S12）。
 * PUT body: { frame_id?, memo_keyword?, category_id?, priority? }（指定した項目だけ変える）
 * 自分の対応表でない・指す費目やカテゴリーが自分のものでない → 404（S9）。
 * 変更後もカテゴリーか語句のどちらかは残っていること（両方なしは全取引に当たってしまう）。
 */

import { error, ok, readJsonBody, requireOwner } from "@/lib/api-helpers";
import { isUuid, withUserDb } from "@/lib/db";
import { checkCategory } from "@/lib/ownership";
import { loadRules, serializeRule } from "@/lib/budget/store";
import { parseRuleFields } from "@/lib/budget/rule-input";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = () => error("NOT_FOUND", "対応表の行が見つかりません", 404);

/** PUT /api/v1/budget/rules/:id */
export async function PUT(request: Request, { params }: Params) {
  const { user, response } = await requireOwner();
  if (response) return response;
  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;

  const parsed = parseRuleFields(body, { requireFrame: false });
  if (!parsed.ok) return error("VALIDATION_ERROR", parsed.message, 422);
  const f = parsed.value;

  return withUserDb(user.id, async (db) => {
    const rule = await db.budgetRule.findFirst({ where: { id, userId: user.id } });
    if (!rule) return NOT_FOUND();

    if (f.categoryId) {
      const c = await checkCategory(db, user.id, f.categoryId);
      if (!c.ok) return error("NOT_FOUND", c.message, 404);
    }
    if (f.frameId && !(await db.budgetFrame.findFirst({ where: { id: f.frameId, userId: user.id }, select: { id: true } }))) {
      return error("NOT_FOUND", "指定された費目が見つかりません", 404);
    }
    const nextCategory = f.categoryId !== undefined ? f.categoryId : rule.categoryId;
    const nextKeyword = f.memoKeyword !== undefined ? f.memoKeyword : rule.memoKeyword;
    if (!nextCategory && !nextKeyword) {
      return error("VALIDATION_ERROR", "カテゴリーか語句のどちらかは必要です", 422);
    }

    await db.budgetRule.update({
      where: { id },
      data: {
        ...(f.categoryId !== undefined ? { categoryId: f.categoryId } : {}),
        ...(f.memoKeyword !== undefined ? { memoKeyword: f.memoKeyword } : {}),
        ...(f.frameId !== undefined ? { frameId: f.frameId } : {}),
        ...(f.priority !== undefined ? { priority: f.priority } : {}),
      },
    });
    const rules = await loadRules(db, user.id);
    return ok(serializeRule(rules.find((r) => r.id === id)!));
  });
}

/** DELETE /api/v1/budget/rules/:id */
export async function DELETE(_request: Request, { params }: Params) {
  const { user, response } = await requireOwner();
  if (response) return response;
  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  return withUserDb(user.id, async (db) => {
    const res = await db.budgetRule.deleteMany({ where: { id, userId: user.id } });
    if (res.count === 0) return NOT_FOUND();
    return ok({ id });
  });
}
