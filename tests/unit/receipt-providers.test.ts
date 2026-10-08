/**
 * @file tests/unit/receipt-providers.test.ts
 * @description テスト一覧 D のうち、AI 提供元のアダプタ（P10）と送る中身（P9）・失敗時（P6 の部品）の単体テスト。
 * 本物の API には繋がない。各アダプタに「偽の fetch」を渡し、提供元ごとの応答の形を返させる。
 * どの提供元でも同じ下書きになれば、モデルを差し替えてもアプリ側は変わらない（P10）。
 */

import { describe, expect, it } from "vitest";
import normal from "../fixtures/receipts/normal.json";
import { createOpenRouterProvider } from "@/lib/receipt/providers/openrouter";
import { createAnthropicProvider } from "@/lib/receipt/providers/anthropic";
import { createMockProvider } from "@/lib/receipt/providers/mock";
import { getReceiptProvider } from "@/lib/receipt/providers";
import { readReceipt, ReceiptReadError } from "@/lib/receipt/parser";
import type { ReceiptProvider } from "@/lib/receipt/providers/types";

const TODAY = "2026-10-08";
const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const RECEIPT_JSON = JSON.stringify(normal);

type Captured = { url: string; body: Record<string, unknown>; headers: Headers };

/** 呼ばれた中身を記録し、決まった応答を返す偽の fetch */
function fakeFetch(respond: () => unknown, captured: Captured[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input instanceof Request ? input.url : input),
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify(respond()), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const openRouterReply = () => ({
  id: "gen-1",
  model: "x",
  choices: [{ index: 0, message: { role: "assistant", content: RECEIPT_JSON }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1200, completion_tokens: 150, cost: 0.0002 },
});

const anthropicReply = () => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text: RECEIPT_JSON }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1300, output_tokens: 160 },
});

describe("P10 提供元はアダプタ経由。差し替えても同じ下書き", () => {
  const cases: [string, (c: Captured[]) => ReceiptProvider][] = [
    ["Gemini（OpenRouter）", (c) =>
      createOpenRouterProvider({ apiKey: "k", model: "google/gemini-3.1-flash-lite", providerOrder: ["google-vertex"], fetch: fakeFetch(openRouterReply, c) })],
    ["GLM（OpenRouter）", (c) =>
      createOpenRouterProvider({ apiKey: "k", model: "z-ai/glm-4.6v", providerOrder: ["z-ai"], fetch: fakeFetch(openRouterReply, c) })],
    ["Haiku（Anthropic）", (c) =>
      createAnthropicProvider({ apiKey: "k", model: "claude-haiku-4-5", fetch: fakeFetch(anthropicReply, c) })],
    ["モック", () => createMockProvider()],
  ];

  it.each(cases)("%s", async (_name, make) => {
    const captured: Captured[] = [];
    const r = await readReceipt(make(captured), IMAGE, "image/jpeg", { today: TODAY });
    expect(r.draft).toMatchObject({ status: "ok", merchant: "ファミリーマート 青山店", total: 598, date: "2026-10-07" });
    expect(r.model).toBeTruthy();
  });

  it("OpenRouter には提供元を固定し、他へ回さず、学習・保存する提供元を使わない設定で送る", async () => {
    const captured: Captured[] = [];
    const p = createOpenRouterProvider({
      apiKey: "k", model: "google/gemini-3.1-flash-lite", providerOrder: ["google-vertex"], fetch: fakeFetch(openRouterReply, captured),
    });
    const r = await readReceipt(p, IMAGE, "image/jpeg", { today: TODAY });
    expect(captured[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(captured[0].body.provider).toEqual({ order: ["google-vertex"], allow_fallbacks: false, data_collection: "deny" });
    expect(captured[0].headers.get("authorization")).toBe("Bearer k");
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 150, costUsd: 0.0002 });
  });

  it("Anthropic には画像（base64）と指示文だけを送り、トークン数を受け取る", async () => {
    const captured: Captured[] = [];
    const p = createAnthropicProvider({ apiKey: "k", model: "claude-haiku-4-5", fetch: fakeFetch(anthropicReply, captured) });
    const r = await readReceipt(p, IMAGE, "image/jpeg", { today: TODAY });
    expect(captured[0].url).toMatch(/\/v1\/messages$/);
    expect(captured[0].body.model).toBe("claude-haiku-4-5");
    expect(r.usage).toMatchObject({ inputTokens: 1300, outputTokens: 160 });
  });
});

