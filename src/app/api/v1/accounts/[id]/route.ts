/**
 * @file api/v1/accounts/[id]/route.ts
 * @description 口座更新（PUT）・削除（DELETE）エンドポイント。
 * - 削除時に transactions が紐付いている場合は 409 Conflict
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, error, requireAuth, serializeAccount } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

/** PUT /api/v1/accounts/:id — 口座更新 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;

  const account = await prisma.account.findFirst({
    where: { id, userId: user.id },
  });
  if (!account) {
    return error("NOT_FOUND", "口座が見つかりません", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "リクエストボディが不正です", 422);
  }

  const updateData: Record<string, unknown> = {};
  if (body.name) updateData.name = body.name;
  if (body.currency) updateData.currency = body.currency;

  const updated = await prisma.account.update({ where: { id }, data: updateData });
  return ok(serializeAccount(updated));
}

/** DELETE /api/v1/accounts/:id — 口座削除 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;

  const account = await prisma.account.findFirst({
    where: { id, userId: user.id },
  });
  if (!account) {
    return error("NOT_FOUND", "口座が見つかりません", 404);
  }

  // 関連する transactions がある場合は削除不可
  const usageCount = await prisma.transaction.count({
    where: { accountId: id, deletedAt: null },
  });
  if (usageCount > 0) {
    return error(
      "CONFLICT",
      `この口座は ${usageCount} 件の収支で使用中です。先に収支を変更してください。`,
      409
    );
  }

  await prisma.account.delete({ where: { id } });
  return ok({ id });
}
