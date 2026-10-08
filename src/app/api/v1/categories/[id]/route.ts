/**
 * @file api/v1/categories/[id]/route.ts
 * @description カテゴリ更新（PUT）・削除（DELETE）エンドポイント。
 * - デフォルトカテゴリ（is_default=true）は更新・削除不可
 * - 削除時に transactions が紐付いている場合は 409 Conflict
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

    // 使用中の transactions がある場合は削除不可
    const usageCount = await db.transaction.count({
      where: { categoryId: id, userId: user.id, deletedAt: null },
    });
    if (usageCount > 0) {
      return error(
        "CONFLICT",
        `このカテゴリは ${usageCount} 件の収支で使用中です。先に収支を変更してください。`,
        409
      );
    }

    await db.category.delete({ where: { id, userId: user.id } });
    return ok({ id });
  });
}
