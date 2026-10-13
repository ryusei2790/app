/**
 * @file lib/receipt/schema.ts
 * @description AI が返したレシートの読み取り結果を検査し、取引の「下書き」にする（テスト一覧 P1・P2・P3・P7）。
 *
 * AI の応答は信用しない前提で扱う。どの提供元（Gemini / Haiku / GLM / モック）でも同じ関数を通すので、
 * モデルを替えても画面に出る下書きの形と警告は変わらない（P10）。
 *
 * 下書きの status:
 *   ok           … そのまま保存してよさそう（それでも保存は利用者が押したときだけ: P8）
 *   needs_review … 読めない・欠けている・合計が合わない等。印の付いた所を直してもらう（P2・P3）
 *   unsupported  … 外貨・日本語以外・レシートでない（Phase 1 の対象外: P7）
 */

import { z } from "zod";
import { parseDateOnly } from "@/lib/validation/transaction";
import { addDays } from "@/lib/fixed-costs/schedule";

/** AI に返してほしい JSON の形（prompt.ts の指示と、Anthropic の構造化出力にも使う） */
export const ReceiptAiResultSchema = z.object({
  is_receipt: z.boolean(),
  currency: z.string(),
  language: z.string(),
  merchant: z.string().nullable(),
  purchased_at: z.string().nullable(),
  total: z.number().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      amount: z.number(),
    })
  ),
});

export type ReceiptAiResult = z.infer<typeof ReceiptAiResultSchema>;

export type WarningCode =
  | "ai_invalid"
  | "missing_merchant"
  | "missing_date"
  | "missing_total"
  | "total_not_positive"
  | "date_out_of_range"
  | "items_total_mismatch"
  | "not_receipt"
  | "foreign_currency"
  | "non_japanese";

export interface DraftWarning {
  code: WarningCode;
  message: string;
}

export interface DraftItem {
  name: string;
  quantity: number | null;
  amount: number;
}

export interface ReceiptDraft {
  status: "ok" | "needs_review" | "unsupported";
  merchant: string | null;
  date: string | null;
  total: number | null;
  items: DraftItem[];
  warnings: DraftWarning[];
}

/** 受け付ける購入日の範囲: 1年前〜明日（明日は日付の変わり目のずれを許すため） */
const OLDEST_DAYS = 365;
const NEWEST_DAYS = 1;

/** 応答の文字列から JSON 部分を取り出す（```json …``` や前置きの文が付いていても読む） */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON が見つからない");
  return JSON.parse(raw.slice(start, end + 1));
}

const empty = (warnings: DraftWarning[], status: ReceiptDraft["status"]): ReceiptDraft => ({
  status,
  merchant: null,
  date: null,
  total: null,
  items: [],
  warnings,
});

/**
 * AI の応答（文字列）→ 下書き。
 * @param today JST の今日 "YYYY-MM-DD"（日付の範囲チェック用。テストで固定できるよう引数で受ける）
 */
export function toDraft(raw: string, today: string): ReceiptDraft {
  // 1. JSON として読めて、形が合っているか
  let parsed: ReceiptAiResult;
  try {
    const r = ReceiptAiResultSchema.safeParse(extractJson(raw));
    if (!r.success) throw new Error("形が違う");
    parsed = r.data;
  } catch {
    return empty([{ code: "ai_invalid", message: "読み取り結果を解釈できませんでした。内容を入力してください。" }], "needs_review");
  }

  // 2. Phase 1 の対象外（レシートでない・外貨・日本語以外）
  const unsupported: DraftWarning[] = [];
  if (!parsed.is_receipt) unsupported.push({ code: "not_receipt", message: "レシートの写真ではないようです（対象外）。" });
  if (parsed.currency.toUpperCase() !== "JPY") {
    unsupported.push({ code: "foreign_currency", message: "日本円以外のレシートは今は対象外です。手入力で登録してください。" });
  }
  if (parsed.language.toLowerCase() !== "ja") {
    unsupported.push({ code: "non_japanese", message: "日本語以外のレシートは今は対象外です。手入力で登録してください。" });
  }
  if (unsupported.length > 0) return empty(unsupported, "unsupported");

  // 3. 項目ごとの確認。おかしい所には印（警告）を付け、値は読めた分だけ残す
  const warnings: DraftWarning[] = [];
  const merchant = parsed.merchant?.trim() || null;
  if (!merchant) warnings.push({ code: "missing_merchant", message: "店名を読み取れませんでした。" });

  let date: string | null = null;
  if (!parsed.purchased_at) {
    warnings.push({ code: "missing_date", message: "日付を読み取れませんでした。" });
  } else {
    const d = parseDateOnly(parsed.purchased_at);
    if (d.ok && d.value >= addDays(today, -OLDEST_DAYS) && d.value <= addDays(today, NEWEST_DAYS)) {
      date = d.value;
    } else {
      warnings.push({ code: "date_out_of_range", message: `日付「${parsed.purchased_at}」が正しくなさそうです。確認してください。` });
    }
  }

  let total: number | null = null;
  if (parsed.total === null) {
    warnings.push({ code: "missing_total", message: "合計金額を読み取れませんでした。" });
  } else if (!Number.isInteger(parsed.total) || parsed.total <= 0) {
    warnings.push({ code: "total_not_positive", message: "合計金額が正しくなさそうです（1円以上の整数ではありません）。" });
  } else {
    total = parsed.total;
  }

  const items: DraftItem[] = parsed.items.map((i) => ({ name: i.name, quantity: i.quantity, amount: i.amount }));

  // 4. 明細の和と合計の照合（P3）。明細が無いときは照合しない
  if (total !== null && items.length > 0) {
    const sum = items.reduce((s, i) => s + i.amount, 0);
    if (sum !== total) {
      warnings.push({
        code: "items_total_mismatch",
        message: `明細の合計（${sum.toLocaleString("ja-JP")}円）と合計金額（${total.toLocaleString("ja-JP")}円）が合いません。値引き・税の行を確認してください。`,
      });
    }
  }

  return { status: warnings.length > 0 ? "needs_review" : "ok", merchant, date, total, items, warnings };
}
