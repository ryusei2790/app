/**
 * @file api/v1/fixed-costs/route.ts
 * @description 固定費一覧取得（GET）・固定費登録（POST）エンドポイント。
 * DB には withUserDb（RLS が効く）経由でだけ触る。口座・カテゴリは自分のものだけ使える（S3）。
 */

import { withUserDb } from "@/lib/db";
import { checkRefs, normalizeCategoryId } from "@/lib/ownership";
import { parseYenAmount } from "@/lib/validation/transaction";
import { ok, created, error, requireAuth, readJsonBody, serializeFixedCost } from "@/lib/api-helpers";

const INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  account: { select: { id: true, name: true, type: true } },
} as const;

/** GET /api/v1/fixed-costs — 固定費一覧 */
export async function GET() {
  const { user, response } = await requireAuth();
  if (response) return response;

  const fixedCosts = await withUserDb(user.id, (db) =>
    db.fixedCost.findMany({
      where: { userId: user.id },
      include: INCLUDE,
      orderBy: { billingDay: "asc" },
    })
  );

  return ok(fixedCosts.map(serializeFixedCost), { total: fixedCosts.length });
}

/** POST /api/v1/fixed-costs — 固定費登録 */
export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  const { account_id, name, billing_day } = body;
  if (!account_id || !name || body.amount === undefined || !billing_day) {
    return error(
      "VALIDATION_ERROR",
      "account_id, name, amount, billing_day は必須です",
      422
    );
  }
  if (typeof billing_day !== "number" || billing_day < 1 || billing_day > 31) {
    return error("VALIDATION_ERROR", "billing_day は 1〜31 で指定してください", 422);
  }
  const amount = parseYenAmount(body.amount);
  if (!amount.ok) return error("VALIDATION_ERROR", amount.message, 422);
  const categoryId = normalizeCategoryId(body.category_id) ?? null;

  return withUserDb(user.id, async (db) => {
    // 口座・カテゴリの所有確認
    const refs = await checkRefs(db, user.id, { accountId: account_id, categoryId });
    if (!refs.ok) return error("NOT_FOUND", refs.message, 404);

    const fixedCost = await db.fixedCost.create({
      data: {
        userId: user.id,
        accountId: account_id as string,
        categoryId: categoryId as string | null,
        name: String(name),
        amount: amount.value,
        billingDay: billing_day,
        isActive: typeof body.is_active === "boolean" ? body.is_active : true,
      },
      include: INCLUDE,
    });
    return created(serializeFixedCost(fixedCost));
  });
}
