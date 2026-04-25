/**
 * @file api/v1/dashboard/summary/route.ts
 * @description 月次サマリー集計エンドポイント。
 * 指定年月の合計収入・合計支出・残高・カテゴリ別内訳を返す。
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, error, requireAuth } from "@/lib/api-helpers";
import type { DashboardSummary, CategorySummary } from "@/types/api";

/** GET /api/v1/dashboard/summary — 月次サマリー */
export async function GET(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? "");
  const month = parseInt(searchParams.get("month") ?? "");

  if (isNaN(year) || isNaN(month)) {
    return error("VALIDATION_ERROR", "year と month は必須です", 422);
  }

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  // 有効な収支を一括取得（カテゴリ情報付き）
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      transactionDate: { gte: startDate, lte: endDate },
    },
    include: {
      category: { select: { id: true, name: true, color: true } },
    },
  });

  // 合計収入・合計支出を集計
  let totalIncome = 0;
  let totalExpense = 0;

  // カテゴリ別支出を集計するマップ
  const categoryMap = new Map<
    string,
    { name: string; color: string | null; amount: number }
  >();

  for (const tx of transactions) {
    const amount = Number(tx.amount);
    if (tx.type === "income") {
      totalIncome += amount;
    } else {
      totalExpense += amount;

      // カテゴリ別集計（expense のみ）
      const catId = tx.categoryId ?? "uncategorized";
      const catName = tx.category?.name ?? "未分類";
      const catColor = tx.category?.color ?? null;

      const existing = categoryMap.get(catId);
      if (existing) {
        existing.amount += amount;
      } else {
        categoryMap.set(catId, { name: catName, color: catColor, amount });
      }
    }
  }

  // カテゴリ別内訳を ratio（構成比）付きで返す
  const byCategory: CategorySummary[] = Array.from(categoryMap.entries())
    .map(([category_id, { name, color, amount }]) => ({
      category_id,
      name,
      color,
      amount,
      ratio: totalExpense > 0 ? Math.round((amount / totalExpense) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount); // 金額降順

  const summary: DashboardSummary = {
    total_income: totalIncome,
    total_expense: totalExpense,
    balance: totalIncome - totalExpense,
    by_category: byCategory,
  };

  return ok(summary);
}
