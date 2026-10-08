/**
 * @file lib/receipt/parser.ts
 * @description レシート読み取りの窓口。提供元を呼び、時間切れ・再試行・取り消しを扱い、応答を下書きにする。
 *
 * - 30秒で打ち切り、失敗したら1回だけ再試行（設計書 B3）
 * - 利用者が取り消した（接続を切った）ら、再試行せず cancelled（回数に数えない: L6）
 * - 失敗は ReceiptReadError（reason: provider_error / timeout / cancelled）で返し、route が手入力へ案内する（P6）
 * - 画像はメモリ上だけで扱い、どこにも保存・記録しない（P5）。例外にも画像や応答の中身を載せない
 */

import { RECEIPT_PROMPT } from "./prompt";
import { toDraft, type ReceiptDraft } from "./schema";
import type { ReceiptProvider, ReceiptUsageInfo } from "./providers/types";

export class ReceiptReadError extends Error {
  readonly name = "ReceiptReadError";
  constructor(readonly reason: "provider_error" | "timeout" | "cancelled") {
    super(`receipt read failed: ${reason}`);
  }
}

export interface ReadResult {
  draft: ReceiptDraft;
  model: string;
  usage: ReceiptUsageInfo;
}

export async function readReceipt(
  provider: ReceiptProvider,
  image: Uint8Array,
  mediaType: string,
  opts: { today: string; signal?: AbortSignal; timeoutMs?: number; retries?: number }
): Promise<ReadResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const retries = opts.retries ?? 1;

  let lastReason: ReceiptReadError["reason"] = "provider_error";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new ReceiptReadError("cancelled");
    // 1回ごとに「時間切れ」と「利用者の取り消し」のどちらでも止まる合図を作る
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    try {
      const out = await provider.read({ image, mediaType, prompt: RECEIPT_PROMPT, signal });
      return { draft: toDraft(out.text, opts.today), model: out.model, usage: out.usage };
    } catch {
      if (opts.signal?.aborted) throw new ReceiptReadError("cancelled");
      lastReason = timeout.aborted ? "timeout" : "provider_error";
    }
  }
  throw new ReceiptReadError(lastReason);
}
