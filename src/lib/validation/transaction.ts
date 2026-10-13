/**
 * @file lib/validation/transaction.ts
 * @description 取引・固定費の入力ルール（テスト一覧 T1・T2）。純粋関数なので単体テストできる。
 * - 金額: 1円以上の整数円だけ。上限は DB の NUMERIC(12,2) に入る 9,999,999,999 円
 * - 日付: 実在する YYYY-MM-DD だけ（2/30 や 13月は拒否）。未来日は許可（予定の支払いを先に入れられる）
 * 失敗時は画面にそのまま出せる日本語のメッセージを返す。
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** DB の NUMERIC(12,2) に収まる最大の整数円 */
export const MAX_YEN = 9_999_999_999;

export function parseYenAmount(v: unknown): Parsed<number> {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return { ok: false, message: "金額は数値（円）で指定してください" };
  }
  if (!Number.isInteger(v)) {
    return { ok: false, message: "金額は1円単位の整数で指定してください" };
  }
  if (v <= 0) {
    return { ok: false, message: "金額は1円以上で指定してください" };
  }
  if (v > MAX_YEN) {
    return { ok: false, message: "金額が大きすぎます（9,999,999,999円まで）" };
  }
  return { ok: true, value: v };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 受け付ける最も古い年（入力ミスの 0026 年などを弾く） */
const MIN_YEAR = 1900;

export function parseDateOnly(v: unknown): Parsed<string> {
  const fail = { ok: false as const, message: "日付は YYYY-MM-DD 形式の実在する日付で指定してください" };
  if (typeof v !== "string") return fail;
  const m = DATE_RE.exec(v);
  if (!m) return fail;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || mo < 1 || mo > 12 || d < 1) return fail;
  // その月の日数（UTC で計算するのでサーバーの TZ に左右されない）
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > daysInMonth) return fail;
  return { ok: true, value: v };
}
