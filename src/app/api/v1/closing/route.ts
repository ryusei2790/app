/**
 * @file api/v1/closing/route.ts
 * @description 決算日の提案ボット（mywork#1150 第2弾）。
 *   GET  /api/v1/closing?month=YYYY-MM  — 決算日・保存済みの提案・過去の月の一覧
 *   POST /api/v1/closing  body: { month }  — 集計 → Claude Sonnet 5.5 で提案を作って保存（同じ月は上書き）
 *   PUT  /api/v1/closing  body: { closing_day: 1..28 | null }  — 決算日を変える（null＝月末）
 *
 * 作り直しは1か月あたり CLOSING_QUOTA_USER_MONTH 回まで（既定3）。社長は上限なし。
 * 作れる月は今月から12か月前まで（mywork#1238。以前は今月と先月だけ。加入したばかりの人が先月以前を後から決算できるように）。
 * GET はあわせて、月の選択肢（記録の有無・提案の有無）・その月の支出と目標・次の月の目標と候補を返す。
 * 目標の保存は PUT /api/v1/closing/goal。
 */

import { error, ok, readJsonBody, requireAuth } from "@/lib/api-helpers";
import { withUserDb } from "@/lib/db";
import { isOwner } from "@/lib/features";
import { todayJst } from "@/lib/date/jst";
import { loadMonthlySummary } from "@/lib/aggregate/load";
import { getCreateMessage } from "@/lib/menu/chat";
import { buildFacts, closingDateOf, isAfterClosing, isClosingDay, nextMonth, prevMonth, runClosingBot } from "@/lib/closing/bot";
import { goalProgress, goalSuggestions, isClosableMonth, isGoalMonth, monthRelLabel, selectableMonths } from "@/lib/closing/goals";
import {
  listClosingMonths,
  loadClosingDay,
  loadClosingReport,
  loadGoal,
  monthsWithRecords,
  saveClosingDay,
  saveClosingReport,
} from "@/lib/closing/store";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthlyLimit(): number {
  const v = Number(process.env.CLOSING_QUOTA_USER_MONTH);
  return Number.isInteger(v) && v > 0 ? v : 3;
}

export async function GET(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const today = todayJst();
  const month = new URL(request.url).searchParams.get("month") ?? today.slice(0, 7);
  if (!MONTH_RE.test(month)) return error("VALIDATION_ERROR", "month は YYYY-MM で指定してください", 422);

  const owner = isOwner(user);
  const choices = selectableMonths(today);
  const next = nextMonth(month);
  const [day, report, months, withRecords, goal, nextGoal] = await Promise.all([
    loadClosingDay(user.id),
    loadClosingReport(user.id, month),
    listClosingMonths(user.id),
    monthsWithRecords(user.id, choices[choices.length - 1], choices[0]),
    loadGoal(user.id, month),
    loadGoal(user.id, next),
  ]);
  const hasRecords = withRecords.has(month);

  // その月の支出（目標との比べと、次の月の目標の候補に使う）。記録が無い月は読まない
  const expense = hasRecords
    ? await withUserDb(user.id, async (db) => (await loadMonthlySummary(db, user.id, month, { today, owner })).summary.expense.total)
    : 0;

  const reported = new Set(months);
  return ok({
    month,
    today,
    month_label: monthRelLabel(month, today),
    closing_day: day,
    closing_date: closingDateOf(month, day),
    after_closing: isAfterClosing(today, month, day),
    can_generate: isClosableMonth(month, today),
    generations_left: owner ? null : Math.max(0, monthlyLimit() - (report?.generations ?? 0)),
    report,
    months,
    choices: choices.map((m) => ({ month: m, label: monthRelLabel(m, today), has_records: withRecords.has(m), has_report: reported.has(m) })),
    has_records: hasRecords,
    expense,
    goal: goalProgress(goal?.expenseGoal ?? null, expense),
    next_month: next,
    next_label: monthRelLabel(next, today),
    next_goal: nextGoal,
    // 月の途中（決算日の前）の今月は、途中の少ない支出から来月の目標の候補が出てしまうので、決算日を過ぎてから出す
    can_set_next_goal: hasRecords && isGoalMonth(next, today) && (month !== today.slice(0, 7) || isAfterClosing(today, month, day)),
    goal_suggestions: goalSuggestions(expense),
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  const today = todayJst();
  const month = typeof body.month === "string" ? body.month : today.slice(0, 7);
  if (!MONTH_RE.test(month) || !isClosableMonth(month, today)) {
    return error("VALIDATION_ERROR", "提案を作れるのは今月から12か月前までです", 422);
  }

  const create = getCreateMessage();
  if (!create) return error("AI_UNAVAILABLE", "いま提案は作れません（AI の設定がありません）", 503);

  const owner = isOwner(user);
  const [existing, day, goal] = await Promise.all([loadClosingReport(user.id, month), loadClosingDay(user.id), loadGoal(user.id, month)]);
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
    const facts = buildFacts(cur, prev, !isAfterClosing(today, month, day), {
      goal: goal?.expenseGoal ?? null,
      nextLabel: monthRelLabel(nextMonth(month), today),
    });
    result = await runClosingBot({ facts, create, model: process.env.CLOSING_MODEL });
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
