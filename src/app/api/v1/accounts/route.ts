/**
 * @file api/v1/accounts/route.ts
 * @description 口座一覧取得（GET）・口座作成（POST）エンドポイント。
 * DB には withUserDb（RLS が効く）経由でだけ触る。user_id は必ずログイン中のユーザー。
 */

import { withUserDb } from "@/lib/db";
import { ok, created, error, requireAuth, readJsonBody, serializeAccount } from "@/lib/api-helpers";

/** GET /api/v1/accounts — 口座一覧 */
export async function GET() {
  const { user, response } = await requireAuth();
  if (response) return response;

  const accounts = await withUserDb(user.id, (db) =>
    db.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } })
  );

  return ok(accounts.map(serializeAccount), { total: accounts.length });
}

/** POST /api/v1/accounts — 口座作成 */
export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  if (!body.name || !body.type) {
    return error("VALIDATION_ERROR", "name と type は必須です", 422);
  }
  if (!["cash", "credit_card", "bank"].includes(body.type as string)) {
    return error(
      "VALIDATION_ERROR",
      "type は cash / credit_card / bank のいずれかです",
      422
    );
  }

  const account = await withUserDb(user.id, (db) =>
    db.account.create({
      data: {
        userId: user.id,
        name: String(body.name),
        type: String(body.type),
        currency: typeof body.currency === "string" ? body.currency : "JPY",
      },
    })
  );

  return created(serializeAccount(account));
}
