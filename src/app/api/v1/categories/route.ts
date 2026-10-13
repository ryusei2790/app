/**
 * @file api/v1/categories/route.ts
 * @description カテゴリ一覧取得（GET）・カスタムカテゴリ作成（POST）エンドポイント。
 * - GET: システム共通（user_id=NULL）＋自分のカテゴリを返す
 * - POST: ユーザー独自カテゴリを作成する（is_default=false）
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 */

import { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { ok, created, error, requireAuth, readJsonBody, serializeCategory } from "@/lib/api-helpers";

/** GET /api/v1/categories — カテゴリ一覧 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type"); // "income" | "expense" | null

  const categories = await withUserDb(user.id, (db) =>
    db.category.findMany({
      where: {
        // 共通カテゴリ OR 自分のカテゴリ
        OR: [{ userId: null }, { userId: user.id }],
        ...(type ? { type } : {}),
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    })
  );

  return ok(categories.map(serializeCategory), { total: categories.length });
}

/** POST /api/v1/categories — カスタムカテゴリ作成 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  if (!body.name || !body.type) {
    return error("VALIDATION_ERROR", "name と type は必須です", 422);
  }
  if (!["income", "expense"].includes(body.type as string)) {
    return error("VALIDATION_ERROR", "type は income または expense です", 422);
  }

  const category = await withUserDb(user.id, (db) =>
    db.category.create({
      data: {
        userId: user.id,
        name: String(body.name),
        type: String(body.type),
        color: typeof body.color === "string" ? body.color : null,
        icon: typeof body.icon === "string" ? body.icon : null,
        isDefault: false,
      },
    })
  );

  return created(serializeCategory(category));
}
