/**
 * @file lib/validation/fixed-cost.ts
 * @description 定期支出・定期収入の入力ルール（テスト一覧 R1・R2・R4・R7）。純粋関数なので単体テストできる。
 *
 * - parseFixedCostInput: API の body（snake_case）を検査して camelCase の値にする
 *     create … 既定値（支出・毎月・開始日=今日）を埋め、周期との組み合わせまで確かめる
 *     update … 送られた項目だけを返す。組み合わせの検査は既存の値と合わせてから checkRule で行う
 * - match_note / match_any_amount: 固定の判定の条件（メモの語句・金額を見ないか）。空の語句は null（見ない）
 * - currency: JPY（既定）か USD。USD の amount はドル（小数2桁まで）、JPY は1円単位の整数（checkRule で確かめる）
 * - サブスクの管理欄（mywork#742 ②）: is_subscription・manage_url・cancel_url・next_renewal_date・payment_card・memo。全部任意で、
 *     空文字は null（欄を消す）。URL は http/https だけ、支払いカードはカード番号らしき数字（12桁以上）を弾く
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

/**
 * サブスクの管理欄（mywork#742 ②）。周期の組み合わせとは関係ないので FixedCostFields と分け、
 * checkRule は両方を素通しする（既存の呼び出し・テストの形を変えないため）。
 */
export interface SubscriptionFields {
  /** サブスクか（サブスク一覧 /subscriptions に出す） */
  isSubscription: boolean;
  /** 管理ページの URL（http/https のみ） */
  manageUrl: string | null;
  /** 解約・プラン変更の URL（http/https のみ） */
  cancelUrl: string | null;
  /** 手入力の次回更新日。null・過ぎたら支払日から自動（lib/subscriptions/list.ts） */
  nextRenewalDate: string | null;
  /** 支払いカード（カード会社名・券種の自由記述。番号は持たない） */
  paymentCard: string | null;
  /** 自由記入のメモ（固定の判定に使う match_note とは別物） */
  memo: string | null;
}

/** URL・カード・メモの長さの上限（migration 20261023000000 の CHECK と同じ値） */
export const URL_MAX = 2000;
export const CARD_MAX = 50;
export const MEMO_MAX = 500;

const fail = (message: string) => ({ ok: false as const, message });

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * 任意の文字の欄を読む。null・空文字（空白だけ）は null（=欄を消す）、それ以外は前後の空白を落とす。
 * 戻り値の undefined は「文字ではない」の意味（呼び出し側でメッセージを出す）。
 */
function optionalText(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * リンクにしてよい URL か。
 * なぜ: 一覧で <a href> にするので、javascript: などを入れられると押したときにスクリプトが走る。
 * 先頭の http(s):// を見たうえで URL として読めるか（空白入りなど壊れた形を弾く）も確かめる。
 */
function isWebUrl(v: string): boolean {
  if (!/^https?:\/\//i.test(v) || v.length > URL_MAX || /\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** カード番号らしき数字があるか。「4111 1111 …」のような区切りも、空白・ハイフンを除いて12桁以上続けば番号とみなす */
function looksLikeCardNumber(v: string): boolean {
  return /\d{12,}/.test(v.replace(/[\s\-]/g, ""));
}

/** 周期との組み合わせを確かめ、使わない項目を null にそろえた値を返す */
export function checkRule<T extends FixedCostFields>(f: T): Parsed<T> {
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
): Parsed<Partial<FixedCostFields & SubscriptionFields>> {
  const out: Partial<FixedCostFields & SubscriptionFields> = {};
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

  // サブスクの管理欄（mywork#742 ②）
  if (has("is_subscription")) {
    if (typeof body.is_subscription !== "boolean") return fail("is_subscription は true / false で指定してください");
    out.isSubscription = body.is_subscription;
  }
  for (const [key, field, label] of [
    ["manage_url", "manageUrl", "管理ページの URL"],
    ["cancel_url", "cancelUrl", "解約・プラン変更の URL"],
  ] as const) {
    if (!has(key)) continue;
    const t = optionalText(body[key]);
    if (t === undefined) return fail(`${label}は文字で指定してください`);
    if (t !== null && !isWebUrl(t)) return fail(`${label}は http:// か https:// で始まる ${URL_MAX}文字までの URL にしてください`);
    out[field] = t;
  }
  if (has("next_renewal_date")) {
    const t = optionalText(body.next_renewal_date);
    if (t === undefined) return fail("次回更新日は日付で指定してください");
    if (t === null) {
      out.nextRenewalDate = null;
    } else {
      const d = parseDateOnly(t);
      if (!d.ok) return fail(`次回更新日: ${d.message}`);
      out.nextRenewalDate = d.value;
    }
  }
  if (has("payment_card")) {
    const t = optionalText(body.payment_card);
    if (t === undefined) return fail("支払いカードは文字で指定してください");
    if (t !== null && t.length > CARD_MAX) return fail(`支払いカードは${CARD_MAX}文字までにしてください`);
    if (t !== null && looksLikeCardNumber(t)) return fail("支払いカードにはカード番号を入れないでください（カード会社名・券種だけ）");
    out.paymentCard = t;
  }
  if (has("memo")) {
    const t = optionalText(body.memo);
    if (t === undefined) return fail("メモは文字で指定してください");
    if (t !== null && t.length > MEMO_MAX) return fail(`メモは${MEMO_MAX}文字までにしてください`);
    out.memo = t;
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
    isSubscription: out.isSubscription ?? false,
    manageUrl: out.manageUrl ?? null,
    cancelUrl: out.cancelUrl ?? null,
    nextRenewalDate: out.nextRenewalDate ?? null,
    paymentCard: out.paymentCard ?? null,
    memo: out.memo ?? null,
  });
}
