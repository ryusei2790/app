/**
 * @file lib/receipt/providers/openrouter.ts
 * @description OpenRouter 経由で Gemini 3.1 Flash-Lite（既定）や GLM-4.6V を呼ぶアダプタ。
 *
 * 他人のレシートを送るので、OpenRouter の振り分け設定で次を必ず付ける（設計書 論点2）:
 *   - provider.order          … 使う提供元を固定（例: google-vertex）
 *   - provider.allow_fallbacks: false … 混んでいても他の提供元に回さない
 *   - provider.data_collection: "deny" … 入力を学習・保存する提供元を使わない
 * 利用者を識別する項目（user など）は送らない（P9）。
 * fetch を差し替えられるのはテストのため（本物の API に繋がずに応答の形を確かめる）。
 */

import type { ReceiptProvider } from "./types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function createOpenRouterProvider(opts: {
  apiKey: string;
  model: string;
  providerOrder?: string[];
  fetch?: typeof fetch;
}): ReceiptProvider {
  const doFetch = opts.fetch ?? fetch;
  return {
    name: "openrouter",
    model: opts.model,
    async read({ image, mediaType, prompt, signal }) {
      const res = await doFetch(ENDPOINT, {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${mediaType};base64,${toBase64(image)}` } },
              ],
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 2000,
          provider: {
            ...(opts.providerOrder?.length ? { order: opts.providerOrder } : {}),
            allow_fallbacks: false,
            data_collection: "deny",
          },
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}`); // 本文は返さない（中身をログに出さないため）
      const json = (await res.json()) as {
        model?: string;
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      return {
        text: json.choices?.[0]?.message?.content ?? "",
        model: opts.model,
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
          costUsd: json.usage?.cost,
        },
      };
    },
  };
}
