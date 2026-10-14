/**
 * @file api/v1/summary/handler.ts
 * @description GET /api/v1/summary の中身（mywork#425 第1弾、設計書 4-5）。
 * /api/v1/summary と、互換のために残す /api/v1/dashboard/summary の両方がこれを使う（route.ts は1行の薄い層）。
 *
 * - 月は ?month=YYYY-MM（省略時は JST の今月）。古い呼び方 ?year=2026&month=10 も受ける
 * - 数字はすべて lib/aggregate の summarize（定義 4-1）。ここでは snake_case に写すだけ
 * - 予算の費目（frames）は社長（OWNER_USER_IDS）だけ値が入り、他は null
 * - 古い型（total_income・total_expense・balance・by_category・fixed・upcoming）も同じ数字で返す
 */

import type { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { isOwner } from "@/lib/features";
import { error, ok, requireAuth } from "@/lib/api-helpers";
import { isValidYearMonth, todayJst } from "@/lib/date/jst";
import { loadMonthlySummary, type MonthData } from "@/lib/aggregate/load";
import type { MonthlySummary } from "@/lib/aggregate/monthly";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** ?month=YYYY-MM か ?year=&month= を読む。無ければ今月。おかしければ null */
export function parseMonthParam(params: URLSearchParams, today: string): string | null {
  const month = params.get("month");
  const year = params.get("year");
  if (month === null && year === null) return today.slice(0, 7);
  if (month !== null && MONTH_RE.test(month) && year === null) return month;
  if (year !== null && month !== null) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (isValidYearMonth(y, m)) return `${y}-${String(m).padStart(2, "0")}`;
  }
  return null;
}

/** API の返し方（snake_case）。数字は summarize のまま */
export function serializeSummary({ summary: s, upcoming }: MonthData) {
  const byCategory = s.byCategory.map((c) => ({
    category_id: c.categoryId,
    name: c.name,
    color: c.color,
    amount: c.amount,
    purchases: c.purchases,
    refunds: c.refunds,
    count: c.count,
    ratio: c.ratio,
  }));
  const fixed = {
    fixed_income: s.fixed.fixedIncome,
    variable_income: s.fixed.variableIncome,
    fixed_expense: s.fixed.fixedExpense,
    variable_expense: s.fixed.variableExpense,
  };
  const upcomingItems = upcoming.map((u) => ({ fixed_cost_id: u.fixedCostId, date: u.date, name: u.name, type: u.type, amount: u.amount }));
  return {
    definitions_version: s.definitionsVersion,
    month: s.month,
    today: s.today,
    period: s.period,
    expense: {
      total: s.expense.total,
      purchases: s.expense.purchases,
      refunds: s.expense.refunds,
      purchase_count: s.expense.purchaseCount,
      refund_count: s.expense.refundCount,
      refund_heavy: s.expense.refundHeavy,
    },
    income: s.income,
    transfers: s.transfers,
    loans: s.loans,
    scheduled: s.scheduled,
    balance: s.balance,
    fixed,
    by_category: byCategory,
    frames: s.frames,
    review: {
      refund_candidates: s.review.refundCandidates,
      unassigned: s.review.unassigned,
      scheduled: s.review.scheduled,
      duplicates: s.review.duplicates,
    },
    upcoming: upcomingItems,
    // 互換（ダッシュボードの古い型）。同じ数字
    total_income: s.income.total,
    total_expense: s.expense.total,
  };
}

export type SummaryResponse = ReturnType<typeof serializeSummary>;

export async function summaryGet(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const today = todayJst();
  const month = parseMonthParam(request.nextUrl.searchParams, today);
  if (month === null) return error("VALIDATION_ERROR", "month は YYYY-MM（または year と month）で指定してください", 422);

  const data = await withUserDb(user.id, (db) => loadMonthlySummary(db, user.id, month, { today, owner: isOwner(user) }));
  return ok(serializeSummary(data));
}

export type { MonthlySummary };
