/**
 * @file api/v1/closing/goal/route.ts
 * @description 決算から月の目標を決める（mywork#1238 第2弾）。
 *   PUT /api/v1/closing/goal  body: { month: "YYYY-MM", expense_goal: 1..99999999 | null, from_month?: "YYYY-MM" }
 *   - month は目標を付ける月（今月〜12か月前か、来月）。決算の画面では「決算した月の次の月」が入る
 *   - expense_goal が null なら目標を消す
 *   - from_month はどの月の決算を見て決めたか（記録用。month の前の月だけ受ける）
 * 金額は本人が決めた数字1つだけ保存する。AI は呼ばない。
 */

import { error, ok, readJsonBody, requireAuth } from "@/lib/api-helpers";
import { todayJst } from "@/lib/date/jst";
import { prevMonth } from "@/lib/closing/bot";
import { isExpenseGoal, isGoalMonth } from "@/lib/closing/goals";
import { saveGoal } from "@/lib/closing/store";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function PUT(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  const today = todayJst();

  // 1) 入力の形を確かめる（月・金額・元の月）
  const month = body.month;
  if (typeof month !== "string" || !MONTH_RE.test(month) || !isGoalMonth(month, today)) {
    return error("VALIDATION_ERROR", "目標を決められるのは12か月前から来月までです", 422);
  }
  const goal = body.expense_goal ?? null;
  if (!isExpenseGoal(goal)) return error("VALIDATION_ERROR", "目標は1円〜99,999,999円の整数で指定してください", 422);
  const from = body.from_month ?? null;
  if (from !== null && from !== prevMonth(month)) return error("VALIDATION_ERROR", "from_month は目標の月の前の月だけです", 422);

  // 2) 保存（RLS の中。同じ月は上書き、null なら消す）
  const saved = await saveGoal(user.id, month, goal, from);
  return ok({ goal: saved });
}
