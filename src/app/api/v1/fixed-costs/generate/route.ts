/**
 * @file api/v1/fixed-costs/generate/route.ts
 * @description 固定費の月次自動生成エンドポイント。
 * ログイン時に呼び出し、指定年月の固定費が未生成の場合のみ transactions に挿入する。
 * 冪等性を保証する（何度呼んでも二重生成しない）。
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, error, requireAuth } from "@/lib/api-helpers";
import type { GenerateFixedCostsRequest } from "@/types/api";

/** POST /api/v1/fixed-costs/generate — 固定費の月次生成 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  let body: GenerateFixedCostsRequest;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "リクエストボディが不正です", 422);
  }

  const { year, month } = body;
  if (!year || !month || month < 1 || month > 12) {
    return error("VALIDATION_ERROR", "有効な year と month を指定してください", 422);
  }

  // is_active=true の固定費を全件取得
  const activeFixedCosts = await prisma.fixedCost.findMany({
    where: { userId: user.id, isActive: true },
  });

  if (activeFixedCosts.length === 0) {
    return ok({ generated_count: 0 });
  }

  // 当月分の固定費transactions が既に存在するIDを取得（冪等性チェック）
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const existingFixedCostIds = await prisma.transaction
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
  const toGenerate = activeFixedCosts.filter(
    (fc) => !existingFixedCostIds.has(fc.id)
  );

  if (toGenerate.length === 0) {
    return ok({ generated_count: 0 });
  }

  // 一括インサート（billing_day を transaction_date に使用）
  await prisma.transaction.createMany({
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
}
