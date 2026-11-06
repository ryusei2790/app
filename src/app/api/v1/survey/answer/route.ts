/**
 * @file api/v1/survey/answer/route.ts
 * @description アンケートの回答を保存する（mywork#1150 第3弾）。本人が画面で OK した文を保存する。
 *   POST body: { question_id, raw_text, text, score?, input: "voice" | "text", model?, input_tokens?, output_tokens? }
 * 同じ設問は上書き。5問そろったら回を done にする。音声は受け取らない・保存しない。
 * 費用（cost_usd）はサーバーでトークン数から計算し直す（画面から来た値は信じない）。
 */

import { error, ok, readJsonBody, requireAuth } from "@/lib/api-helpers";
import { todayJst } from "@/lib/date/jst";
import { findOpenQuestion, saveAnswer } from "@/lib/survey/store";
import { costOf, isScore, normalizeRaw } from "@/lib/survey/tidy";

function tokens(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1_000_000 ? v : 0;
}

export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  const text = normalizeRaw(body.text);
  const raw = normalizeRaw(body.raw_text) ?? text;
  if (!text || !raw) return error("VALIDATION_ERROR", "回答が空です", 422);
  if (typeof body.question_id !== "string") return error("VALIDATION_ERROR", "question_id がありません", 422);
  if (body.input !== "voice" && body.input !== "text") return error("VALIDATION_ERROR", "input は voice か text です", 422);
  const score = body.score === null || body.score === undefined ? null : body.score;
  if (score !== null && !isScore(score)) return error("VALIDATION_ERROR", "満足度は 0〜10 の整数です", 422);

  const month = todayJst().slice(0, 7);
  const q = await findOpenQuestion(user.id, month, body.question_id).catch(() => null);
  if (!q) return error("NOT_FOUND", "この設問には答えられません（今月の回ではないか、回答済みです）", 404);

  const inT = tokens(body.input_tokens);
  const outT = tokens(body.output_tokens);
  const model = typeof body.model === "string" ? body.model.slice(0, 80) : null;
  const round = await saveAnswer(user.id, month, {
    questionId: q.id,
    rawText: raw,
    text,
    score: q.kind === "satisfaction" ? score : null,
    input: body.input,
    model,
    inputTokens: inT,
    outputTokens: outT,
    costUsd: model ? costOf(inT, outT) : 0,
  });
  return ok(round);
}
