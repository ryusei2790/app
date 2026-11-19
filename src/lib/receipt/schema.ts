/**
 * @file lib/receipt/schema.ts
 * @description AI が返したレシートの読み取り結果を検査し、取引の「下書き」にする（テスト一覧 P1・P2・P3・P7）。
 *
 * AI の応答は信用しない前提で扱う。どの提供元（Gemini / Claude / GLM / モック）でも同じ関数を通すので、
 * モデルを替えても画面に出る下書きの形と警告は変わらない（P10）。
 *
 * 下書きの status:
 *   ok           … そのまま保存してよさそう（それでも保存は利用者が押したときだけ: P8）
 *   needs_review … 読めない・欠けている・合計が合わない等。印の付いた所を直してもらう（P2・P3）
 *   unsupported  … 外貨・日本語以外・レシートでない（Phase 1 の対象外: P7）
 *
 * 消費税の方式（内税／外税）は、AI の判断（tax_mode）より「小計・消費税・合計の金額が合うか」を優先して決める
 * （app#42。店ごとに方式を定義しない）。判定は judgeTax。
 * 小計＋消費税＝合計 が1円合わない外税のレシート（税率ごとに端数処理する店・「内」印の税込の品が混じる店）は、
 * 税率ごとの対象額（judgeByRate）か「内」印の品の税（judgeInnerMixed）で照合する（mywork#1508）。
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
  subtotal: z.number().nullable(),
  total: z.number().nullable(),
  tax_mode: z.enum(["inclusive", "exclusive", "unknown"]),
  tax_lines: z.array(z.object({ rate: z.number(), amount: z.number(), base: z.number().nullable() })),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      unit_price: z.number().nullable(),
      amount: z.number(),
      tax_rate: z.number().nullable(),
      tax_included: z.boolean(),
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
  subtotal: ReceiptAiResultSchema.shape.subtotal.catch(null),
  tax_mode: ReceiptAiResultSchema.shape.tax_mode.catch("unknown"),
  tax_lines: z
    .array(z.object({ rate: z.number(), amount: z.number(), base: z.number().nullable().catch(null) }))
    .catch([]),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      unit_price: z.number().nullable().catch(null),
      amount: z.number(),
      tax_rate: z.number().nullable().catch(null),
      tax_included: z.boolean().catch(false),
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
  | "subtotal_total_mismatch"
  | "total_looks_like_subtotal"
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

/**
 * 小計・消費税・合計の照合の結果（app#42）
 *   inclusive … 小計 = 合計（明細に税が入っている。合計をそのまま登録）
 *   exclusive … 小計 ＋ 消費税 = 合計（小計のあとに税を足す方式。税込の合計を登録し、税を明細に按分）
 *   mismatch  … どちらでも合わない（従来の不整合の扱い: 警告を出して確認へ）
 *   unchecked … 合計か小計（明細）が無く、照合できない
 */
export type TaxCheck = "inclusive" | "exclusive" | "mismatch" | "unchecked";

/**
 * 外税（exclusive）と決めた根拠（mywork#1508）
 *   subtotal   … 小計 ＋ 消費税 ＝ 合計（ぴったり）
 *   by_rate    … 税率ごとの対象額の和 ＝ 合計。各税率で「対象額 − 明細」が明細（税抜）の税と端数1円以内
 *   inner_mixed … 「内」印の税込の品が混じる。消費税の印字と足された税の差が、その品に含まれる税で説明できる
 */
export type TaxBasis = "subtotal" | "by_rate" | "inner_mixed";

export interface ReceiptDraft {
  status: "ok" | "needs_review" | "unsupported";
  merchant: string | null;
  date: string | null;
  total: number | null;
  /** 照合に使った小計（印字の小計。無ければ印字された明細の和）。明細も小計も無ければ null */
  subtotal: number | null;
  /** 読み取れた消費税額の和（内税・外税とも。税率ごとの行の和） */
  taxTotal: number;
  taxCheck: TaxCheck;
  /** 外税と決めた根拠（taxCheck が exclusive のときだけ。ほかは null） */
  taxBasis: TaxBasis | null;
  /** 税率ごとの税込の対象額（by_rate で照合したときだけ。画面の式に出す） */
  rateTotals: { rate: number; amount: number }[];
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
  subtotal: null,
  taxTotal: 0,
  taxCheck: "unchecked",
  taxBasis: null,
  rateTotals: [],
  taxAllocated: false,
  items: [],
  warnings,
});

