/**
 * @file lib/validation/receipt.ts
 * @description レシートの「保存」（POST /api/v1/receipts）の入力ルール（テスト一覧 P8）。
 * 利用者が確認・修正した値を検査する。AI の読み取り結果ではなく、この値だけが取引になる。
 * - 合計: 1円以上の整数円（取引と同じ parseYenAmount）
 * - 日付: 実在する YYYY-MM-DD
 * - 店名: 1〜200文字
 * - 明細: 最大200行。各行の金額は整数円（値引きの行は負の数も可）。category_id は任意（あればカテゴリごとに取引を分ける: mywork#229）
 */

import { MAX_YEN, parseDateOnly, parseYenAmount, type Parsed } from "./transaction";

export interface ReceiptInput {
  transactionDate: string;
  total: number;
  merchant: string;
  items: { name: string; quantity: number | null; amount: number; category_id: string | null }[];
  model: string | null;
}

const MAX_ITEMS = 200;
const fail = (message: string) => ({ ok: false as const, message });

export function parseReceiptInput(body: Record<string, unknown>): Parsed<ReceiptInput> {
  const date = parseDateOnly(body.transaction_date);
  if (!date.ok) return date;
  const total = parseYenAmount(body.total);
  if (!total.ok) return total;

  if (typeof body.merchant !== "string" || body.merchant.trim() === "" || body.merchant.length > 200) {
    return fail("店名は1〜200文字で入力してください");
  }

  const rawItems = body.items ?? [];
  if (!Array.isArray(rawItems) || rawItems.length > MAX_ITEMS) return fail(`明細は${MAX_ITEMS}行までの配列で指定してください`);
  const items: ReceiptInput["items"] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== "object") return fail("明細の形が正しくありません");
    const { name, quantity, amount, category_id } = it as Record<string, unknown>;
    if (typeof name !== "string" || name.length > 200) return fail("明細の品名が正しくありません");
    if (quantity !== null && quantity !== undefined && (typeof quantity !== "number" || !Number.isFinite(quantity))) {
      return fail("明細の数量が正しくありません");
    }
    if (typeof amount !== "number" || !Number.isInteger(amount) || Math.abs(amount) > MAX_YEN) {
      return fail("明細の金額は整数の円で指定してください");
    }
    if (category_id !== null && category_id !== undefined && category_id !== "" && typeof category_id !== "string") {
      return fail("明細のカテゴリが正しくありません");
    }
    items.push({ name, quantity: (quantity as number | null | undefined) ?? null, amount, category_id: (category_id as string | undefined) || null });
  }

  const model = typeof body.model === "string" && body.model.length <= 100 ? body.model : null;
  return { ok: true, value: { transactionDate: date.value, total: total.value, merchant: body.merchant.trim(), items, model } };
}
