/**
 * @file api/v1/survey/tidy/route.ts
 * @description アンケートの回答の文字を AI で整える（mywork#1150 第3弾）。保存はしない（本人が OK したら /answer で保存）。
 *   POST body: { question_id, raw_text }
 * 文字起こしはブラウザで済ませてあり、音声はここに来ない（Q4 A・Q5 A）。
 * 1問あたり TIDY_LIMIT_PER_QUESTION 回まで（AI の費用の上限）。超えたら 429。文字で直して保存はできる。
 */

import { error, ok, readJsonBody, requireAuth } from "@/lib/api-helpers";
import { todayJst } from "@/lib/date/jst";
import { getCreateMessage } from "@/lib/menu/chat";
import type { QuestionKind } from "@/lib/survey/questions";
import { findOpenQuestion, consumeTidy } from "@/lib/survey/store";
import { normalizeRaw, tidyAnswer } from "@/lib/survey/tidy";

export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  const raw = normalizeRaw(body.raw_text);
  if (!raw) return error("VALIDATION_ERROR", "回答が空です", 422);
  if (typeof body.question_id !== "string") return error("VALIDATION_ERROR", "question_id がありません", 422);

  const month = todayJst().slice(0, 7);
  const q = await findOpenQuestion(user.id, month, body.question_id).catch(() => null);
  if (!q) return error("NOT_FOUND", "この設問には答えられません（今月の回ではないか、回答済みです）", 404);
  if (!(await consumeTidy(user.id, q.id))) {
    return error("RATE_LIMITED", "この設問は言い直しの上限に達しました。文字で直して保存できます。", 429);
  }
  const r = await tidyAnswer({ question: q.text, kind: q.kind as QuestionKind, raw, create: getCreateMessage(), model: process.env.SURVEY_MODEL });
  return ok({
    raw_text: raw,
    text: r.text,
    score: r.score,
    model: r.model,
    input_tokens: r.inputTokens,
    output_tokens: r.outputTokens,
    cost_usd: r.costUsd,
  });
}
