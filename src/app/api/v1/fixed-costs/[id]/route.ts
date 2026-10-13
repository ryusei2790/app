/**
 * @file api/v1/fixed-costs/[id]/route.ts
 * @description 定期支出・定期収入の更新（PUT）・削除（DELETE）エンドポイント（テスト一覧 C）。
 * - 更新は「以降の回」にだけ効く。作成済みの取引は書き換えない（R8。展開済みの印より前は展開しないため）
 * - 一時停止→再開では、止めていた間の分を作らないよう展開済みの印を「昨日」まで進める（R7）
 * - 削除しても作成済みの取引は残る（DB の外部キーが ON DELETE SET NULL）
 * 口座・カテゴリの付け替え先は自分のもの（カテゴリは共通も可）だけ（S3）。
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 */

import { isUuid, withUserDb } from "@/lib/db";
import { checkRefs, normalizeCategoryId } from "@/lib/ownership";
import { checkRule, parseFixedCostInput } from "@/lib/validation/fixed-cost";
import { dateOnlyToDb, dbToDateOnly, todayJst } from "@/lib/date/jst";
import { addDays, type Cycle } from "@/lib/fixed-costs/schedule";
import { ok, error, requireAuth, readJsonBody, serializeFixedCost } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = () => error("NOT_FOUND", "固定費が見つかりません", 404);

/** PUT /api/v1/fixed-costs/:id — 更新 */
export async function PUT(request: Request, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  const today = todayJst();
  const patch = parseFixedCostInput(body, "update", today);
  if (!patch.ok) return error("VALIDATION_ERROR", patch.message, 422);
  const categoryId = body.category_id !== undefined ? normalizeCategoryId(body.category_id) : undefined;
  const accountId = body.account_id !== undefined ? body.account_id : undefined;

  return withUserDb(user.id, async (db) => {
    const current = await db.fixedCost.findFirst({ where: { id, userId: user.id } });
    if (!current) return NOT_FOUND();

    // 1. 既存の値に送られた項目を重ね、周期との組み合わせを確かめる（例: 毎年に変えるなら支払月が要る）
    const merged = checkRule({
      name: current.name,
      amount: Number(current.amount),
      type: current.type as "income" | "expense",
      cycle: current.cycle as Cycle,
      billingDay: current.billingDay,
      billingMonth: current.billingMonth,
      startDate: dbToDateOnly(current.startDate),
      endDate: current.endDate ? dbToDateOnly(current.endDate) : null,
      isActive: current.isActive,
      ...patch.value,
    });
    if (!merged.ok) return error("VALIDATION_ERROR", merged.message, 422);
    const f = merged.value;

    const refs = await checkRefs(db, user.id, { accountId, categoryId });
    if (!refs.ok) return error("NOT_FOUND", refs.message, 404);

    // 2. 再開（止めていた→有効）なら、止めていた間の分は作らない
    let generatedThrough = current.generatedThrough;
    if (!current.isActive && f.isActive) {
      const yesterday = dateOnlyToDb(addDays(today, -1));
      if (!generatedThrough || generatedThrough < yesterday) generatedThrough = yesterday;
    }

    const updated = await db.fixedCost.update({
      where: { id, userId: user.id },
      data: {
        name: f.name,
        amount: f.amount,
        type: f.type,
        cycle: f.cycle,
        billingDay: f.billingDay,
        billingMonth: f.billingMonth,
        startDate: dateOnlyToDb(f.startDate),
        endDate: f.endDate ? dateOnlyToDb(f.endDate) : null,
        isActive: f.isActive,
        generatedThrough,
        ...(accountId !== undefined ? { accountId: accountId as string } : {}),
        ...(categoryId !== undefined ? { categoryId: categoryId as string | null } : {}),
      },
      include: {
        category: { select: { id: true, name: true, color: true } },
        account: { select: { id: true, name: true, type: true } },
      },
    });
    return ok(serializeFixedCost(updated));
  });
}

/** DELETE /api/v1/fixed-costs/:id — 削除（作成済みの取引は残る） */
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
