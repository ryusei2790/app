/**
 * @file tests/unit/survey.test.ts
 * @description 月1回のアンケート（mywork#1150 第3弾）。固定5問・回答の文字の受け付け・満足度の読み取り・
 * AI 整形（tool use の返事の読み方、失敗時はそのまま返す、AI に金額などを渡さない）・費用の計算。AI と音声認識はモック。
 */

import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { FIXED_QUESTIONS, ANSWER_MAX_CHARS } from "@/lib/survey/questions";
import { costOf, guessScore, isScore, normalizeRaw, tidyAnswer } from "@/lib/survey/tidy";
import { getRecognitionCtor, speechErrorMessage } from "@/lib/survey/speech";
import type { CreateMessage } from "@/lib/menu/chat";

function toolReply(input: unknown): Anthropic.Message {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "tool_use", id: "t", name: "save_answer", input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 800, output_tokens: 200 },
  } as unknown as Anthropic.Message;
}

describe("固定5問", () => {
  it("5問で、1問目は満足度・位置は1〜5", () => {
    expect(FIXED_QUESTIONS).toHaveLength(5);
    expect(FIXED_QUESTIONS[0].kind).toBe("satisfaction");
    expect(FIXED_QUESTIONS.map((q) => q.position)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("回答の文字", () => {
  it("空・文字列以外は null、前後空白と制御文字を除き上限で切る", () => {
    expect(normalizeRaw("")).toBeNull();
    expect(normalizeRaw("   ")).toBeNull();
    expect(normalizeRaw(3)).toBeNull();
    expect(normalizeRaw(" a\u0000b ")).toBe("ab");
    expect(normalizeRaw("あ".repeat(5000))!.length).toBe(ANSWER_MAX_CHARS);
  });
  it("満足度は 0〜10 の整数だけ", () => {
    expect(isScore(0)).toBe(true);
    expect(isScore(10)).toBe(true);
    expect(isScore(11)).toBe(false);
    expect(isScore(7.5)).toBe(false);
    expect(isScore("7")).toBe(false);
  });
  it("文から満足度を拾う（半角・全角・漢数字）", () => {
    expect(guessScore("7点です")).toBe(7);
    expect(guessScore("満足度は１０かな")).toBe(10);
    expect(guessScore("八点くらい")).toBe(8);
    expect(guessScore("まあまあです")).toBeNull();
    expect(guessScore("100円")).toBeNull();
  });
  it("費用は Sonnet の単価で計算（800+200 トークン ≒ 0.0054 USD）", () => {
    expect(costOf(800, 200)).toBeCloseTo(0.0054, 6);
  });
});

describe("AI で整える", () => {
  it("tool use の text と score を使い、設問と回答だけを渡す", async () => {
    const create = vi.fn<CreateMessage>(async () => toolReply({ text: "7点です。レシートが便利でした。", score: 7 }));
    const r = await tidyAnswer({ question: "満足度は？", kind: "satisfaction", raw: "えーと7点かな レシートが便利", create });
    expect(r).toMatchObject({ text: "7点です。レシートが便利でした。", score: 7, model: "claude-sonnet-5-5", inputTokens: 800, outputTokens: 200 });
    const params = create.mock.calls[0][0];
    expect(params.tool_choice).toEqual({ type: "tool", name: "save_answer" });
    expect(JSON.stringify(params.messages)).toContain("えーと7点かな");
  });
  it("満足度以外の設問は score を捨てる", async () => {
    const create: CreateMessage = async () => toolReply({ text: "カレンダー", score: 5 });
    const r = await tidyAnswer({ question: "Q2", kind: "fixed", raw: "カレンダー", create });
    expect(r.score).toBeNull();
  });
  it("AI が範囲外の score を返したら文から拾い直す", async () => {
    const create: CreateMessage = async () => toolReply({ text: "6点", score: 99 });
    const r = await tidyAnswer({ question: "Q1", kind: "satisfaction", raw: "6点", create });
    expect(r.score).toBe(6);
  });
  it("AI が無い・失敗したら文字をそのまま返す（回答は止めない）", async () => {
    const none = await tidyAnswer({ question: "Q1", kind: "satisfaction", raw: "9点", create: null });
    expect(none).toMatchObject({ text: "9点", score: 9, model: null, costUsd: 0 });
    const boom: CreateMessage = async () => {
      throw new Error("down");
    };
    const failed = await tidyAnswer({ question: "Q2", kind: "fixed", raw: "そのまま", create: boom });
    expect(failed).toMatchObject({ text: "そのまま", model: null });
  });
  it("AI の text が空なら元の文字", async () => {
    const create: CreateMessage = async () => toolReply({ text: "  ", score: null });
    const r = await tidyAnswer({ question: "Q2", kind: "fixed", raw: "元の文", create });
    expect(r.text).toBe("元の文");
  });
});

describe("音声認識", () => {
  it("使えないブラウザでは null（画面は文字入力だけにする）", () => {
    expect(getRecognitionCtor({})).toBeNull();
    expect(getRecognitionCtor(undefined)).toBeNull();
    class R {}
    expect(getRecognitionCtor({ webkitSpeechRecognition: R })).toBe(R);
  });
  it("マイク拒否は文字で答える案内", () => {
    expect(speechErrorMessage("not-allowed")).toContain("文字で答える");
  });
});
