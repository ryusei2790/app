/**
 * @file api/v1/transactions/[id]/route.ts
 * @description 収支の詳細取得（GET）・更新（PUT）・削除（DELETE）エンドポイント。
 * - PUT: 口座・カテゴリを付け替えるときは、付け替え先が自分のものかを確かめる（S3）
 * - DELETE: source='auto' の場合は論理削除、それ以外は物理削除
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 */

import { NextRequest } from "next/server";
import { isUuid, withUserDb } from "@/lib/db";
import { checkRefs, normalizeCategoryId } from "@/lib/ownership";
import { ok, error, requireAuth, readJsonBody, serializeTransaction } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = () => error("NOT_FOUND", "収支が見つかりません", 404);
const INCLUDE = {
  category: { select: { id: true, name: true, color: true, icon: true } },
  account: { select: { id: true, name: true, type: true } },
} as const;

/** GET /api/v1/transactions/:id — 収支詳細 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  const transaction = await withUserDb(user.id, (db) =>
    db.transaction.findFirst({ where: { id, userId: user.id, deletedAt: null }, include: INCLUDE })
  );
  if (!transaction) return NOT_FOUND();

  return ok(serializeTransaction(transaction));
}

/** PUT /api/v1/transactions/:id — 収支更新 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  // 更新可能なフィールドのみ抽出（source・user_id の変更は不可）
  const updateData: Record<string, unknown> = {};
  if (body.amount !== undefined) {
    if (typeof body.amount !== "number" || body.amount <= 0) {
      return error("VALIDATION_ERROR", "amount は正の数値を指定してください", 422);
    }
    updateData.amount = body.amount;
  }
  if (body.type !== undefined) {
    if (!["income", "expense"].includes(body.type as string)) {
      return error("VALIDATION_ERROR", "type は income または expense です", 422);
    }
    updateData.type = body.type;
  }
  if (body.transaction_date !== undefined) {
    updateData.transactionDate = new Date(body.transaction_date as string);
  }
  const categoryId = body.category_id !== undefined ? normalizeCategoryId(body.category_id) : undefined;
  if (categoryId !== undefined) updateData.categoryId = categoryId;
  if (body.account_id !== undefined) updateData.accountId = body.account_id;
  if (body.note !== undefined) updateData.note = body.note;

  return withUserDb(user.id, async (db) => {
    const transaction = await db.transaction.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!transaction) return NOT_FOUND();

    // 付け替え先の口座・カテゴリが自分のものか（S3）
    const refs = await checkRefs(db, user.id, { accountId: body.account_id, categoryId });
    if (!refs.ok) return error("NOT_FOUND", refs.message, 404);

    const updated = await db.transaction.update({
      where: { id, userId: user.id },
      data: updateData,
      include: INCLUDE,
    });
    return ok(serializeTransaction(updated));
  });
}

/** DELETE /api/v1/transactions/:id — 収支削除 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  return withUserDb(user.id, async (db) => {
    const transaction = await db.transaction.findFirst({
      where: { id, userId: user.id, deletedAt: null },
    });
    if (!transaction) return NOT_FOUND();

    if (transaction.source === "auto") {
      // 固定費由来のレコードは論理削除（deleted_at をセット）。消すと次の自動生成で復活するため
      await db.transaction.update({ where: { id, userId: user.id }, data: { deletedAt: new Date() } });
    } else {
      // 手動・CSV由来は物理削除
      await db.transaction.delete({ where: { id, userId: user.id } });
    }
    return ok({ id });
  });
}
