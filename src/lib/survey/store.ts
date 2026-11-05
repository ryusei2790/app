/**
 * @file lib/survey/store.ts
 * @description アンケートの回・設問・回答の読み書き（mywork#1150 第3弾）。すべて withUserDb の中なので RLS が効き、
 * where: { userId } と合わせて二重に本人の行だけになる。
 */

import { withUserDb, type UserDb } from "@/lib/db";
import { FIXED_QUESTIONS, TIDY_LIMIT_PER_QUESTION, type QuestionKind } from "./questions";

export type RoundStatus = "open" | "done" | "skipped";

export interface SurveyQuestionView {
  id: string;
  position: number;
  text: string;
  kind: QuestionKind;
  tidy_left: number;
  answer: { text: string; raw_text: string; score: number | null; input: "voice" | "text" } | null;
}

export interface SurveyView {
  month: string;
  status: RoundStatus;
  questions: SurveyQuestionView[];
}

const include = { questions: { orderBy: { position: "asc" as const }, include: { answer: true } } };

type RoundWithQ = NonNullable<Awaited<ReturnType<typeof findRound>>>;

function findRound(db: UserDb, userId: string, month: string) {
  return db.surveyRound.findUnique({ where: { userId_month: { userId, month } }, include });
}

function toView(r: RoundWithQ): SurveyView {
  return {
    month: r.month,
    status: r.status as RoundStatus,
    questions: r.questions.map((q) => ({
      id: q.id,
      position: q.position,
      text: q.text,
      kind: q.kind as QuestionKind,
      tidy_left: Math.max(0, TIDY_LIMIT_PER_QUESTION - q.tidyCount),
      answer: q.answer
        ? { text: q.answer.text, raw_text: q.answer.rawText, score: q.answer.score, input: q.answer.input as "voice" | "text" }
        : null,
    })),
  };
}

/** その月の回の状態だけ（ホームのお知らせ用。回は作らない） */
export async function loadRoundStatus(userId: string, month: string): Promise<RoundStatus | null> {
  return withUserDb(userId, async (db) => {
    const r = await db.surveyRound.findUnique({ where: { userId_month: { userId, month } }, select: { status: true } });
    return (r?.status as RoundStatus | undefined) ?? null;
  });
}

/** その月の回を開く。無ければ固定5問で作る（同じ月に2回目は作らない） */
export async function openRound(userId: string, month: string): Promise<SurveyView> {
  return withUserDb(userId, async (db) => {
    const found = await findRound(db, userId, month);
    if (found) return toView(found);
    const created = await db.surveyRound.create({
      data: {
        userId,
        month,
        questions: { create: FIXED_QUESTIONS.map((q) => ({ userId, position: q.position, text: q.text, kind: q.kind })) },
      },
      include,
    });
    return toView(created);
  });
}

export async function setRoundStatus(userId: string, month: string, status: RoundStatus): Promise<void> {
  await withUserDb(userId, (db) =>
    db.surveyRound.updateMany({
      where: { userId, month },
      data: { status, finishedAt: status === "open" ? null : new Date() },
    })
  );
}

/** 本人の、今月の、まだ開いている回の設問か。違えば null */
export async function findOpenQuestion(userId: string, month: string, questionId: string) {
  return withUserDb(userId, async (db) => {
    const q = await db.surveyQuestion.findFirst({ where: { id: questionId, userId, round: { month, userId } }, include: { round: true } });
    if (!q || q.round.status === "done") return null;
    return q;
  });
}

/** 整形を1回使う。上限を超えていたら false（数えずに返す） */
export async function consumeTidy(userId: string, questionId: string): Promise<boolean> {
  return withUserDb(userId, async (db) => {
    const r = await db.surveyQuestion.updateMany({
      where: { id: questionId, userId, tidyCount: { lt: TIDY_LIMIT_PER_QUESTION } },
      data: { tidyCount: { increment: 1 } },
    });
    return r.count === 1;
  });
}

/** 回答を保存する（同じ設問は上書き）。5問そろったら回を done にする。戻り値は回の状態 */
export async function saveAnswer(
  userId: string,
  month: string,
  a: {
    questionId: string;
    rawText: string;
    text: string;
    score: number | null;
    input: "voice" | "text";
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  }
): Promise<SurveyView> {
  return withUserDb(userId, async (db) => {
    const data = {
      rawText: a.rawText,
      text: a.text,
      score: a.score,
      input: a.input,
      model: a.model ?? null,
      inputTokens: a.inputTokens ?? null,
      outputTokens: a.outputTokens ?? null,
      costUsd: a.costUsd ?? null,
    };
    await db.surveyAnswer.upsert({
      where: { questionId: a.questionId },
      create: { questionId: a.questionId, userId, ...data },
      update: { ...data, updatedAt: new Date() },
    });
    const round = (await findRound(db, userId, month))!;
    const allAnswered = round.questions.every((q) => q.answer);
    if (allAnswered && round.status !== "done") {
      await db.surveyRound.update({ where: { id: round.id }, data: { status: "done", finishedAt: new Date() } });
      round.status = "done";
    } else if (!allAnswered && round.status === "skipped") {
      // スキップのあとで答え始めたら開いた回に戻す
      await db.surveyRound.update({ where: { id: round.id }, data: { status: "open", finishedAt: null } });
      round.status = "open";
    }
    return toView(round);
  });
}
