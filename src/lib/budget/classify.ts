/**
 * @file lib/budget/classify.ts
 * @description 取引1件を予算の費目に振り分ける純粋関数（テスト一覧 M2〜M4・M7）。
 *
 * 振り分けは取引に保存せず、集計のたびに対応表で決める（設計「仮に決めたこと」4）。
 * こうすると対応表を直したとき、過去の月の集計もさかのぼって直る（M7）。
 *
 * 順番:
 *   0. 収入は枠に入れない（kind: "income"）
 *   1. メモの語句ルール（大文字小文字を区別しない部分一致）を priority 順に。カテゴリー指定付きならカテゴリーも一致が条件
 *   2. カテゴリーのルールを priority 順に
 *   3. どれにも当たらない → 未割り当て（0円扱いにせず、画面で警告する: M3）
 * ルールの frameId が null なら「枠の外」（家賃・事業など、6万円の対象外: M4）。
 */

export interface BudgetRule {
  id: string;
  categoryId: string | null;
  memoKeyword: string | null;
  /** null = 枠の外 */
  frameId: string | null;
  /** 小さいほど先 */
  priority: number;
}

export interface BudgetTx {
  /** YYYY-MM-DD */
  date: string;
  /** 正の金額（円） */
  amount: number;
  type: "income" | "expense";
  categoryId: string | null;
  categoryName?: string | null;
  note: string | null;
}

export type Bucket =
  | { kind: "frame"; frameId: string }
  | { kind: "outside" }
  | { kind: "unassigned" }
  | { kind: "income" };

/** ルールを「語句ルール → カテゴリールール」「それぞれ priority 順」に並べる。集計で何度も呼ぶので1回だけ */
export function sortRules(rules: BudgetRule[]): BudgetRule[] {
  return [...rules].sort((a, b) => {
    const ka = a.memoKeyword ? 0 : 1;
    const kb = b.memoKeyword ? 0 : 1;
    return ka - kb || a.priority - b.priority || a.id.localeCompare(b.id);
  });
}

function matches(rule: BudgetRule, tx: BudgetTx): boolean {
  if (rule.memoKeyword) {
    const note = (tx.note ?? "").toLowerCase();
    if (!note.includes(rule.memoKeyword.toLowerCase())) return false;
    // 語句ルールにカテゴリーも付いていれば、両方そろったときだけ
    return rule.categoryId === null || rule.categoryId === tx.categoryId;
  }
  return rule.categoryId !== null && rule.categoryId === tx.categoryId;
}

/**
 * @param sortedRules sortRules 済みならそのまま使う（呼ぶ側で1回だけ並べ替えると速い）。未整列でも正しく動く
 */
export function classify(tx: BudgetTx, rules: BudgetRule[], sortedRules?: BudgetRule[]): Bucket {
  if (tx.type === "income") return { kind: "income" };
  for (const rule of sortedRules ?? sortRules(rules)) {
    if (!matches(rule, tx)) continue;
    return rule.frameId === null ? { kind: "outside" } : { kind: "frame", frameId: rule.frameId };
  }
  return { kind: "unassigned" };
}
