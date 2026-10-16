/**
 * @file api/v1/dashboard/summary/route.ts
 * @description 月次サマリー集計エンドポイント。
 * 指定年月の合計収入・合計支出・残高・カテゴリ別内訳を返す。
 * 集計は DB の RPC monthly_summary（自分の分だけを集計。S8）に任せ、
 * ここではカテゴリ名を付けて構成比を計算するだけ。
 * あわせて、その月の取引を定期の条件で 固定／変動 に分けた合計（F8、lib/fixed/classify.ts）と、
 * 定期のまだ取引になっていない回＝「今月の予定（未確定）」（lib/fixed/upcoming.ts）を返す。
 * 定期・取引は withUserDb（RLS）で読むので、他人の定期の条件は使われない（F5）。
 */

import { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { ok, error, requireAuth } from "@/lib/api-helpers";
import { dbToDateOnly, isValidYearMonth, monthRange, todayJst } from "@/lib/date/jst";
import { summarizeFixed } from "@/lib/fixed/classify";
import { upcomingInMonth } from "@/lib/fixed/upcoming";
import { conditionFromRecord, txFromRecord } from "@/lib/fixed-costs/expand";
import type { Cycle } from "@/lib/fixed-costs/schedule";
import type { DashboardSummary, CategorySummary } from "@/types/api";

type SummaryRow = { type: string; category_id: string | null; total: unknown };

/** GET /api/v1/dashboard/summary — 月次サマリー */
export async function GET(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? "");
  const month = parseInt(searchParams.get("month") ?? "");

  if (!isValidYearMonth(year, month)) {
    return error("VALIDATION_ERROR", "year と month（1〜12）は必須です", 422);
  }

  const { rows, categories, monthTxs, fixedCosts } = await withUserDb(user.id, async (db) => {
    // RPC は呼んだ本人（auth.uid()）の取引だけを、日付で [当月1日, 翌月1日) の範囲で集計する
    const rows = await db.$queryRaw<SummaryRow[]>`
      SELECT type, category_id, total FROM public.monthly_summary(${year}::int, ${month}::int)`;
    const ids = rows.map((r) => r.category_id).filter((id): id is string => id !== null);
    const categories = ids.length
      ? await db.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, color: true } })
      : [];
    // 固定／変動の判定用: その月の取引（金額・メモ等）と、自分の定期の条件（削除したものは無い＝F6）
    const monthTxs = await db.transaction.findMany({
      where: { userId: user.id, deletedAt: null, transactionDate: monthRange(year, month) },
      select: { transactionDate: true, amount: true, type: true, categoryId: true, note: true, source: true },
    });
    const fixedCosts = await db.fixedCost.findMany({ where: { userId: user.id } });
    return { rows, categories, monthTxs, fixedCosts };
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

  // 固定／変動（F8）。一時停止中の定期も条件としては使う（止めている間も過去の取引は固定のまま）
  const txs = monthTxs.map(txFromRecord);
  const fixed = summarizeFixed(txs, fixedCosts.map(conditionFromRecord));

  // 今月の予定（未確定）。取引にはしない（支払日に定期の展開が作る）
  const upcoming = upcomingInMonth({
    sources: fixedCosts.map((fc) => ({
      ...conditionFromRecord(fc),
      name: fc.name,
      cycle: fc.cycle as Cycle,
      billingDay: fc.billingDay,
      billingMonth: fc.billingMonth,
      startDate: dbToDateOnly(fc.startDate),
      endDate: fc.endDate ? dbToDateOnly(fc.endDate) : null,
      isActive: fc.isActive,
      generatedThrough: fc.generatedThrough ? dbToDateOnly(fc.generatedThrough) : null,
    })),
    txs,
    month: `${year}-${String(month).padStart(2, "0")}`,
    today: todayJst(),
  });

  const summary: DashboardSummary = {
    total_income: totalIncome,
    total_expense: totalExpense,
    balance: totalIncome - totalExpense,
    by_category: byCategory,
    fixed: {
      fixed_income: fixed.fixedIncome,
      variable_income: fixed.variableIncome,
      fixed_expense: fixed.fixedExpense,
      variable_expense: fixed.variableExpense,
    },
    upcoming: upcoming.map((u) => ({
      fixed_cost_id: u.fixedCostId,
      date: u.date,
      name: u.name,
      type: u.type,
      amount: u.amount,
    })),
  };

  return ok(summary);
}
