/**
 * @file api/v1/accounts/[id]/route.ts
 * @description 口座更新（PUT）・削除（DELETE）エンドポイント。
 * - 削除時に取引（論理削除済みも含む）・固定費・CSV 取込履歴が紐付いている場合は 409 Conflict（T4）
 *   取引を孤児にしないため。DB の外部キーでも止まるが、500 ではなく理由の分かる 409 を返す
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

    // 使っているものがあれば削除不可（論理削除済みの取引も行は残っているので数える）
    const [txCount, deletedTxCount, fixedCostCount, importCount] = await Promise.all([
      db.transaction.count({ where: { accountId: id, userId: user.id, deletedAt: null } }),
      db.transaction.count({ where: { accountId: id, userId: user.id, deletedAt: { not: null } } }),
      db.fixedCost.count({ where: { accountId: id, userId: user.id } }),
      db.csvImport.count({ where: { accountId: id, userId: user.id } }),
    ]);
    if (txCount > 0) {
      return error(
        "CONFLICT",
        `この口座は ${txCount} 件の収支で使用中です。先に収支を変更してください。`,
        409
      );
    }
    if (fixedCostCount > 0) {
      return error("CONFLICT", `この口座は ${fixedCostCount} 件の固定費で使用中です。先に固定費を変更してください。`, 409);
    }
    if (deletedTxCount > 0 || importCount > 0) {
      return error("CONFLICT", "この口座には過去の記録（削除済みの固定費の収支・CSV 取込履歴）が残っているため削除できません。", 409);
    }

    await db.account.delete({ where: { id, userId: user.id } });
    return ok({ id });
  });
}
