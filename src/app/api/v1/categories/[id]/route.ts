/**
 * @file api/v1/categories/[id]/route.ts
 * @description カテゴリ更新（PUT）・削除（DELETE）エンドポイント。
 * - デフォルトカテゴリ（is_default=true）は更新・削除不可
 * - 削除時に取引（論理削除済みも含む）・固定費が紐付いている場合は 409 Conflict（T4）
 *   取引を孤児にしないため。DB の外部キーでも止まるが、500 ではなく理由の分かる 409 を返す
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 */

import { isUuid, withUserDb } from "@/lib/db";
import { ok, error, requireAuth, readJsonBody, serializeCategory } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = () => error("NOT_FOUND", "カテゴリが見つかりません", 404);

/** PUT /api/v1/categories/:id — カテゴリ更新 */
export async function PUT(request: Request, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  const updateData: Record<string, unknown> = {};
  if (body.name) updateData.name = body.name;
  if (body.color !== undefined) updateData.color = body.color;
  if (body.icon !== undefined) updateData.icon = body.icon;

  return withUserDb(user.id, async (db) => {
    const category = await db.category.findFirst({ where: { id, userId: user.id } });
    if (!category) return NOT_FOUND();
    // デフォルトカテゴリは変更不可
    if (category.isDefault) {
      return error("FORBIDDEN", "デフォルトカテゴリは変更できません", 403);
    }

    const updated = await db.category.update({ where: { id, userId: user.id }, data: updateData });
    return ok(serializeCategory(updated));
  });
}

/** DELETE /api/v1/categories/:id — カテゴリ削除 */
export async function DELETE(_request: Request, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  return withUserDb(user.id, async (db) => {
    const category = await db.category.findFirst({ where: { id, userId: user.id } });
    if (!category) return NOT_FOUND();
    if (category.isDefault) {
      return error("FORBIDDEN", "デフォルトカテゴリは削除できません", 403);
    }

    // 使っているものがあれば削除不可（論理削除済みの取引も行は残っているので数える）
    const [txCount, deletedTxCount, fixedCostCount] = await Promise.all([
      db.transaction.count({ where: { categoryId: id, userId: user.id, deletedAt: null } }),
      db.transaction.count({ where: { categoryId: id, userId: user.id, deletedAt: { not: null } } }),
      db.fixedCost.count({ where: { categoryId: id, userId: user.id } }),
    ]);
    if (txCount > 0) {
      return error(
        "CONFLICT",
        `このカテゴリは ${txCount} 件の収支で使用中です。先に収支を変更してください。`,
        409
      );
    }
    if (fixedCostCount > 0) {
      return error("CONFLICT", `このカテゴリは ${fixedCostCount} 件の固定費で使用中です。先に固定費を変更してください。`, 409);
    }
    if (deletedTxCount > 0) {
      return error("CONFLICT", "このカテゴリには削除済みの固定費の収支が残っているため削除できません。", 409);
    }

    await db.category.delete({ where: { id, userId: user.id } });
    return ok({ id });
  });
}
