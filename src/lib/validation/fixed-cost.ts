/**
 * @file lib/validation/fixed-cost.ts
 * @description 定期支出・定期収入の入力ルール（テスト一覧 R1・R2・R4・R7）。純粋関数なので単体テストできる。
 *
 * - parseFixedCostInput: API の body（snake_case）を検査して camelCase の値にする
 *     create … 既定値（支出・毎月・開始日=今日）を埋め、周期との組み合わせまで確かめる
 *     update … 送られた項目だけを返す。組み合わせの検査は既存の値と合わせてから checkRule で行う
 * - match_note / match_any_amount: 固定の判定の条件（メモの語句・金額を見ないか）。空の語句は null（見ない）
 * - currency: JPY（既定）か USD。USD の amount はドル（小数2桁まで）、JPY は1円単位の整数（checkRule で確かめる）
 * - checkRule: 周期と billing_day / billing_month / 開始日・終了日の組み合わせを確かめる
 * 失敗時は画面にそのまま出せる日本語のメッセージを返す（取引の入力ルールと同じ形）。
 * 口座・カテゴリが自分のものかは DB が要るので、ここではなく route（lib/ownership.ts）で確かめる。
 */

import { CYCLES, type Cycle } from "@/lib/fixed-costs/schedule";
import { parseDateOnly, parseYenAmount, type Parsed } from "./transaction";

export const CURRENCIES = ["JPY", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface FixedCostFields {
  name: string;
  amount: number;
  type: "income" | "expense";
  cycle: Cycle;
  billingDay: number | null;
  billingMonth: number | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  /** 固定の判定: メモに含まれる語句（null = 見ない）。lib/fixed/classify.ts */
  matchNote: string | null;
  /** 固定の判定: true なら金額を見ない */
  matchAnyAmount: boolean;
  /** 通貨。USD は amount がドルで、取引にするときその日のドル円で円に直す（lib/fixed-costs/expand.ts） */
  currency: Currency;
}

const fail = (message: string) => ({ ok: false as const, message });

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** 周期との組み合わせを確かめ、使わない項目を null にそろえた値を返す */
export function checkRule(f: FixedCostFields): Parsed<FixedCostFields> {
  const usesDay = f.cycle === "monthly" || f.cycle === "yearly";
  if (usesDay && f.billingDay === null) return fail("毎月・毎年の定期には支払日（billing_day）が必要です");
  if (f.cycle === "yearly" && f.billingMonth === null) return fail("毎年の定期には支払月（billing_month）が必要です");
  if (f.endDate !== null && f.endDate < f.startDate) return fail("終了日は開始日以降にしてください");
  if (f.currency === "JPY" && !Number.isInteger(f.amount)) return fail("金額は1円単位の整数で指定してください");
  if (f.currency === "USD" && Math.round(f.amount * 100) !== f.amount * 100) return fail("ドルの金額は小数2桁（セント）までにしてください");
  return {
    ok: true,
    value: {
      ...f,
      // 毎週・隔週は開始日の曜日で決まるので billing_day を持たない。毎年以外は billing_month を持たない
      billingDay: usesDay ? f.billingDay : null,
      billingMonth: f.cycle === "yearly" ? f.billingMonth : null,
    },
  };
}

/**
 * body を検査する。
 * @param today 開始日の既定値（JST の今日 "YYYY-MM-DD"）。テストで固定できるよう引数で受ける
 */
export function parseFixedCostInput(
  body: Record<string, unknown>,
  mode: "create" | "update",
  today: string
): Parsed<Partial<FixedCostFields>> {
  const out: Partial<FixedCostFields> = {};
  const has = (k: string) => body[k] !== undefined;

  // 1. 項目ごとの形の検査（送られたものだけ）
  if (has("name") || mode === "create") {
    if (typeof body.name !== "string" || body.name.trim() === "") return fail("名前を入力してください");
    out.name = body.name.trim();
  }
  if (has("amount") || mode === "create") {
    // ドルはセントがあるので、整数かどうかは通貨が決まってから checkRule で見る
    const a = parseYenAmount(typeof body.amount === "number" ? Math.ceil(body.amount) : body.amount);
    if (!a.ok) return a;
    out.amount = body.amount as number;
  }
  if (has("type")) {
    if (body.type !== "income" && body.type !== "expense") return fail("種別は income か expense で指定してください");
    out.type = body.type;
  }
  if (has("cycle")) {
    if (!CYCLES.includes(body.cycle as Cycle)) {
      return fail("周期は weekly・biweekly・monthly・yearly のどれかで指定してください");
    }
    out.cycle = body.cycle as Cycle;
  }
  if (has("billing_day")) {
    if (body.billing_day !== null && !isIntIn(body.billing_day, 1, 31)) {
      return fail("billing_day は 1〜31 で指定してください");
    }
    out.billingDay = body.billing_day as number | null;
  }
  if (has("billing_month")) {
    if (body.billing_month !== null && !isIntIn(body.billing_month, 1, 12)) {
      return fail("billing_month は 1〜12 で指定してください");
    }
    out.billingMonth = body.billing_month as number | null;
  }
  if (has("start_date")) {
    const d = parseDateOnly(body.start_date);
    if (!d.ok) return fail(`開始日: ${d.message}`);
    out.startDate = d.value;
  }
  if (has("end_date")) {
    if (body.end_date === null || body.end_date === "") {
      out.endDate = null;
    } else {
      const d = parseDateOnly(body.end_date);
      if (!d.ok) return fail(`終了日: ${d.message}`);
      out.endDate = d.value;
    }
  }
  if (has("is_active")) {
    if (typeof body.is_active !== "boolean") return fail("is_active は true / false で指定してください");
    out.isActive = body.is_active;
  }
  if (has("match_note")) {
    if (body.match_note === null || body.match_note === "") {
      out.matchNote = null;
    } else {
      if (typeof body.match_note !== "string") return fail("メモの語句は文字で指定してください");
      const t = body.match_note.trim();
      if (t.length > 50) return fail("メモの語句は50文字までにしてください");
      out.matchNote = t === "" ? null : t;
    }
  }
  if (has("match_any_amount")) {
    if (typeof body.match_any_amount !== "boolean") return fail("match_any_amount は true / false で指定してください");
    out.matchAnyAmount = body.match_any_amount;
  }

  if (has("currency")) {
    if (!CURRENCIES.includes(body.currency as Currency)) return fail("通貨は JPY か USD で指定してください");
    out.currency = body.currency as Currency;
  }

  if (mode === "update") return { ok: true, value: out };

  // 2. 作成時は既定値を埋めてから組み合わせを確かめる
  return checkRule({
    name: out.name!,
    amount: out.amount!,
    type: out.type ?? "expense",
    cycle: out.cycle ?? "monthly",
    billingDay: out.billingDay ?? null,
    billingMonth: out.billingMonth ?? null,
    startDate: out.startDate ?? today,
    endDate: out.endDate ?? null,
    isActive: out.isActive ?? true,
    matchNote: out.matchNote ?? null,
    matchAnyAmount: out.matchAnyAmount ?? false,
    currency: out.currency ?? "JPY",
  });
}
