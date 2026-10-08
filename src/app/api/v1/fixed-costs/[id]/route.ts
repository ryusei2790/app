/**
 * @file api/v1/fixed-costs/[id]/route.ts
 * @description 固定費更新（PUT）・削除（DELETE）エンドポイント。
 * PUT は金額変更・有効/無効切替に使う。カテゴリの付け替え先は自分のもの（または共通）だけ（S3）。
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 */

import { isUuid, withUserDb } from "@/lib/db";
import { checkRefs, normalizeCategoryId } from "@/lib/ownership";
import { ok, error, requireAuth, readJsonBody, serializeFixedCost } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = () => error("NOT_FOUND", "固定費が見つかりません", 404);

/** PUT /api/v1/fixed-costs/:id — 固定費更新 */
export async function PUT(request: Request, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.amount !== undefined) {
    if (typeof body.amount !== "number" || body.amount <= 0) {
      return error("VALIDATION_ERROR", "amount は正の数値を指定してください", 422);
    }
    updateData.amount = body.amount;
  }
  if (body.billing_day !== undefined) {
    const day = body.billing_day;
    if (typeof day !== "number" || day < 1 || day > 31) {
      return error("VALIDATION_ERROR", "billing_day は 1〜31 で指定してください", 422);
    }
    updateData.billingDay = day;
  }
  if (body.is_active !== undefined) updateData.isActive = body.is_active;
  const categoryId = body.category_id !== undefined ? normalizeCategoryId(body.category_id) : undefined;
  if (categoryId !== undefined) updateData.categoryId = categoryId;

  return withUserDb(user.id, async (db) => {
    const fixedCost = await db.fixedCost.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!fixedCost) return NOT_FOUND();

    const refs = await checkRefs(db, user.id, { categoryId });
    if (!refs.ok) return error("NOT_FOUND", refs.message, 404);

    const updated = await db.fixedCost.update({
      where: { id, userId: user.id },
      data: updateData,
      include: {
        category: { select: { id: true, name: true, color: true } },
        account: { select: { id: true, name: true, type: true } },
      },
    });
    return ok(serializeFixedCost(updated));
  });
}

/** DELETE /api/v1/fixed-costs/:id — 固定費削除 */
export async function DELETE(_request: Request, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  return withUserDb(user.id, async (db) => {
    const fixedCost = await db.fixedCost.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!fixedCost) return NOT_FOUND();

    await db.fixedCost.delete({ where: { id, userId: user.id } });
    return ok({ id });
  });
}
