/**
 * @file lib/aggregate/review.ts
 * @description 「要確認」の列挙（mywork#425 第1弾、設計書 4-6、テスト一覧 D11）。純粋関数。
 *
 * 機械的に候補を挙げるだけで、直すのは本人（画面でその場で種類・カテゴリーを変える／消す）。
 *   - 返金候補   … 収入なのに支出のカテゴリー、またはメモに「返金・キャンセル・払い戻し・返品」がある通常の収入。
 *                 返金なら種類を「返金」に変えると、収入ではなく支出から引かれる（定義 1）
 *   - 未割り当て … カテゴリーの無い購入（予算の費目にも振り分けられない）
 *   - 予定       … 今日より後の日付の行（合計に入っていないことを本人に見せる）
 *   - 重複候補   … 同じ日・同じ金額・同じ向き・同じカテゴリーの通常の行（定期から自動で作った行は除く）。
 *                 同じ日に同じ買い物を2回することもあるので、候補として見せるだけ
 */

import { REFUND_KEYWORDS, type TransactionKind } from "./definitions";
import type { AggTx } from "./monthly";

export interface ReviewItem {
  id: string;
  date: string;
  amount: number;
  type: "income" | "expense";
  kind: TransactionKind;
  categoryId: string | null;
  categoryName: string | null;
  note: string | null;
  source: string;
  /** なぜ挙がったか（画面にそのまま出す） */
  reason: string;
}

export interface DuplicateGroup {
  /** 日付・向き・金額・カテゴリーを並べた目印 */
  key: string;
  items: ReviewItem[];
}

export interface ReviewResult {
  refundCandidates: ReviewItem[];
  unassigned: ReviewItem[];
  scheduled: ReviewItem[];
  duplicates: DuplicateGroup[];
}

export interface ReviewCounts {
  refundCandidates: number;
  unassigned: number;
  scheduled: number;
  duplicates: number;
}

function item(t: AggTx, reason: string): ReviewItem {
  return {
    id: t.id ?? "",
    date: t.date,
    amount: t.amount,
    type: t.type,
    kind: t.kind,
    categoryId: t.categoryId,
    categoryName: t.categoryName ?? null,
    note: t.note,
    source: t.source,
    reason,
  };
}

const byDate = (a: ReviewItem, b: ReviewItem) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1);

/** メモに含まれる返金の語（最初に見つかったもの） */
export function refundKeywordIn(note: string | null): string | null {
  if (!note) return null;
  const lower = note.toLowerCase();
  return REFUND_KEYWORDS.find((k) => lower.includes(k.toLowerCase())) ?? null;
}

export function review(txs: AggTx[], opts: { month: string; today: string }): ReviewResult {
  const inMonth = txs.filter((t) => t.date.slice(0, 7) === opts.month);
  const result: ReviewResult = { refundCandidates: [], unassigned: [], scheduled: [], duplicates: [] };
  const groups = new Map<string, AggTx[]>();

  for (const t of inMonth) {
    // 1. 返金候補（通常の収入だけ。すでに「返金」なら挙げない）
    if (t.kind === "normal" && t.type === "income") {
      if (t.categoryType === "expense") {
        result.refundCandidates.push(
          item(t, `収入なのに支出のカテゴリー（${t.categoryName ?? "名前なし"}）です。返金なら「返金」に変えると支出から引かれます`)
        );
      } else {
        const kw = refundKeywordIn(t.note);
        if (kw) result.refundCandidates.push(item(t, `メモに「${kw}」があります。返金なら「返金」に変えると支出から引かれます`));
      }
    }
    // 2. 未割り当て（カテゴリーの無い購入）
    if (t.kind === "normal" && t.type === "expense" && t.categoryId === null) {
      result.unassigned.push(item(t, "カテゴリーがありません。予算の費目にも入りません"));
    }
    // 3. 予定
    if (t.date > opts.today) {
      result.scheduled.push(item(t, "今日より後の日付です。合計には入れず「予定」に出しています"));
    }
    // 4. 重複候補の材料
    if (t.kind === "normal" && t.source !== "auto") {
      const key = [t.date, t.type, t.amount, t.categoryId ?? ""].join("|");
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
  }

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    result.duplicates.push({
      key,
      items: list.map((t) => item(t, `同じ日・同じ金額・同じカテゴリーの行が ${list.length}件あります`)).sort(byDate),
    });
  }

  result.refundCandidates.sort(byDate);
  result.unassigned.sort(byDate);
  result.scheduled.sort(byDate);
  result.duplicates.sort((a, b) => a.key.localeCompare(b.key));
  return result;
}

export function reviewCounts(r: ReviewResult): ReviewCounts {
  return {
    refundCandidates: r.refundCandidates.length,
    unassigned: r.unassigned.length,
    scheduled: r.scheduled.length,
    duplicates: r.duplicates.length,
  };
}
