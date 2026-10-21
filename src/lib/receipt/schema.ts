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
import { RECEIPT_CATEGORIES, type ReceiptCategory } from "./categories";

/** AI に返してほしい JSON の形（prompt.ts の指示と、Anthropic の構造化出力にも使う） */
export const ReceiptAiResultSchema = z.object({
  is_receipt: z.boolean(),
  currency: z.string(),
  language: z.string(),
  merchant: z.string().nullable(),
  purchased_at: z.string().nullable(),
  total: z.number().nullable(),
  tax_mode: z.enum(["inclusive", "exclusive", "unknown"]),
  tax_lines: z.array(z.object({ rate: z.number(), amount: z.number() })),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      unit_price: z.number().nullable(),
      amount: z.number(),
      tax_rate: z.number().nullable(),
      category: z.enum(RECEIPT_CATEGORIES),
    })
  ),
});

export type ReceiptAiResult = z.infer<typeof ReceiptAiResultSchema>;

/**
 * 受け取るときの形。AI には上の形を必ず返させるが、提供元によっては欄が欠けるので、
 * 税・単価・カテゴリの欄は無くても読む（欠けたら「内税扱い」「未分類」）。
 */
const ReceiptAiInputSchema = ReceiptAiResultSchema.extend({
  tax_mode: ReceiptAiResultSchema.shape.tax_mode.catch("unknown"),
  tax_lines: ReceiptAiResultSchema.shape.tax_lines.catch([]),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      unit_price: z.number().nullable().catch(null),
      amount: z.number(),
      tax_rate: z.number().nullable().catch(null),
      category: z.enum(RECEIPT_CATEGORIES).nullable().catch(null),
    })
  ),
});

export type WarningCode =
  | "ai_invalid"
  | "missing_merchant"
  | "missing_date"
  | "missing_total"
  | "total_not_positive"
  | "date_out_of_range"
  | "items_total_mismatch"
  | "item_unit_mismatch"
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
  unitPrice: number | null;
  /** 税込の金額（内税ならレシートの印字どおり、外税なら税を按分して足した額）。集計・仕分けはこの額 */
  amount: number;
  /** レシートに印字された金額（外税なら税抜） */
  printedAmount: number;
  taxRate: number | null;
  category: ReceiptCategory | null;
  /** 数量×単価が金額と合わない行（読み違いの疑い） */
  unitMismatch: boolean;
}

export interface ReceiptDraft {
  status: "ok" | "needs_review" | "unsupported";
  merchant: string | null;
  date: string | null;
  total: number | null;
  /** 外税のレシートで、明細に税を按分したか */
  taxAllocated: boolean;
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
  taxAllocated: false,
  items: [],
  warnings,
});

/**
 * 外税のレシート: 税率ごとの税額を、その税率の明細に金額の比で按分して税込額にする。
 * 端数はその税率の最後の行で調整する（税率ごとの和が税額と1円単位で一致する）。
 * 税率が読めない行は、税の行が1つだけならその税率とみなす。当てはめられない税額は按分しない。
 */
export function allocateTax(
  items: { amount: number; taxRate: number | null }[],
  taxLines: { rate: number; amount: number }[]
): number[] {
  const out = items.map((i) => i.amount);
  const onlyRate = taxLines.length === 1 ? taxLines[0].rate : null;
  for (const line of taxLines) {
    const idx = items.map((_, k) => k).filter((k) => (items[k].taxRate ?? onlyRate) === line.rate);
    const base = idx.reduce((s, k) => s + items[k].amount, 0);
    if (idx.length === 0 || base <= 0) continue;
    let given = 0;
    idx.forEach((k, n) => {
      const share = n === idx.length - 1 ? line.amount - given : Math.floor((line.amount * items[k].amount) / base);
      given += share;
      out[k] += share;
    });
  }
  return out;
}

/**
 * AI の応答（文字列）→ 下書き。
 * @param today JST の今日 "YYYY-MM-DD"（日付の範囲チェック用。テストで固定できるよう引数で受ける）
 */
export function toDraft(raw: string, today: string): ReceiptDraft {
  // 1. JSON として読めて、形が合っているか
  let parsed: ReceiptAiResult;
  try {
    const r = ReceiptAiInputSchema.safeParse(extractJson(raw));
    if (!r.success) throw new Error("形が違う");
    parsed = r.data as ReceiptAiResult;
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

  // 外税なら、税の行を明細に按分して税込にする（明細の和＋税額 = 合計 で照合できるように）
  const taxLines = parsed.tax_lines.filter((t) => Number.isInteger(t.amount) && t.amount > 0);
  const taxAllocated = parsed.tax_mode === "exclusive" && taxLines.length > 0;
  const withTax = taxAllocated
    ? allocateTax(parsed.items.map((i) => ({ amount: i.amount, taxRate: i.tax_rate })), taxLines)
    : parsed.items.map((i) => i.amount);

  const items: DraftItem[] = parsed.items.map((i, k) => ({
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unit_price,
    amount: withTax[k],
    printedAmount: i.amount,
    taxRate: i.tax_rate,
    category: i.category,
    unitMismatch: i.quantity !== null && i.unit_price !== null && i.amount > 0 && i.quantity * i.unit_price !== i.amount,
  }));

  const odd = items.filter((i) => i.unitMismatch);
  if (odd.length > 0) {
    warnings.push({
      code: "item_unit_mismatch",
      message: `数量×単価と金額が合わない明細があります（${odd.map((i) => i.name).join("、")}）。確認してください。`,
    });
  }

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

  return { status: warnings.length > 0 ? "needs_review" : "ok", merchant, date, total, taxAllocated, items, warnings };
}
