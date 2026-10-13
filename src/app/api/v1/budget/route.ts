/**
 * @file api/v1/budget/route.ts
 * @description 予算台帳（社長専用機能）の集計 API（テスト一覧 M1〜M8・S6・S12）。
 * GET /api/v1/budget?month=YYYY-MM（省略時は JST の今月）
 *   - 初めて開いたときに8費目と対応表を作る（lib/budget/store.ts）
 *   - その月の費目別 実績・残額・合計、枠の外・未割り当て・収入、食費の1日目安（lib/budget/summary.ts）
 *   - その月までの12か月の推移
 * 未ログイン 401 / 一般ユーザー 403 / 社長（OWNER_USER_IDS）200。DB は withUserDb（RLS）経由。
 */

import type { NextRequest } from "next/server";
import { error, ok, requireOwner } from "@/lib/api-helpers";
import { withUserDb } from "@/lib/db";
import { dateOnlyToDb, dbToDateOnly, todayJst } from "@/lib/date/jst";
import { ensureBudgetDefaults, loadFrames, loadRules, serializeFrame, serializeRule } from "@/lib/budget/store";
import { monthlyTrend, monthSummary, shiftMonth } from "@/lib/budget/summary";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** GET /api/v1/budget — 月の集計 */
export async function GET(request?: NextRequest) {
  const { user, response } = await requireOwner();
  if (response) return response;

  const today = todayJst();
  const month = request?.nextUrl.searchParams.get("month") ?? today.slice(0, 7);
  if (!MONTH_RE.test(month)) return error("VALIDATION_ERROR", "month は YYYY-MM で指定してください", 422);

  // 推移（12か月）に要る範囲の取引をまとめて読む: 11か月前の1日 〜 指定月の末日
  const from = `${shiftMonth(month, -11)}-01`;
  const to = `${shiftMonth(month, 1)}-01`;

  const data = await withUserDb(user.id, async (db) => {
    await ensureBudgetDefaults(db, user.id);
    const [frames, rules, txs] = await Promise.all([
      loadFrames(db, user.id),
      loadRules(db, user.id),
      db.transaction.findMany({
        where: { userId: user.id, deletedAt: null, transactionDate: { gte: dateOnlyToDb(from), lt: dateOnlyToDb(to) } },
        select: { transactionDate: true, amount: true, type: true, categoryId: true, note: true, category: { select: { name: true } } },
      }),
    ]);
    return { frames, rules, txs };
  });

  const txs = data.txs.map((t) => ({
    date: dbToDateOnly(t.transactionDate),
    amount: Number(t.amount),
    type: t.type as "income" | "expense",
    categoryId: t.categoryId,
    categoryName: t.category?.name ?? null,
    note: t.note,
  }));

  return ok({
    enabled: true,
    month,
    today,
    summary: monthSummary({ txs, rules: data.rules, frames: data.frames, month, today }),
    trend: monthlyTrend({ txs, rules: data.rules, frames: data.frames, endMonth: month }),
    frames: data.frames.map(serializeFrame),
    rules: data.rules.map(serializeRule),
  });
}
