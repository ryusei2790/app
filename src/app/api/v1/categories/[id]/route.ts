/**
 * @file api/v1/categories/[id]/route.ts
 * @description カテゴリ更新（PUT）・削除（DELETE）エンドポイント。
 * - デフォルトカテゴリ（is_default=true）は更新・削除不可
 * - 削除時に transactions が紐付いている場合は 409 Conflict
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, error, requireAuth, serializeCategory } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

/** PUT /api/v1/categories/:id — カテゴリ更新 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;

  const category = await prisma.category.findFirst({
    where: { id, userId: user.id },
  });
  if (!category) {
    return error("NOT_FOUND", "カテゴリが見つかりません", 404);
  }
  // デフォルトカテゴリは変更不可
  if (category.isDefault) {
    return error("FORBIDDEN", "デフォルトカテゴリは変更できません", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "リクエストボディが不正です", 422);
  }

  const updateData: Record<string, unknown> = {};
  if (body.name) updateData.name = body.name;
  if (body.color !== undefined) updateData.color = body.color;
  if (body.icon !== undefined) updateData.icon = body.icon;

  const updated = await prisma.category.update({ where: { id }, data: updateData });
  return ok(serializeCategory(updated));
}

/** DELETE /api/v1/categories/:id — カテゴリ削除 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;

  const category = await prisma.category.findFirst({
    where: { id, userId: user.id },
  });
  if (!category) {
    return error("NOT_FOUND", "カテゴリが見つかりません", 404);
  }
  if (category.isDefault) {
    return error("FORBIDDEN", "デフォルトカテゴリは削除できません", 403);
  }

  // 使用中の transactions がある場合は削除不可
  const usageCount = await prisma.transaction.count({
    where: { categoryId: id, deletedAt: null },
  });
  if (usageCount > 0) {
    return error(
      "CONFLICT",
      `このカテゴリは ${usageCount} 件の収支で使用中です。先に収支を変更してください。`,
      409
    );
  }

  await prisma.category.delete({ where: { id } });
  return ok({ id });
}
