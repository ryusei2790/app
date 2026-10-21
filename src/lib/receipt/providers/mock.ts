/**
 * @file lib/receipt/providers/mock.ts
 * @description ローカル開発・テスト用の偽の提供元（RECEIPT_PARSER=mock、既定）。お金がかからない。
 * 画像の中身に関係なく、架空のレシート（tests/fixtures/receipts/normal.json と同じ内容）を返す。
 */

import type { ReceiptProvider } from "./types";

const SAMPLE = {
  is_receipt: true,
  currency: "JPY",
  language: "ja",
  merchant: "ファミリーマート 青山店",
  purchased_at: "2026-10-07",
  total: 598,
  tax_mode: "inclusive",
  tax_lines: [],
  items: [
    { name: "おにぎり 鮭", quantity: 1, unit_price: null, amount: 160, tax_rate: 8, category: "食費" },
    { name: "からあげクン", quantity: 1, unit_price: null, amount: 238, tax_rate: 8, category: "食費" },
    { name: "お茶 500ml", quantity: 1, unit_price: null, amount: 200, tax_rate: 8, category: "食費" },
  ],
};

export function createMockProvider(): ReceiptProvider {
  return {
    name: "mock",
    model: "mock",
    async read() {
      return { text: JSON.stringify(SAMPLE), model: "mock", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    },
  };
}
