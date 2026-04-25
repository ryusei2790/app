/**
 * @file api/v1/transactions/[id]/route.ts
 * @description 収支の詳細取得（GET）・更新（PUT）・削除（DELETE）エンドポイント。
 * - DELETE: source='auto' の場合は論理削除、それ以外は物理削除
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, error, requireAuth, serializeTransaction } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/transactions/:id — 収支詳細 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;

  const transaction = await prisma.transaction.findFirst({
    where: { id, userId: user.id, deletedAt: null },
    include: {
      category: { select: { id: true, name: true, color: true, icon: true } },
      account: { select: { id: true, name: true, type: true } },
    },
  });

  if (!transaction) {
    return error("NOT_FOUND", "収支が見つかりません", 404);
  }

  return ok(serializeTransaction(transaction));
}

/** PUT /api/v1/transactions/:id — 収支更新 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;

  const transaction = await prisma.transaction.findFirst({
    where: { id, userId: user.id, deletedAt: null },
  });
  if (!transaction) {
    return error("NOT_FOUND", "収支が見つかりません", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "リクエストボディが不正です", 422);
  }

  // 更新可能なフィールドのみ抽出（source の変更は不可）
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
  if (body.category_id !== undefined) updateData.categoryId = body.category_id;
  if (body.account_id !== undefined) updateData.accountId = body.account_id;
  if (body.note !== undefined) updateData.note = body.note;

  const updated = await prisma.transaction.update({
    where: { id },
    data: updateData,
    include: {
      category: { select: { id: true, name: true, color: true, icon: true } },
      account: { select: { id: true, name: true, type: true } },
    },
  });

  return ok(serializeTransaction(updated));
}

/** DELETE /api/v1/transactions/:id — 収支削除 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;

  const transaction = await prisma.transaction.findFirst({
    where: { id, userId: user.id, deletedAt: null },
  });
  if (!transaction) {
    return error("NOT_FOUND", "収支が見つかりません", 404);
  }

  if (transaction.source === "auto") {
    // 固定費由来のレコードは論理削除（deleted_at をセット）
    await prisma.transaction.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  } else {
    // 手動・CSV由来は物理削除
    await prisma.transaction.delete({ where: { id } });
  }

  return ok({ id });
}