describe("P9 AI に個人情報を送らない", () => {
  it.each([
    ["OpenRouter", (c: Captured[]) => createOpenRouterProvider({ apiKey: "k", model: "m", fetch: fakeFetch(openRouterReply, c) })],
    ["Anthropic", (c: Captured[]) => createAnthropicProvider({ apiKey: "k", model: "claude-haiku-4-5", fetch: fakeFetch(anthropicReply, c) })],
  ])("%s への送信に user・metadata（利用者の識別子）を付けない", async (_n, make) => {
    const captured: Captured[] = [];
    await readReceipt(make(captured), IMAGE, "image/jpeg", { today: TODAY });
    const body = captured[0].body;
    expect(body).not.toHaveProperty("user");
    expect(body).not.toHaveProperty("metadata");
    expect(JSON.stringify(body)).not.toMatch(/@|user_id|email/i);
  });
});

describe("P6 の部品: 失敗・時間切れ", () => {
  it("提供元が失敗し続けたら1回だけ再試行して ReceiptReadError（理由 provider_error）", async () => {
    let calls = 0;
    const p: ReceiptProvider = {
      name: "broken", model: "m",
      async read() { calls++; throw new Error("500 from provider"); },
    };
    await expect(readReceipt(p, IMAGE, "image/jpeg", { today: TODAY })).rejects.toMatchObject({
      name: "ReceiptReadError", reason: "provider_error",
    });
    expect(calls).toBe(2);
  });

  it("時間切れは理由 timeout", async () => {
    const p: ReceiptProvider = {
      name: "slow", model: "m",
      read: ({ signal }) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
    };
    const err = await readReceipt(p, IMAGE, "image/jpeg", { today: TODAY, timeoutMs: 20, retries: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(ReceiptReadError);
    expect(err.reason).toBe("timeout");
  });

  it("利用者が取り消したら理由 cancelled で、再試行しない", async () => {
    let calls = 0;
    const ac = new AbortController();
    const p: ReceiptProvider = {
      name: "slow", model: "m",
      read: ({ signal }) => {
        calls++;
        return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));
      },
    };
    setTimeout(() => ac.abort(), 10);
    const err = await readReceipt(p, IMAGE, "image/jpeg", { today: TODAY, signal: ac.signal }).catch((e) => e);
    expect(err.reason).toBe("cancelled");
    expect(calls).toBe(1);
  });
});

describe("提供元の選び方（環境変数）", () => {
  it("RECEIPT_PARSER 未設定・mock はモック", () => {
    expect(getReceiptProvider({}).name).toBe("mock");
    expect(getReceiptProvider({ RECEIPT_PARSER: "mock" }).name).toBe("mock");
  });

  it("openrouter / anthropic は鍵が無ければ使えない（設定ミスで黙って失敗しない）", () => {
    expect(() => getReceiptProvider({ RECEIPT_PARSER: "openrouter" })).toThrow(/OPENROUTER_API_KEY/);
    expect(() => getReceiptProvider({ RECEIPT_PARSER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(getReceiptProvider({ RECEIPT_PARSER: "openrouter", OPENROUTER_API_KEY: "k" }).name).toBe("openrouter");
  });

  it("本番（NODE_ENV=production）でモックのままなら止める", () => {
    expect(() => getReceiptProvider({ NODE_ENV: "production" })).toThrow(/RECEIPT_PARSER/);
  });
});
