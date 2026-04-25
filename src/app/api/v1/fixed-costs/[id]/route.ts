/**
 * @file api/v1/fixed-costs/[id]/route.ts
 * @description 固定費更新（PUT）・削除（DELETE）エンドポイント。
 * PUT は金額変更・有効/無効切替に使う。
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, error, requireAuth, serializeFixedCost } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

/** PUT /api/v1/fixed-costs/:id — 固定費更新 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;

  const fixedCost = await prisma.fixedCost.findFirst({
    where: { id, userId: user.id },
  });
  if (!fixedCost) {
    return error("NOT_FOUND", "固定費が見つかりません", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "リクエストボディが不正です", 422);
  }

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.amount !== undefined) {
    if (typeof body.amount !== "number" || body.amount <= 0) {
      return error("VALIDATION_ERROR", "amount は正の数値を指定してください", 422);
    }
    updateData.amount = body.amount;
  }
  if (body.billing_day !== undefined) {
    const day = body.billing_day as number;
    if (day < 1 || day > 31) {
      return error("VALIDATION_ERROR", "billing_day は 1〜31 で指定してください", 422);
    }
    updateData.billingDay = day;
  }
  if (body.is_active !== undefined) updateData.isActive = body.is_active;
  if (body.category_id !== undefined) updateData.categoryId = body.category_id;

  const updated = await prisma.fixedCost.update({
    where: { id },
    data: updateData,
    include: {
      category: { select: { id: true, name: true, color: true } },
      account: { select: { id: true, name: true, type: true } },
    },
  });

  return ok(serializeFixedCost(updated));
}

/** DELETE /api/v1/fixed-costs/:id — 固定費削除 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;

  const fixedCost = await prisma.fixedCost.findFirst({
    where: { id, userId: user.id },
  });
  if (!fixedCost) {
    return error("NOT_FOUND", "固定費が見つかりません", 404);
  }

  await prisma.fixedCost.delete({ where: { id } });
  return ok({ id });
}
