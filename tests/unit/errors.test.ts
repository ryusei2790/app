/**
 * @file tests/unit/errors.test.ts
 * @description API・通信の失敗を日本語の言葉にする部品のテスト（mywork#764 ③）。
 * E1: 500 は中身が空でも「サーバーで問題」 E2: 入力の誤りは API の言葉 E3: 401/404/429
 * E4: fetch の失敗（TypeError）は「通信できません」 E5: JSON の読み違いは英語を出さない
 */

import { describe, expect, it } from "vitest";
import { MESSAGES, apiErrorMessage, errorMessage } from "@/lib/errors/api-error";
import { NOT_FOUND, SCREEN_ERROR } from "@/lib/errors/screen";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("apiErrorMessage", () => {
  it("E1: 500 は中身が空・HTML でもサーバーの問題として言う（API の英語の言葉も出さない）", async () => {
    expect(await apiErrorMessage(new Response("", { status: 500 }), "読み込みに失敗しました")).toBe(MESSAGES.server);
    expect(await apiErrorMessage(new Response("<html>", { status: 502 }), "x")).toBe(MESSAGES.server);
    expect(await apiErrorMessage(json(500, { error: { message: "PrismaClientKnownRequestError" } }), "x")).toBe(
      MESSAGES.server
    );
  });

  it("E2: 4xx で API が言葉を返していればそれを出し、無ければ画面ごとの言葉", async () => {
    expect(await apiErrorMessage(json(422, { error: { message: "金額は1以上にしてください" } }), "保存に失敗しました")).toBe(
      "金額は1以上にしてください"
    );
    expect(await apiErrorMessage(new Response("", { status: 400 }), "保存に失敗しました")).toBe("保存に失敗しました");
  });

  it("E3: 401 はログインし直し、404・429 は次の一手を言う", async () => {
    expect(await apiErrorMessage(json(401, { error: { message: "認証が必要です" } }), "x")).toBe(MESSAGES.unauthorized);
    expect(await apiErrorMessage(new Response("", { status: 404 }), "x")).toBe(MESSAGES.notFound);
    expect(await apiErrorMessage(new Response("", { status: 429 }), "x")).toBe(MESSAGES.tooMany);
  });
});

describe("errorMessage", () => {
  it("E4: fetch 自体の失敗（圏外など）は通信の言葉", () => {
    expect(errorMessage(new TypeError("Failed to fetch"), "x")).toBe(MESSAGES.network);
    expect(errorMessage(new TypeError("Load failed"), "x")).toBe(MESSAGES.network);
  });

  it("E5: JSON の読み違いは英語を出さず、自分で投げた日本語はそのまま", () => {
    expect(errorMessage(new SyntaxError("Unexpected end of JSON input"), "x")).toBe(MESSAGES.server);
    expect(errorMessage(new Error("削除に失敗しました"), "x")).toBe("削除に失敗しました");
    expect(errorMessage("?", "読み込みに失敗しました")).toBe("読み込みに失敗しました");
  });

  it("E6: 言葉はすべて日本語で、次にすることが書いてある", () => {
    for (const m of [...Object.values(MESSAGES), SCREEN_ERROR.message, NOT_FOUND.message]) {
      expect(m).toMatch(/[ぁ-んァ-ン一-龥]/);
      expect(m).not.toMatch(/error|failed|undefined/i);
    }
    expect(SCREEN_ERROR.message).toContain("消えていません");
  });
});
