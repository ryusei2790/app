/**
 * @file api/v1/survey/route.ts
 * @description 月1回のアンケート（mywork#1150 第3弾）。
 *   GET  /api/v1/survey                     — 今月の回（無ければ固定5問で作る）と回答済みの内容
 *   POST /api/v1/survey  body: { action: "skip" | "resume" } — 今月はスキップ／スキップを取り消す
 * 月は JST の今月だけ（過去の月の回は書き換えない）。
 */

import { error, ok, readJsonBody, requireAuth } from "@/lib/api-helpers";
import { todayJst } from "@/lib/date/jst";
import { SURVEY_CONSENT, VOICE_MAX_SECONDS } from "@/lib/survey/questions";
import { openRound, setRoundStatus } from "@/lib/survey/store";

export async function GET() {
  const { user, response } = await requireAuth();
  if (response) return response;
  const month = todayJst().slice(0, 7);
  const round = await openRound(user.id, month);
  return ok({ ...round, consent: SURVEY_CONSENT, voice_max_seconds: VOICE_MAX_SECONDS });
}

export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  const month = todayJst().slice(0, 7);
  const round = await openRound(user.id, month);
  if (body.action === "skip") {
    if (round.status === "done") return error("VALIDATION_ERROR", "今月のアンケートは回答済みです", 422);
    await setRoundStatus(user.id, month, "skipped");
    return ok({ status: "skipped" });
  }
  if (body.action === "resume") {
    if (round.status === "skipped") await setRoundStatus(user.id, month, "open");
    return ok({ status: round.status === "done" ? "done" : "open" });
  }
  return error("VALIDATION_ERROR", "action は skip か resume です", 422);
}
