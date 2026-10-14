/**
 * @file lib/aggregate/canonical.ts
 * @description 回帰テスト用に月の集計を「正規化した JSON」にしてハッシュを取る（mywork#425 第1弾、設計書 4-9 V2）。
 *
 * 本物の帳簿の期待値は git に入れられない（金額が入る）。代わりに、月ごとの集計を
 *   - 並び順に左右されない形（キーを辞書順、カテゴリーは名前順、月は昇順）
 *   - 画面の都合の値（割合・id・色）を除いた形
 * にして SHA-256 を取り、ハッシュだけを git に置く。1円違えばハッシュが変わる。
 */

import { createHash } from "node:crypto";
import type { MonthlySummary } from "./monthly";

export interface CanonicalMonth {
  expense: MonthlySummary["expense"];
  income: MonthlySummary["income"];
  transfers: MonthlySummary["transfers"];
  loans: MonthlySummary["loans"];
  scheduled: { expense: number; income: number; count: number };
  balance: number;
  fixed: MonthlySummary["fixed"];
  byCategory: Array<{ name: string; amount: number; purchases: number; refunds: number; count: number }>;
  frames: {
    total: { limit: number; spent: number; remaining: number };
    outside: number;
    income: number;
    unassigned: { count: number; amount: number };
    frames: Array<{ name: string; spent: number }>;
  } | null;
  review: MonthlySummary["review"];
}

export function canonicalMonth(s: MonthlySummary): CanonicalMonth {
  return {
    expense: s.expense,
    income: s.income,
    transfers: s.transfers,
    loans: s.loans,
    scheduled: { expense: s.scheduled.expense, income: s.scheduled.income, count: s.scheduled.count },
    balance: s.balance,
    fixed: s.fixed,
    byCategory: [...s.byCategory]
      .map((c) => ({ name: c.name, amount: c.amount, purchases: c.purchases, refunds: c.refunds, count: c.count }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja")),
    frames: s.frames
      ? {
          total: s.frames.total,
          outside: s.frames.outside,
          income: s.frames.income,
          unassigned: { count: s.frames.unassigned.count, amount: s.frames.unassigned.amount },
          frames: s.frames.frames.map((f) => ({ name: f.name, spent: f.spent })),
        }
      : null,
    review: s.review,
  };
}

/** キーを辞書順にそろえて JSON にする（同じ内容なら必ず同じ文字列） */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 月 → 正規化した集計 の JSON（月は昇順） */
export function canonicalize(summaries: MonthlySummary[]): string {
  const obj: Record<string, CanonicalMonth> = {};
  for (const s of [...summaries].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))) {
    obj[s.month] = canonicalMonth(s);
  }
  return stableStringify(obj);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
