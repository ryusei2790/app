/**
 * @file lib/survey/tidy.ts
 * @description アンケートの回答の文字を整える（mywork#1150 第3弾、Q4 A）。
 * 文字起こしはブラウザの音声認識（Web Speech API）で済ませてあり、ここには文字だけが来る。音声はサーバーに来ない。
 * Claude Sonnet 5.5 に「言い間違い・フィラー（えー、あのー）を除いた文」と、1問目なら満足度の数字を tool use の形で返させる。
 *
 * 設計意図:
 * - 意味を足さない・要約しすぎない（本人の言葉を残す）。整えた文は本人が画面で OK してから保存する
 * - AI に渡すのは設問と回答の文字だけ（金額・取引・メールアドレスは渡さない）
 * - AI が使えない・失敗したときは、文字をそのまま返す（回答は止めない）
 */

import type Anthropic from "@anthropic-ai/sdk";
import { toAnthropicModelId } from "@/lib/receipt/providers";
import type { CreateMessage } from "@/lib/menu/chat";
import { ANSWER_MAX_CHARS, type QuestionKind } from "./questions";

export interface TidyResult {
  text: string;
  score: number | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Sonnet 5.5 の単価（USD / 100万トークン）。設計書 (2) の仮定。変わったら直す */
const PRICE_IN = 3;
const PRICE_OUT = 15;

export function costOf(inputTokens: number, outputTokens: number): number {
  return Math.round(((inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1_000_000) * 1e6) / 1e6;
}

/** 回答の文字を受け付ける形に揃える（前後の空白・制御文字・長さ） */
export function normalizeRaw(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!t) return null;
  return t.slice(0, ANSWER_MAX_CHARS);
}

/** 満足度の数字（0〜10 の整数）として正しいか */
export function isScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10;
}

/**
 * AI を使わずに文から満足度を拾う（AI が使えないとき・AI が数字を返さなかったときの予備）。
 * 「7点」「満足度は8」「10です」などの最初の 0〜10。全角数字・漢数字の「十」も読む。
 */
export function guessScore(text: string): number | null {
  const t = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const kanji: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const m = t.match(/(?<![0-9])(10|[0-9])(?![0-9])\s*(点|てん)?/) ?? t.match(/([零一二三四五六七八九十])\s*点/);
  if (!m) return null;
  const v = /^[0-9]+$/.test(m[1]) ? Number(m[1]) : kanji[m[1]];
  return isScore(v) ? v : null;
}

const SYSTEM = [
  "あなたは家計簿アプリのアンケートの書記です。音声認識で文字にした回答を、読みやすい日本語に整えます。",
  "- 「えー」「あのー」「なんか」などのつなぎ言葉、言い直し、同じ語の繰り返しを除く",
  "- 音声認識の明らかな誤変換は、文脈から自然な語に直す（自信がなければそのまま）",
  "- 本人が言っていない内容・意見・感想を足さない。要約しすぎず、本人の言葉と言い回しを残す",
  "- 句読点を付け、です・ます調などの口調は本人のままにする",
  "- 設問の種類が satisfaction のときは、回答から満足度（0〜10 の整数）を読み取って score に入れる。言っていなければ null",
  "必ず save_answer ツールを1回だけ呼んで返す。",
].join("\n");

const TOOL: Anthropic.Tool = {
  name: "save_answer",
  description: "整えた回答と満足度を返す",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "整えた回答（日本語）" },
      score: { type: ["integer", "null"], minimum: 0, maximum: 10, description: "満足度 0〜10。satisfaction 以外は null" },
    },
    required: ["text", "score"],
  },
};

export async function tidyAnswer(opts: {
  question: string;
  kind: QuestionKind;
  raw: string;
  create: CreateMessage | null;
  model?: string;
}): Promise<TidyResult> {
  const fallback: TidyResult = {
    text: opts.raw,
    score: opts.kind === "satisfaction" ? guessScore(opts.raw) : null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
  if (!opts.create) return fallback;
  const model = toAnthropicModelId(opts.model);
  let res: Anthropic.Message;
  try {
    res = await opts.create({
      model,
      max_tokens: 800,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content: `設問（種類: ${opts.kind}）: ${opts.question}\n\n回答（音声認識の文字そのまま）:\n"""\n${opts.raw}\n"""`,
        },
      ],
    });
  } catch (e) {
    console.error("[survey] 整形の AI 呼び出しに失敗", e instanceof Error ? e.message : e);
    return fallback;
  }
  const inputTokens = res.usage?.input_tokens ?? 0;
  const outputTokens = res.usage?.output_tokens ?? 0;
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL.name);
  const input = (block?.input ?? {}) as { text?: unknown; score?: unknown };
  const text = normalizeRaw(input.text) ?? opts.raw;
  let score: number | null = null;
  if (opts.kind === "satisfaction") score = isScore(input.score) ? input.score : guessScore(text);
  return { text, score, model, inputTokens, outputTokens, costUsd: costOf(inputTokens, outputTokens) };
}
