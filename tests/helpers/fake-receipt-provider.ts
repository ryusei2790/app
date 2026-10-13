/**
 * @file tests/helpers/fake-receipt-provider.ts
 * @description レシート API のテスト用の「偽の AI 提供元」。
 * 使い方（テストファイルの先頭）:
 *   vi.mock("@/lib/receipt/providers", () => import("../helpers/fake-receipt-provider"));
 * fakeReceipt.next で次の応答（JSON 文字列／失敗）を決め、fakeReceipt.calls で送られた中身を確かめる（P9）。
 */

import type { ReceiptProvider, ReceiptProviderInput } from "@/lib/receipt/providers/types";

type Next = { kind: "text"; text: string } | { kind: "error" };

export const fakeReceipt: { next: Next; calls: Omit<ReceiptProviderInput, "signal">[] } = {
  next: { kind: "error" },
  calls: [],
};

export function getReceiptProvider(): ReceiptProvider {
  return {
    name: "fake",
    model: "fake-model",
    async read(input) {
      const { signal: _signal, ...rest } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
      fakeReceipt.calls.push(rest);
      if (fakeReceipt.next.kind === "error") throw new Error("provider down");
      return { text: fakeReceipt.next.text, model: "fake-model", usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}
