/**
 * @file api/v1/fixed-costs/generate/route.ts
 * @description 固定費の月次自動生成エンドポイント。
 * ログイン時に呼び出し、指定年月の固定費が未生成の場合のみ transactions に挿入する。
 * 冪等性を保証する（何度呼んでも二重生成しない）。
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 * ※ 定期支出の作り直し（毎週・毎年・収入・開かない月の補完）はテスト一覧 C（R1〜R9）で行う。
 */

import { withUserDb } from "@/lib/db";
import { ok, error, requireAuth, readJsonBody } from "@/lib/api-helpers";

/** POST /api/v1/fixed-costs/generate — 固定費の月次生成 */
export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const year = parsed.body.year as number;
  const month = parsed.body.month as number;
  if (!year || !month || month < 1 || month > 12) {
    return error("VALIDATION_ERROR", "有効な year と month を指定してください", 422);
  }

  return withUserDb(user.id, async (db) => {
    // is_active=true の固定費を全件取得
    const activeFixedCosts = await db.fixedCost.findMany({
      where: { userId: user.id, isActive: true },
    });
    if (activeFixedCosts.length === 0) {
      return ok({ generated_count: 0 });
    }

    // 当月分の固定費transactions が既に存在するIDを取得（冪等性チェック）
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const existingFixedCostIds = await db.transaction
      .findMany({
        where: {
          userId: user.id,
          source: "auto",
          transactionDate: { gte: startDate, lte: endDate },
          fixedCostId: { not: null },
          deletedAt: null,
        },
        select: { fixedCostId: true },
      })
      .then((rows) => new Set(rows.map((r) => r.fixedCostId)));

    // 未生成の固定費のみ抽出
    const toGenerate = activeFixedCosts.filter((fc) => !existingFixedCostIds.has(fc.id));
    if (toGenerate.length === 0) {
      return ok({ generated_count: 0 });
    }

    // 一括インサート（billing_day を transaction_date に使用）
    await db.transaction.createMany({
      data: toGenerate.map((fc) => {
        // billing_day が月末を超える場合は月末に丸める
        const maxDay = new Date(year, month, 0).getDate();
        const day = Math.min(fc.billingDay, maxDay);
        return {
          userId: user.id,
          accountId: fc.accountId,
          categoryId: fc.categoryId,
          fixedCostId: fc.id,
          amount: fc.amount,
          type: "expense" as const,
          transactionDate: new Date(year, month - 1, day),
          note: fc.name,
          source: "auto" as const,
        };
      }),
    });

    return ok({ generated_count: toGenerate.length });
  });
}
