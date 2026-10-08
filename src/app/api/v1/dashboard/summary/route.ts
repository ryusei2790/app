/**
 * @file api/v1/dashboard/summary/route.ts
 * @description 月次サマリー集計エンドポイント。
 * 指定年月の合計収入・合計支出・残高・カテゴリ別内訳を返す。
 * 集計は DB の RPC monthly_summary（自分の分だけを集計。S8）に任せ、
 * ここではカテゴリ名を付けて構成比を計算するだけ。
 */

import { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { ok, error, requireAuth } from "@/lib/api-helpers";
import type { DashboardSummary, CategorySummary } from "@/types/api";

type SummaryRow = { type: string; category_id: string | null; total: unknown };

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

  const { rows, categories } = await withUserDb(user.id, async (db) => {
    // RPC は呼んだ本人（auth.uid()）の取引だけを、日付で [当月1日, 翌月1日) の範囲で集計する
    const rows = await db.$queryRaw<SummaryRow[]>`
      SELECT type, category_id, total FROM public.monthly_summary(${year}::int, ${month}::int)`;
    const ids = rows.map((r) => r.category_id).filter((id): id is string => id !== null);
    const categories = ids.length
      ? await db.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, color: true } })
      : [];
    return { rows, categories };
  });

  const catById = new Map(categories.map((c) => [c.id, c]));
  let totalIncome = 0;
  let totalExpense = 0;
  const expenseByCategory: { category_id: string; name: string; color: string | null; amount: number }[] = [];

  for (const r of rows) {
    const amount = Number(r.total);
    if (r.type === "income") {
      totalIncome += amount;
      continue;
    }
    totalExpense += amount;
    const cat = r.category_id ? catById.get(r.category_id) : undefined;
    expenseByCategory.push({
      category_id: r.category_id ?? "uncategorized",
      name: cat?.name ?? "未分類",
      color: cat?.color ?? null,
      amount,
    });
  }

  // カテゴリ別内訳を ratio（構成比）付きで返す
  const byCategory: CategorySummary[] = expenseByCategory
    .map((c) => ({
      ...c,
      ratio: totalExpense > 0 ? Math.round((c.amount / totalExpense) * 100) / 100 : 0,
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
