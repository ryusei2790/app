/**
 * @file lib/closing/store.ts
 * @description 決算日の設定と月の提案の読み書き（mywork#1150 第2弾）。すべて withUserDb の中で行うので RLS が効く。
 */

import { withUserDb } from "@/lib/db";
import { dateOnlyToDb, dbToDateOnly } from "@/lib/date/jst";
import type { ClosingDay, ClosingResult } from "./bot";

export interface ClosingReportRow {
  month: string;
  markdown: string;
  model: string | null;
  generations: number;
  updatedAt: string;
}

/** 決算日（未設定なら null＝月末） */
export async function loadClosingDay(userId: string): Promise<ClosingDay> {
  return withUserDb(userId, async (db) => {
    const s = await db.closingSetting.findUnique({ where: { userId } });
    return s?.closingDay ?? null;
  });
}

export async function saveClosingDay(userId: string, day: ClosingDay): Promise<void> {
  await withUserDb(userId, (db) =>
    db.closingSetting.upsert({
      where: { userId },
      create: { userId, closingDay: day },
      update: { closingDay: day, updatedAt: new Date() },
    })
  );
}

function toRow(r: { month: string; markdown: string; model: string | null; generations: number; updatedAt: Date }): ClosingReportRow {
  return { month: r.month, markdown: r.markdown, model: r.model, generations: r.generations, updatedAt: r.updatedAt.toISOString() };
}

export async function loadClosingReport(userId: string, month: string): Promise<ClosingReportRow | null> {
  return withUserDb(userId, async (db) => {
    const r = await db.closingReport.findUnique({ where: { userId_month: { userId, month } } });
    return r ? toRow(r) : null;
  });
}

/** 過去の提案の一覧（新しい順・本文なし） */
export async function listClosingMonths(userId: string): Promise<string[]> {
  return withUserDb(userId, async (db) => {
    const rows = await db.closingReport.findMany({ where: { userId }, select: { month: true }, orderBy: { month: "desc" }, take: 24 });
    return rows.map((r) => r.month);
  });
}

/** 作った提案を保存する。同じ月は上書きして作った回数を数える */
export async function saveClosingReport(userId: string, month: string, r: ClosingResult): Promise<ClosingReportRow> {
  return withUserDb(userId, async (db) => {
    const data = { markdown: r.markdown, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    const row = await db.closingReport.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month, ...data },
      update: { ...data, generations: { increment: 1 }, updatedAt: new Date() },
    });
    return toRow(row);
  });
}

// ---------------------------------------------------------------------------
// さかのぼって決算・月の目標（mywork#1238 第2弾）
// ---------------------------------------------------------------------------

export interface MonthlyGoalRow {
  month: string;
  expenseGoal: number;
  fromMonth: string | null;
  updatedAt: string;
}

/** 月の目標（無ければ null） */
export async function loadGoal(userId: string, month: string): Promise<MonthlyGoalRow | null> {
  return withUserDb(userId, async (db) => {
    const g = await db.monthlyGoal.findUnique({ where: { userId_month: { userId, month } } });
    return g ? { month: g.month, expenseGoal: g.expenseGoal, fromMonth: g.fromMonth, updatedAt: g.updatedAt.toISOString() } : null;
  });
}

/** 月の目標を決める（同じ月は上書き）。amount が null なら消す */
export async function saveGoal(userId: string, month: string, amount: number | null, fromMonth: string | null): Promise<MonthlyGoalRow | null> {
  return withUserDb(userId, async (db) => {
    if (amount === null) {
      await db.monthlyGoal.deleteMany({ where: { userId, month } });
      return null;
    }
    const g = await db.monthlyGoal.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month, expenseGoal: amount, fromMonth },
      update: { expenseGoal: amount, fromMonth, updatedAt: new Date() },
    });
    return { month: g.month, expenseGoal: g.expenseGoal, fromMonth: g.fromMonth, updatedAt: g.updatedAt.toISOString() };
  });
}

/**
 * 取引がある月（"YYYY-MM" の集合）。決算の月の選択肢に「記録なし」と出すために使う。
 * 日ごとに数える groupBy（1年で最大366行）にして、取引の行そのものは読まない
 */
export async function monthsWithRecords(userId: string, fromMonth: string, toMonth: string): Promise<Set<string>> {
  const [y, m] = toMonth.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 1)); // toMonth の翌月1日（含まない）
  return withUserDb(userId, async (db) => {
    const rows = await db.transaction.groupBy({
      by: ["transactionDate"],
      where: { userId, deletedAt: null, transactionDate: { gte: dateOnlyToDb(`${fromMonth}-01`), lt: end } },
    });
    return new Set(rows.map((r) => dbToDateOnly(r.transactionDate).slice(0, 7)));
  });
}
