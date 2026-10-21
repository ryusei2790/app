/**
 * @file lib/receipt/split.ts
 * @description 確定したレシートを、明細のカテゴリごとの取引に分ける（mywork#229、2026-10-21 本人決定）。
 * 例: スーパー 2,480円 → 食費 1,980 / 日用品 500。
 * - 明細の金額（税込）をカテゴリごとに足す。値引きの行は同じカテゴリから引かれる
 * - 明細の和と合計（利用者が確定した額）の差は、いちばん大きいカテゴリで吸収する（取引の和 = 合計）
 * - 0円以下になったカテゴリは、いちばん大きいカテゴリにまとめる（支出は1円以上）
 * 並びは金額の大きい順。先頭がレシート情報（receipts）をぶら下げる取引になる。
 */

export interface SplitPart {
  categoryId: string | null;
  amount: number;
}

export function splitByCategory(items: { amount: number; categoryId: string | null }[], total: number): SplitPart[] {
  const sums = new Map<string | null, number>();
  for (const it of items) sums.set(it.categoryId, (sums.get(it.categoryId) ?? 0) + it.amount);
  let parts = [...sums].map(([categoryId, amount]) => ({ categoryId, amount }));
  if (parts.length <= 1) return [{ categoryId: parts[0]?.categoryId ?? null, amount: total }];

  parts.sort((a, b) => b.amount - a.amount);
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  parts[0].amount += total - sum;
  // 0円以下のカテゴリは先頭にまとめる（まとめた結果、先頭も合計と同じになる）
  const nonPositive = parts.filter((p, k) => k > 0 && p.amount <= 0);
  for (const p of nonPositive) parts[0].amount += p.amount;
  parts = parts.filter((p, k) => k === 0 || p.amount > 0);
  if (parts[0].amount <= 0) return [{ categoryId: parts[0].categoryId, amount: total }];
  return parts.sort((a, b) => b.amount - a.amount);
}
