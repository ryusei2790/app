/**
 * @file lib/receipt/providers/index.ts
 * @description 環境変数から使う提供元を選ぶ窓口（設計書 2-4）。
 *   RECEIPT_PARSER = mock（既定）| openrouter | anthropic
 *   RECEIPT_MODEL  = 例 anthropic/claude-haiku-5.5（openrouter）、claude-haiku-5-5（anthropic）
 *   RECEIPT_PROVIDER_ORDER = OpenRouter で固定する提供元（カンマ区切り。例 anthropic）
 * 鍵が無い・本番でモックのまま、のような設定ミスは、黙って失敗させずにここで止める。
 */

import { createAnthropicProvider } from "./anthropic";
import { createMockProvider } from "./mock";
import { createOpenRouterProvider } from "./openrouter";
import type { ReceiptProvider } from "./types";

type Env = Record<string, string | undefined>;

/**
 * RECEIPT_MODEL が OpenRouter 形式（anthropic/claude-haiku-5.5）のまま anthropic に切り替えても動くよう、
 * Anthropic の ID（claude-haiku-5-5）に直す。未設定なら Haiku 5.5。
 */
export function toAnthropicModelId(model: string | undefined): string {
  if (!model) return "claude-haiku-5-5";
  if (!model.startsWith("anthropic/")) return model;
  return model.slice("anthropic/".length).replace(/\./g, "-");
}

export function getReceiptProvider(env: Env = process.env): ReceiptProvider {
  const kind = env.RECEIPT_PARSER ?? (env.NODE_ENV === "production" ? undefined : "mock");
  switch (kind) {
    case "mock":
      return createMockProvider();
    case "openrouter":
      if (!env.OPENROUTER_API_KEY) throw new Error("RECEIPT_PARSER=openrouter には OPENROUTER_API_KEY が必要です");
      return createOpenRouterProvider({
        apiKey: env.OPENROUTER_API_KEY,
        model: env.RECEIPT_MODEL ?? "anthropic/claude-haiku-5.5",
        providerOrder: (env.RECEIPT_PROVIDER_ORDER ?? "anthropic").split(",").map((s) => s.trim()).filter(Boolean),
      });
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) throw new Error("RECEIPT_PARSER=anthropic には ANTHROPIC_API_KEY が必要です");
      return createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: toAnthropicModelId(env.RECEIPT_MODEL) });
    default:
      throw new Error("RECEIPT_PARSER を mock / openrouter / anthropic のどれかに設定してください");
  }
}
