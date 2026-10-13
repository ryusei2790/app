/**
 * @file lib/receipt/providers/types.ts
 * @description レシート読み取りの「提供元アダプタ」の共通の形（テスト一覧 P10）。
 * アダプタは画像と指示文を受け取り、AI の応答（JSON の文字列）と使用量を返すだけ。
 * 応答の検査・下書き作りは提供元に関係なく lib/receipt/schema.ts で行う。
 * 入力に利用者の情報を入れる口は無い（P9）。
 */

export interface ReceiptProviderInput {
  image: Uint8Array;
  mediaType: string;
  prompt: string;
  /** 時間切れ・利用者の取り消しで中断するための合図 */
  signal?: AbortSignal;
}

export interface ReceiptUsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  /** 提供元が費用を返すとき（OpenRouter の usage.cost）だけ */
  costUsd?: number;
}

export interface ReceiptProviderOutput {
  text: string;
  model: string;
  usage: ReceiptUsageInfo;
}

export interface ReceiptProvider {
  name: string;
  model: string;
  read(input: ReceiptProviderInput): Promise<ReceiptProviderOutput>;
}
