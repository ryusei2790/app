/**
 * @file api/v1/accounts/[id]/route.ts
 * @description 口座更新（PUT）・削除（DELETE）エンドポイント。
 * - 削除時に transactions が紐付いている場合は 409 Conflict
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 */

import { isUuid, withUserDb } from "@/lib/db";
import { ok, error, requireAuth, readJsonBody, serializeAccount } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = () => error("NOT_FOUND", "口座が見つかりません", 404);

/** PUT /api/v1/accounts/:id — 口座更新 */
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
  if (body.currency) updateData.currency = body.currency;

  return withUserDb(user.id, async (db) => {
    const account = await db.account.findFirst({ where: { id, userId: user.id } });
    if (!account) return NOT_FOUND();

    const updated = await db.account.update({ where: { id, userId: user.id }, data: updateData });
    return ok(serializeAccount(updated));
  });
}

/** DELETE /api/v1/accounts/:id — 口座削除 */
export async function DELETE(_request: Request, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  return withUserDb(user.id, async (db) => {
    const account = await db.account.findFirst({ where: { id, userId: user.id } });
    if (!account) return NOT_FOUND();

    // 関連する transactions がある場合は削除不可
    const usageCount = await db.transaction.count({
      where: { accountId: id, userId: user.id, deletedAt: null },
    });
    if (usageCount > 0) {
      return error(
        "CONFLICT",
        `この口座は ${usageCount} 件の収支で使用中です。先に収支を変更してください。`,
        409
      );
    }

    await db.account.delete({ where: { id, userId: user.id } });
    return ok({ id });
  });
}
