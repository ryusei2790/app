/**
 * @file api/v1/fixed-costs/route.ts
 * @description 定期支出・定期収入の一覧取得（GET）・登録（POST）エンドポイント（テスト一覧 C）。
 * DB には withUserDb（RLS が効く）経由でだけ触る。口座・カテゴリは自分のものだけ使える（S3）。
 * 件数の上限は設けない（R1）。周期は毎週・隔週・毎月・毎年、種別は支出・収入（R2・R4）。
 */

import { withUserDb } from "@/lib/db";
import { checkRefs, normalizeCategoryId } from "@/lib/ownership";
import { parseFixedCostInput, type FixedCostFields } from "@/lib/validation/fixed-cost";
import { dateOnlyToDb, todayJst } from "@/lib/date/jst";
import { monthlyEquivalent, type Cycle } from "@/lib/fixed-costs/schedule";
import { nextDueDate } from "@/lib/fixed-costs/expand";
import { ok, created, error, requireAuth, readJsonBody, serializeFixedCost } from "@/lib/api-helpers";

const INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  account: { select: { id: true, name: true, type: true } },
} as const;

/**
 * GET /api/v1/fixed-costs — 一覧（R9）
 * 次回の支払日（next_date）の昇順。止めている・終わったものは next_date=null で最後。
 * meta に月あたりの支出合計・収入合計（有効なものだけ。毎年は ÷12、毎週は ×52÷12）。
 */
export async function GET() {
  const { user, response } = await requireAuth();
  if (response) return response;

  const fixedCosts = await withUserDb(user.id, (db) =>
    db.fixedCost.findMany({ where: { userId: user.id }, include: INCLUDE, orderBy: { createdAt: "asc" } })
  );

  const today = todayJst();
  const items = fixedCosts.map((fc) => ({ ...serializeFixedCost(fc), next_date: nextDueDate(fc, today) }));
  // next_date の昇順・null は最後。同じ日なら登録順（findMany の並びを保つ安定ソート）
  items.sort((a, b) => {
    if (a.next_date === b.next_date) return 0;
    if (a.next_date === null) return 1;
    if (b.next_date === null) return -1;
    return a.next_date < b.next_date ? -1 : 1;
  });

  let monthlyExpense = 0;
  let monthlyIncome = 0;
  for (const fc of fixedCosts) {
    if (!fc.isActive) continue;
    const m = monthlyEquivalent(Number(fc.amount), fc.cycle as Cycle);
    if (fc.type === "income") monthlyIncome += m;
    else monthlyExpense += m;
  }

  return ok(items, {
    total: items.length,
    monthly_expense_total: monthlyExpense,
    monthly_income_total: monthlyIncome,
  });
}

/** POST /api/v1/fixed-costs — 登録 */
export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  if (!body.account_id) return error("VALIDATION_ERROR", "account_id は必須です", 422);
  const input = parseFixedCostInput(body, "create", todayJst());
  if (!input.ok) return error("VALIDATION_ERROR", input.message, 422);
  const f = input.value as FixedCostFields;
  const categoryId = normalizeCategoryId(body.category_id) ?? null;

  return withUserDb(user.id, async (db) => {
    // 口座・カテゴリの所有確認
    const refs = await checkRefs(db, user.id, { accountId: body.account_id, categoryId });
    if (!refs.ok) return error("NOT_FOUND", refs.message, 404);

    const fixedCost = await db.fixedCost.create({
      data: {
        userId: user.id,
        accountId: body.account_id as string,
        categoryId: categoryId as string | null,
        name: f.name,
        amount: f.amount,
        type: f.type,
        cycle: f.cycle,
        billingDay: f.billingDay,
        billingMonth: f.billingMonth,
        startDate: dateOnlyToDb(f.startDate),
        endDate: f.endDate ? dateOnlyToDb(f.endDate) : null,
        isActive: f.isActive,
      },
      include: INCLUDE,
    });
    return created(serializeFixedCost(fixedCost));
  });
}
