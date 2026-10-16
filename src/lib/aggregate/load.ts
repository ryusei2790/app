/**
 * @file lib/aggregate/load.ts
 * @description 月の集計に要るものを DB から読み、summarize（lib/aggregate/monthly.ts）に渡す（mywork#425 第1弾）。
 * route（api/v1/summary・api/v1/review・api/v1/budget）から withUserDb の中で呼ぶので RLS が効く（他人の行は読めない: S14）。
 * 読むもの: その月の取引（予定の行も含めて月の全部）・自分の定期（固定の条件と「今月の予定」用）・カテゴリー（名前と色）・
 * 社長なら予算の費目と対応表。計算はここでは一切しない（summarize に寄せる: D9）。
 */

import type { UserDb } from "@/lib/db";
import { dateOnlyToDb, dbToDateOnly } from "@/lib/date/jst";
import { conditionFromRecord } from "@/lib/fixed-costs/expand";
import type { Cycle } from "@/lib/fixed-costs/schedule";
import type { FixedTx } from "@/lib/fixed/classify";
import { upcomingInMonth, type UpcomingItem } from "@/lib/fixed/upcoming";
import { loadFrames, loadRules } from "@/lib/budget/store";
import type { TransactionKind } from "./definitions";
import { monthEnd, summarize, type AggTx, type MonthlySummary, type SummarizeInput } from "./monthly";

export interface MonthData {
  summary: MonthlySummary;
  /** 定期のまだ取引になっていない回（今日以降・月末まで）。lib/fixed/upcoming.ts */
  upcoming: UpcomingItem[];
  /** その月の取引（要確認の列挙に使う） */
  txs: AggTx[];
}

const TX_SELECT = {
  id: true,
  transactionDate: true,
  amount: true,
  type: true,
  kind: true,
  categoryId: true,
  note: true,
  source: true,
  category: { select: { name: true, type: true, color: true } },
} as const;

/** DB の取引の行 → 集計の入力 */
export function aggTxFromRecord(t: {
  id: string;
  transactionDate: Date;
  amount: unknown;
  type: string;
  kind: string;
  categoryId: string | null;
  note: string | null;
  source: string;
  category: { name: string; type: string; color: string | null } | null;
}): AggTx {
  return {
    id: t.id,
    date: dbToDateOnly(t.transactionDate),
    amount: Number(t.amount),
    type: t.type as "income" | "expense",
    kind: t.kind as TransactionKind,
    categoryId: t.categoryId,
    categoryName: t.category?.name ?? null,
    categoryType: (t.category?.type as "income" | "expense" | undefined) ?? null,
    note: t.note,
    source: t.source,
  };
}

/** その月の取引（消したものは除く。予定の行も含む） */
export async function loadMonthTxs(db: UserDb, userId: string, month: string): Promise<AggTx[]> {
  const rows = await db.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      transactionDate: { gte: dateOnlyToDb(`${month}-01`), lte: dateOnlyToDb(monthEnd(month)) },
    },
    select: TX_SELECT,
    orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(aggTxFromRecord);
}

/** 範囲の取引（予算台帳の12か月の推移用）。from を含み to を含まない */
export async function loadTxsBetween(db: UserDb, userId: string, from: string, to: string): Promise<AggTx[]> {
  const rows = await db.transaction.findMany({
    where: { userId, deletedAt: null, transactionDate: { gte: dateOnlyToDb(from), lt: dateOnlyToDb(to) } },
    select: TX_SELECT,
  });
  return rows.map(aggTxFromRecord);
}

/** 社長の予算の費目と対応表。まだ作っていなければ null（GET で勝手に作らない） */
export async function loadBudget(db: UserDb, userId: string): Promise<SummarizeInput["budget"]> {
  const frames = await loadFrames(db, userId);
  if (frames.length === 0) return null;
  const rules = await loadRules(db, userId);
  return { frames, rules };
}

/**
 * 月の集計と「今月の予定」をまとめて読む。
 * @param opts.owner 社長なら予算の費目も集計する（他の人は frames: null）
 */
export async function loadMonthlySummary(
  db: UserDb,
  userId: string,
  month: string,
  opts: { today: string; owner: boolean }
): Promise<MonthData> {
  const [txs, fixedCosts, categories] = await Promise.all([
    loadMonthTxs(db, userId, month),
    db.fixedCost.findMany({ where: { userId } }),
    db.category.findMany({ where: { OR: [{ userId: null }, { userId }] }, select: { id: true, name: true, color: true } }),
  ]);
  const budget = opts.owner ? await loadBudget(db, userId) : null;

  const summary = summarize({
    txs,
    month,
    today: opts.today,
    fixedConditions: fixedCosts.map(conditionFromRecord),
    budget,
    categories,
  });

  // 今月の予定（定期のまだ来ていない回）。同じ月に条件に当てはまる取引があれば二重に見込まない（F7）
  const fixedTxs: FixedTx[] = txs.map((t) => ({ date: t.date, amount: t.amount, type: t.type, categoryId: t.categoryId, note: t.note, source: t.source }));
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
    txs: fixedTxs,
    month,
    today: opts.today,
  });

  return { summary, upcoming, txs };
}
