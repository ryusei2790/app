/**
 * @file api/v1/closing/route.ts
 * @description 決算日の提案ボット（mywork#1150 第2弾）。
 *   GET  /api/v1/closing?month=YYYY-MM  — 決算日・保存済みの提案・過去の月の一覧
 *   POST /api/v1/closing  body: { month }  — 集計 → Claude Sonnet 5.5 で提案を作って保存（同じ月は上書き）
 *   PUT  /api/v1/closing  body: { closing_day: 1..28 | null }  — 決算日を変える（null＝月末）
 *
 * 作り直しは1か月あたり CLOSING_QUOTA_USER_MONTH 回まで（既定3）。社長は上限なし。
 * 作れる月は今月と先月だけ（古い月を何度も作らせない・費用を読みやすくする）。
 */

import { error, ok, readJsonBody, requireAuth } from "@/lib/api-helpers";
import { withUserDb } from "@/lib/db";
import { isOwner } from "@/lib/features";
import { todayJst } from "@/lib/date/jst";
import { loadMonthlySummary } from "@/lib/aggregate/load";
import { getCreateMessage } from "@/lib/menu/chat";
import { buildFacts, closingDateOf, isAfterClosing, isClosingDay, prevMonth, runClosingBot } from "@/lib/closing/bot";
import { listClosingMonths, loadClosingDay, loadClosingReport, saveClosingDay, saveClosingReport } from "@/lib/closing/store";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthlyLimit(): number {
  const v = Number(process.env.CLOSING_QUOTA_USER_MONTH);
  return Number.isInteger(v) && v > 0 ? v : 3;
}

/** 今月か先月なら true */
function isAllowedMonth(month: string, today: string): boolean {
  const cur = today.slice(0, 7);
  return month === cur || month === prevMonth(cur);
}

export async function GET(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const today = todayJst();
  const month = new URL(request.url).searchParams.get("month") ?? today.slice(0, 7);
  if (!MONTH_RE.test(month)) return error("VALIDATION_ERROR", "month は YYYY-MM で指定してください", 422);

  const [day, report, months] = await Promise.all([loadClosingDay(user.id), loadClosingReport(user.id, month), listClosingMonths(user.id)]);
  const owner = isOwner(user);
  return ok({
    month,
    today,
    closing_day: day,
    closing_date: closingDateOf(month, day),
    after_closing: isAfterClosing(today, month, day),
    can_generate: isAllowedMonth(month, today),
    generations_left: owner ? null : Math.max(0, monthlyLimit() - (report?.generations ?? 0)),
    report,
    months,
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  const today = todayJst();
  const month = typeof body.month === "string" ? body.month : today.slice(0, 7);
  if (!MONTH_RE.test(month) || !isAllowedMonth(month, today)) {
    return error("VALIDATION_ERROR", "提案を作れるのは今月と先月だけです", 422);
  }

  const create = getCreateMessage();
  if (!create) return error("AI_UNAVAILABLE", "いま提案は作れません（AI の設定がありません）", 503);

  const owner = isOwner(user);
  const [existing, day] = await Promise.all([loadClosingReport(user.id, month), loadClosingDay(user.id)]);
  if (!owner && (existing?.generations ?? 0) >= monthlyLimit()) {
    return error("RATE_LIMITED", `この月の提案は${monthlyLimit()}回まで作れます。保存した提案はこのまま読めます。`, 429);
  }

  // 1) 今月と前月の集計（RLS の中で読む。計算は summarize）
  const { cur, prev } = await withUserDb(user.id, async (db) => {
    const [c, p] = await Promise.all([
      loadMonthlySummary(db, user.id, month, { today, owner }),
      loadMonthlySummary(db, user.id, prevMonth(month), { today, owner }),
    ]);
    return { cur: c.summary, prev: p.summary };
  });
  if (cur.expense.purchaseCount === 0 && cur.income.count === 0) {
    return error("VALIDATION_ERROR", "この月の記録がまだありません。手入力かレシートで記録してから作ってください。", 422);
  }

  // 2) AI が文章にする（数字は facts の中だけ）
  let result;
  try {
    result = await runClosingBot({ facts: buildFacts(cur, prev, !isAfterClosing(today, month, day)), create, model: process.env.CLOSING_MODEL });
  } catch (e) {
    console.error("[closing] AI の呼び出しに失敗", e instanceof Error ? e.message : e);
    return error("AI_UNAVAILABLE", "AI が応答しませんでした。少し待ってからもう一度押してください。", 503);
  }

  // 3) 保存（同じ月は上書き）
  const report = await saveClosingReport(user.id, month, result);
  return ok({ report, generations_left: owner ? null : Math.max(0, monthlyLimit() - report.generations) });
}

export async function PUT(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  const day = body.closing_day ?? null;
  if (!isClosingDay(day)) return error("VALIDATION_ERROR", "決算日は1〜28日か、月末（null）で指定してください", 422);
  await saveClosingDay(user.id, day);
  return ok({ closing_day: day });
}
