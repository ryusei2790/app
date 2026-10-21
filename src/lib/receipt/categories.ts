/**
 * @file lib/receipt/categories.ts
 * @description レシートの明細に AI が付けるカテゴリの一覧（mywork#229 本人決定 Q2=A、2026-10-21）。
 * AI にはこの4つからだけ選ばせ、画面では利用者のカテゴリ（categories テーブル）に名前で当てはめる。
 * 既定カテゴリの「外食」は「外食費」と同じものとして扱う（CSV と同じ呼び名にそろえるため）。
 */

export const RECEIPT_CATEGORIES = ["食費", "外食費", "日用品", "その他"] as const;
export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

/** 利用者のカテゴリ名の別名（AI のカテゴリ → 探す名前の順） */
const ALIASES: Record<ReceiptCategory, string[]> = {
  食費: ["食費"],
  外食費: ["外食費", "外食"],
  日用品: ["日用品"],
  その他: ["その他"],
};

/** AI のカテゴリに合う利用者のカテゴリ ID を探す。無ければ null（未分類） */
export function matchCategoryId(category: ReceiptCategory | null, categories: { id: string; name: string }[]): string | null {
  if (!category) return null;
  for (const name of ALIASES[category]) {
    const hit = categories.find((c) => c.name === name);
    if (hit) return hit.id;
  }
  return null;
}
