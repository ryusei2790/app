/**
 * @file api/v1/budget/route.ts
 * @description 予算台帳（社長専用機能）の集計 API（テスト一覧 M1〜M8・S6・S12）。
 * GET /api/v1/budget?month=YYYY-MM（省略時は JST の今月）
 *   - 初めて開いたときに8費目と対応表を作る（lib/budget/store.ts）
 *   - その月の費目別 実績・残額・合計、枠の外・未割り当て・収入、食費の1日目安（lib/budget/summary.ts）
 *   - その月までの12か月の推移
 * 未ログイン 401 / 一般ユーザー 403 / 社長（OWNER_USER_IDS）200。DB は withUserDb（RLS）経由。
 * 数字の定義はダッシュボードと同じ lib/aggregate（今日まで・返金は同じ費目から引く・振替／借入は入れない: mywork#425 第1弾）。
 */

import type { NextRequest } from "next/server";
import { error, ok, requireOwner } from "@/lib/api-helpers";
import { withUserDb } from "@/lib/db";
import { todayJst } from "@/lib/date/jst";
import { ensureBudgetDefaults, loadFrames, loadRules, serializeFrame, serializeRule } from "@/lib/budget/store";
import { monthlyTrend, monthSummary, shiftMonth } from "@/lib/budget/summary";
import { loadTxsBetween } from "@/lib/aggregate/load";
import { toBudgetTxs } from "@/lib/aggregate/monthly";

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
    const [frames, rules, txs] = await Promise.all([loadFrames(db, user.id), loadRules(db, user.id), loadTxsBetween(db, user.id, from, to)]);
    return { frames, rules, txs };
  });

  // 定義（lib/aggregate）に合わせる: 今日より後の行は「予定」なので入れない。返金は負の支出、振替・借入は費目に入れない（#425 D7・D9）
  const txs = toBudgetTxs(data.txs.filter((t) => t.date <= today));

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
