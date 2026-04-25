/**
 * @file api/v1/categories/route.ts
 * @description カテゴリ一覧取得（GET）・カスタムカテゴリ作成（POST）エンドポイント。
 * - GET: システム共通（user_id=NULL）＋自分のカテゴリを返す
 * - POST: ユーザー独自カテゴリを作成する（is_default=false）
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, error, requireAuth, serializeCategory } from "@/lib/api-helpers";
import type { CreateCategoryRequest } from "@/types/api";

/** GET /api/v1/categories — カテゴリ一覧 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type"); // "income" | "expense" | null

  const categories = await prisma.category.findMany({
    where: {
      // 共通カテゴリ OR 自分のカテゴリ
      OR: [{ userId: null }, { userId: user.id }],
      ...(type ? { type } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return ok(categories.map(serializeCategory), { total: categories.length });
}

/** POST /api/v1/categories — カスタムカテゴリ作成 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  let body: CreateCategoryRequest;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "リクエストボディが不正です", 422);
  }

  if (!body.name || !body.type) {
    return error("VALIDATION_ERROR", "name と type は必須です", 422);
  }
  if (!["income", "expense"].includes(body.type)) {
    return error("VALIDATION_ERROR", "type は income または expense です", 422);
  }

  const category = await prisma.category.create({
    data: {
      userId: user.id,
      name: body.name,
      type: body.type,
      color: body.color ?? null,
      icon: body.icon ?? null,
      isDefault: false,
    },
  });

  return created(serializeCategory(category));
}
