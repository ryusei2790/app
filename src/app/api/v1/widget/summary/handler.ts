/**
 * @file api/v1/widget/summary/handler.ts
 * @description GET /api/v1/widget/summary — iPhone ホームのウィジェット（Scriptable）用。今月の収入・支出・合計だけを返す読み取り専用 API（mywork#967）。
 *
 * 守り: Authorization: Bearer <WIDGET_TOKEN> が一致したときだけ、WIDGET_USER_ID の人の数字を返す。
 *   - WIDGET_TOKEN か WIDGET_USER_ID が未設定なら誰が呼んでも 401（設定漏れで誰でも読める状態にしない）
 *   - 比較は timingSafeEqual（cron と同じ）
 *   - 数字は画面と同じ lib/aggregate（支出＝購入−返金、振替等除外、今月は今日まで）。カテゴリ別などは出さない
 *   - 応答は Cache-Control: no-store（金額を CDN に残さない）
 */

import { timingSafeEqual } from "node:crypto";
import { withUserDb } from "@/lib/db";
import { error } from "@/lib/api-helpers";
import { todayJst } from "@/lib/date/jst";
import { loadMonthlySummary } from "@/lib/aggregate/load";

export function widgetAuthorized(authorization: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.WIDGET_TOKEN;
  if (!token || !env.WIDGET_USER_ID) return false;
  const given = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function widgetSummaryGet(request: Request) {
  if (!widgetAuthorized(request.headers.get("authorization"))) return error("UNAUTHORIZED", "認証が必要です", 401);

  const userId = process.env.WIDGET_USER_ID as string;
  const today = todayJst();
  const month = today.slice(0, 7);
  const { summary: s } = await withUserDb(userId, (db) => loadMonthlySummary(db, userId, month, { today, owner: false }));
  return Response.json(
    { data: { month, today, income: s.income.total, expense: s.expense.total, balance: s.balance } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
