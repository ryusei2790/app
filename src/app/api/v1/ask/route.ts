/**
 * @file api/v1/ask/route.ts
 * @description POST /api/v1/ask — 質問をルールで読み、コードで集計して答える（mywork#500 第3弾）。
 *
 * 本文: { question: string, previous?: Reading }（続けての質問）か { reading: Reading }（チップで条件を変えて再計算）。
 * - 外部 AI は呼ばない。質問文は保存しない・ログに出さない（Q11）
 * - userId はログイン（requireAuth）からだけ取る。本文の中に userId を書いても使わない。DB は withUserDb（RLS）
 * - チップから来た reading は信用せず形を確かめ、カテゴリー id は本人に見えるカテゴリーにあるかを確かめる
 */

import type { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { error, ok, requireAuth } from "@/lib/api-helpers";
import { todayJst } from "@/lib/date/jst";
import { conditionFromRecord } from "@/lib/fixed-costs/expand";
import { loadTxsBetween } from "@/lib/aggregate/load";
import { monthEnd } from "@/lib/aggregate/monthly";
import { addDays } from "@/lib/fixed-costs/schedule";
import { MAX_QUESTION, readQuestion, type Reading, type Vocab } from "@/lib/ask/reader";
import { parseReading } from "@/lib/ask/parse";
import { answerReading, previousPeriod } from "@/lib/ask/answer";

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "本文が JSON ではありません", 422);
  }
  const question = body.question;
  if (question !== undefined && (typeof question !== "string" || question.length > MAX_QUESTION)) {
    return error("VALIDATION_ERROR", `質問は${MAX_QUESTION}字までの文字で送ってください`, 422);
  }

  const today = todayJst();
  const result = await withUserDb(user.id, async (db) => {
    // 1. 語彙（本人に見えるカテゴリー: 共通＋自分の分。RLS でも他人の分は見えない）
    const cats = await db.category.findMany({ where: { OR: [{ userId: null }, { userId: user.id }] }, select: { id: true, name: true, type: true, color: true } });
    const vocab: Vocab = { today, categories: cats.map((c) => ({ id: c.id, name: c.name, type: c.type as "income" | "expense" })) };

    // 2. 読む（チップの reading か、質問文）
    let reading: Reading;
    if (body.reading !== undefined) {
      const r = parseReading(body.reading, vocab);
      if (!r) return { kind: "invalid" as const };
      reading = r;
    } else {
      const prev = body.previous !== undefined ? parseReading(body.previous, vocab) ?? undefined : undefined;
      const read = readQuestion(typeof question === "string" ? question : "", vocab, prev);
      if (!read.ok) return { kind: "read" as const, read };
      reading = read.reading;
    }

    // 3. 期間（比較なら前の期間も）の取引だけを読む → 4. 集計（summarize）
    const from = reading.compare ? previousPeriod(reading.period).from : reading.period.from;
    const [txs, fixedCosts] = await Promise.all([
      loadTxsBetween(db, user.id, `${from}-01`, addDays(monthEnd(reading.period.to), 1)),
      db.fixedCost.findMany({ where: { userId: user.id } }),
    ]);
    const answer = answerReading(reading, {
      txs,
      today,
      fixedConditions: fixedCosts.map(conditionFromRecord),
      categories: cats.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    });
    return { kind: "answer" as const, answer, categories: vocab.categories };
  });

  if (result.kind === "invalid") return error("VALIDATION_ERROR", "条件の形が正しくありません", 422);
  if (result.kind === "read") {
    const r = result.read;
    if (!r.ok && r.reason === "ambiguous") return ok({ status: "ambiguous", candidates: r.candidates });
    return ok({ status: "unsupported", examples: r.ok ? [] : r.reason === "unsupported" ? r.examples : [] });
  }
  return ok({ status: "answer", answer: result.answer, categories: result.categories });
}
