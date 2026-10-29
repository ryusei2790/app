/**
 * @file lib/ask/parse.ts
 * @description 画面（チップ・続けての質問）から送られてきた Reading を確かめる（mywork#500 第3弾）。
 * 画面の値は書き換えられる前提で信用しない。形・月・期間の長さを確かめ、カテゴリー id は本人に見える語彙にあるものだけ通す
 * （他人のカテゴリー id を書いても null になる。名前はサーバー側の語彙から付け直す）。
 */

import { MAX_PERIOD_MONTHS, monthsBetween, type Reading, type Vocab } from "./reader";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 画面から来た Reading の形を確かめる。おかしければ null（推測で直さない） */
export function parseReading(v: unknown, vocab: Vocab): Reading | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const p = r.period as Record<string, unknown> | undefined;
  const t = r.target as Record<string, unknown> | undefined;
  if (r.flow !== "expense" && r.flow !== "income") return null;
  if (!p || typeof p.from !== "string" || typeof p.to !== "string" || typeof p.label !== "string") return null;
  if (!MONTH_RE.test(p.from) || !MONTH_RE.test(p.to) || p.from > p.to || monthsBetween(p.from, p.to) > MAX_PERIOD_MONTHS) return null;
  if (p.label.length > 40) return null;
  if (!t || !["all", "category", "fixed", "variable"].includes(t.type as string)) return null;
  if (!["sum", "count", "per_day"].includes(r.measure as string)) return null;
  if (r.groupBy !== undefined && r.groupBy !== "category" && r.groupBy !== "month") return null;
  let target: Reading["target"];
  if (t.type === "category") {
    const c = vocab.categories.find((x) => x.id === t.id);
    if (!c) return null;
    target = { type: "category", id: c.id, name: c.name };
  } else {
    target = { type: t.type as "all" | "fixed" | "variable", name: t.type === "fixed" ? "固定費" : t.type === "variable" ? "変動費" : r.flow === "income" ? "収入全体" : "支出全体" };
  }
  const out: Reading = { flow: r.flow, period: { from: p.from, to: p.to, label: p.label }, target, measure: r.measure as Reading["measure"] };
  if (r.groupBy) out.groupBy = r.groupBy as Reading["groupBy"];
  if (r.compare === true) out.compare = true;
  return out;
}