/**
 * 外税のレシート: 税率ごとの税額を、その税率の明細に金額の比で按分して税込額にする。
 * 端数はその税率の最後の行で調整する（税率ごとの和が税額と1円単位で一致する）。
 * 税率が読めない行は、税の行が1つだけならその税率とみなす。当てはめられない税額は按分しない。
 * 「内」印の品（taxIncluded。印字が税込）には足さない（mywork#1508）。
 */
export function allocateTax(
  items: { amount: number; taxRate: number | null; taxIncluded?: boolean }[],
  taxLines: { rate: number; amount: number }[]
): number[] {
  const out = items.map((i) => i.amount);
  const onlyRate = taxLines.length === 1 ? taxLines[0].rate : null;
  for (const line of taxLines) {
    const idx = items
      .map((_, k) => k)
      .filter((k) => !items[k].taxIncluded && (items[k].taxRate ?? onlyRate) === line.rate);
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
 * 小計・消費税・合計の金額同士が合うかで、内税／外税を決める（app#42）。
 * 1. 小計 = 合計 → inclusive（従来どおり合計を登録）
 * 2. 小計 ＋ 消費税 = 合計 → exclusive（税込の合計を登録）
 * 3. どちらでも合わない → mismatch（既存の不整合の扱いへ）
 * 1円のずれも許さない（完全一致だけ）。税額はレシートに印字された丸め済みの値を読むので、
 * 正しく読めていれば必ずぴったり合う。1円でも違えば、どこかの読み違いとして利用者に確かめてもらう。
 * 店ごとの方式は持たない。AI の tax_mode は使わず、金額だけで決める（AI が内税・外税を取り違えても直る）。
 */
export function judgeTax(subtotal: number | null, taxTotal: number, total: number | null): TaxCheck {
  if (subtotal === null || total === null) return "unchecked";
  if (subtotal === total) return "inclusive";
  if (taxTotal > 0 && subtotal + taxTotal === total) return "exclusive";
  return "mismatch";
}

/** 照合に使う明細の形（税率は値引き行の引き継ぎ・税の行が1つのときの当てはめを済ませたもの） */
export interface TaxItem {
  amount: number;
  taxRate: number | null;
  taxIncluded: boolean;
}

/** 照合で外税と決まったときの結果。added は税率ごとに明細（税抜の品）へ足す税額 */
export interface RateMatch {
  added: { rate: number; amount: number }[];
  rateTotals: { rate: number; amount: number }[];
}

/** 税率 r の明細の和と、そのうち税抜（「内」印でない）の品の和 */
function sumsByRate(items: TaxItem[], rate: number) {
  const at = items.filter((i) => i.taxRate === rate);
  return {
    all: at.reduce((s, i) => s + i.amount, 0),
    excluded: at.filter((i) => !i.taxIncluded).reduce((s, i) => s + i.amount, 0),
    included: at.filter((i) => i.taxIncluded).reduce((s, i) => s + i.amount, 0),
  };
}

/** 店の端数処理（切り捨て・四捨五入・切り上げ、税率ごと）で生じうるずれ。1税率あたり1円まで */
const ROUNDING_YEN = 1;

/**
 * 税率ごとの対象額で照合する（mywork#1508）。
 * 外税のレシートでも「(10%対象 ¥585 うち消費税 ¥53)」のように税率ごとの税込の対象額が印字される店がある。
 * 1. 対象額の和 ＝ 合計（対象額が税込）か、対象額の和 ＋ 消費税 ＝ 合計（対象額が税抜）。ここは1円も許さない
 * 2. 税率ごとに、足された税（税込の対象額 − その税率の明細の和）が、税抜の品の和 × 税率 と端数1円以内
 *    （明細の読み落とし・税率の取り違えがあると、ここで大きく外れる）
 * 明細の税率が欠けている（税の行が2つ以上）・税の行の無い税率の明細がある・対象額が欠けている → 照合しない（null）。
 */
export function judgeByRate(
  items: TaxItem[],
  taxLines: { rate: number; amount: number; base: number | null }[],
  total: number | null
): RateMatch | null {
  if (total === null || taxLines.length === 0 || items.length === 0) return null;
  if (taxLines.some((t) => t.base === null || !Number.isInteger(t.base) || t.base <= 0)) return null;
  const rates = new Set(taxLines.map((t) => t.rate));
  if (rates.size !== taxLines.length) return null;
  if (items.some((i) => i.taxRate === null || !rates.has(i.taxRate))) return null;

  const baseSum = taxLines.reduce((s, t) => s + (t.base as number), 0);
  const taxSum = taxLines.reduce((s, t) => s + t.amount, 0);
  const baseIncludesTax = baseSum === total ? true : baseSum + taxSum === total ? false : null;
  if (baseIncludesTax === null) return null;

  const added: RateMatch["added"] = [];
  const rateTotals: RateMatch["rateTotals"] = [];
  for (const t of taxLines) {
    const taxed = (t.base as number) + (baseIncludesTax ? 0 : t.amount);
    const s = sumsByRate(items, t.rate);
    const add = taxed - s.all;
    if (Math.abs(add - (s.excluded * t.rate) / 100) > ROUNDING_YEN) return null;
    added.push({ rate: t.rate, amount: add });
    rateTotals.push({ rate: t.rate, amount: taxed });
  }
  return { added, rateTotals };
}

/**
 * 「内」印の税込の品が混じる外税のレシートを、対象額なしで照合する（mywork#1508）。
 * 印字の消費税には「内」の品に含まれる税も入るので、小計 ＋ 消費税 は合計より少し大きくなる。
 * 1. 足された税 ＝ 合計 − 明細の和 が、税抜の品の和 × 税率 の合計と端数（税率の数×1円）以内
 * 2. 消費税の印字 − 足された税 が 0 以上、「内」の品に含まれる税（税率ごとに切り上げ）以下
 * 「内」の品が無いレシートには使わない（そのときは 小計 ＋ 消費税 ＝ 合計 のぴったりだけを認める: app#42）。
 */
export function judgeInnerMixed(items: TaxItem[], taxTotal: number, total: number | null): RateMatch | null {
  if (total === null || taxTotal <= 0 || !items.some((i) => i.taxIncluded)) return null;
  if (items.some((i) => i.taxRate === null)) return null;
  const rates = [...new Set(items.map((i) => i.taxRate as number))];
  const itemsSum = items.reduce((s, i) => s + i.amount, 0);
  const addedTotal = total - itemsSum;
  if (addedTotal <= 0) return null;

  const expected = rates.map((r) => ({ rate: r, ...sumsByRate(items, r) }));
  const expectedSum = expected.reduce((s, e) => s + (e.excluded * e.rate) / 100, 0);
  if (Math.abs(addedTotal - expectedSum) > ROUNDING_YEN * rates.length) return null;
  const innerTax = expected.reduce((s, e) => s + Math.ceil((e.included * e.rate) / (100 + e.rate)), 0);
  const diff = taxTotal - addedTotal;
  if (diff < 0 || diff > innerTax) return null;

  // 足された税を税率ごとに分ける（期待値を丸め、端数は税抜の品がいちばん多い税率で合わせる）
  const added = expected.map((e) => ({ rate: e.rate, amount: Math.round((e.excluded * e.rate) / 100) }));
  const largest = expected.reduce((m, e, k) => (e.excluded > expected[m].excluded ? k : m), 0);
  added[largest].amount += addedTotal - added.reduce((s, a) => s + a.amount, 0);
  return { added, rateTotals: [] };
}

/**
 * 値引き・割引の行（負の金額）の税率と「内」印は、値引きされた商品（すぐ上の行）と同じにする（mywork#1508）。
 * 割引の行には軽減税率の印が付かないことが多く、AI が 10% と読むと税率ごとの照合が合わなくなるため。
 * 税率が欠けていて税の行が1つだけなら、その税率とみなす（allocateTax と同じ）。
 */
export function normalizeTaxItems(
  items: { amount: number; tax_rate: number | null; tax_included: boolean }[],
  taxLines: { rate: number }[]
): TaxItem[] {
  const onlyRate = taxLines.length === 1 ? taxLines[0].rate : null;
  const out: TaxItem[] = [];
  items.forEach((i, k) => {
    let rate = i.tax_rate ?? onlyRate;
    let included = i.tax_included;
    if (i.amount < 0 && k > 0 && out[k - 1].taxRate !== null) {
      rate = out[k - 1].taxRate;
      included = out[k - 1].taxIncluded;
    }
    out.push({ amount: i.amount, taxRate: rate, taxIncluded: included });
  });
  return out;
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

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

  // 小計・消費税・合計の照合で内税／外税を決める（app#42）。
  // 小計は「印字の小計」→「印字された明細の和」の順に試す。小計のあとに値引きの行があるレシートでは
  // 印字の小計では合わず、値引き後の明細の和で合うため（明細も小計も無ければ照合しない）
  const taxLines = parsed.tax_lines.filter((t) => Number.isInteger(t.amount) && t.amount > 0);
  const taxTotal = taxLines.reduce((s, t) => s + t.amount, 0);
  const taxItems = normalizeTaxItems(parsed.items, taxLines);
  const printedSubtotal =
    parsed.subtotal !== null && Number.isInteger(parsed.subtotal) && parsed.subtotal > 0 ? parsed.subtotal : null;
  const itemsSubtotal = parsed.items.length > 0 ? parsed.items.reduce((s, i) => s + i.amount, 0) : null;
  const candidates = [printedSubtotal, itemsSubtotal].filter((v): v is number => v !== null);
  const matched = candidates.find((c) => {
    const r = judgeTax(c, taxTotal, total);
    return r === "inclusive" || r === "exclusive";
  });
  let subtotal = matched ?? candidates[0] ?? null;
  let taxCheck = judgeTax(subtotal, taxTotal, total);
  let taxBasis: TaxBasis | null = taxCheck === "exclusive" ? "subtotal" : null;

  // 小計＋消費税＝合計 が合わなくても、税率ごとの対象額か「内」印の品の税で説明できれば正しい外税のレシート（mywork#1508）
  let rateMatch: RateMatch | null = null;
  if (taxCheck === "mismatch" || taxCheck === "unchecked") {
    rateMatch = judgeByRate(taxItems, taxLines, total);
    if (rateMatch) taxBasis = "by_rate";
    else {
      rateMatch = judgeInnerMixed(taxItems, taxTotal, total);
      if (rateMatch) taxBasis = "inner_mixed";
    }
    if (rateMatch && itemsSubtotal !== null) {
      taxCheck = "exclusive";
      subtotal = itemsSubtotal;
    } else {
      rateMatch = null;
      taxBasis = null;
    }
  }

  if (taxCheck === "inclusive" && parsed.tax_mode === "exclusive" && taxTotal > 0 && total !== null) {
    // 外税の税の行があるのに 合計 = 小計。合計の欄に小計を読んだ（税を足す前の額を登録しかけている）おそれ
    warnings.push({
      code: "total_looks_like_subtotal",
      message: `合計が小計と同じ（${yen(total)}）ですが、外税の消費税（${yen(taxTotal)}）の行があります。お支払い合計が ${yen(total + taxTotal)} でないか確認してください。`,
    });
  } else if (taxCheck === "mismatch" && printedSubtotal !== null && total !== null) {
    warnings.push({
      code: "subtotal_total_mismatch",
      message: `小計（${yen(printedSubtotal)}）${taxTotal > 0 ? `＋消費税（${yen(taxTotal)}）` : ""}と合計（${yen(total)}）が合いません。金額を確認してください。`,
    });
  }

  // 外税と判定できたら、税を明細に按分して税込にする（明細の和 = 合計 で照合できるように）。
  // 税率ごとの対象額・「内」印で照合したときは、足された税（印字の税から「内」の品の分を除いた額）を按分する。
  // 金額で判定できないとき（mismatch・unchecked）は従来どおり AI の tax_mode に従う
  const taxAllocated =
    rateMatch !== null ||
    (taxLines.length > 0 &&
      (taxCheck === "exclusive" || ((taxCheck === "mismatch" || taxCheck === "unchecked") && parsed.tax_mode === "exclusive")));
  const withTax = !taxAllocated
    ? parsed.items.map((i) => i.amount)
    : rateMatch
      ? allocateTax(taxItems, rateMatch.added)
      : allocateTax(taxItems, taxLines);

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
        message: `明細の合計（${yen(sum)}）と合計金額（${yen(total)}）が合いません。値引き・税の行を確認してください。`,
      });
    }
  }

  return {
    status: warnings.length > 0 ? "needs_review" : "ok",
    merchant,
    date,
    total,
    subtotal,
    taxTotal,
    taxCheck,
    taxBasis,
    rateTotals: rateMatch?.rateTotals ?? [],
    taxAllocated,
    items,
    warnings,
  };
}
