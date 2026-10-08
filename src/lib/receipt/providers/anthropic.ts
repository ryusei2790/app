/**
 * @file lib/receipt/providers/anthropic.ts
 * @description Anthropic の API（Claude Haiku）を直接呼ぶアダプタ。OpenRouter が使えないときの逃げ道と、精度比較（G）用。
 * 公式 SDK（@anthropic-ai/sdk）の messages.parse に、schema.ts と同じ形の構造化出力（zodOutputFormat）を指定する。
 * 応答の検査はほかの提供元と同じく schema.ts の toDraft で行うので、ここでは本文（JSON の文字列）をそのまま返す。
 * 利用者の情報（metadata.user_id など）は送らない（P9）。fetch を差し替えられるのはテストのため。
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ReceiptAiResultSchema } from "../schema";
import type { ReceiptProvider } from "./types";

export function createAnthropicProvider(opts: { apiKey: string; model: string; fetch?: typeof fetch }): ReceiptProvider {
  // 再試行は lib/receipt/parser.ts で1回だけ行うので、SDK 側の自動再試行は切る（二重に待たない）
  const client = new Anthropic({ apiKey: opts.apiKey, fetch: opts.fetch, maxRetries: 0 });
  return {
    name: "anthropic",
    model: opts.model,
    async read({ image, mediaType, prompt, signal }) {
      const response = await client.messages.parse(
        {
          model: opts.model,
          max_tokens: 2000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
                    data: Buffer.from(image).toString("base64"),
                  },
                },
                { type: "text", text: prompt },
              ],
            },
          ],
          output_config: { format: zodOutputFormat(ReceiptAiResultSchema) },
        },
        { signal }
      );
      const text = response.content.find((b) => b.type === "text");
      return {
        text: text && text.type === "text" ? text.text : "",
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
  };
}
