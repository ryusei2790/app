/**
 * @file lib/fixed/classify.ts
 * @description 取引1件を「固定」か「変動」かに分ける純粋関数（テスト一覧 F1〜F4・F6・F8、mywork#229）。
 *
 * 固定かどうかは取引に保存せず、集計のたびに「定期（fixed_costs）の当てはまる条件」で決める。
 * こうすると定期の一覧を直したとき、過去の月の集計もさかのぼって直る（F6。予算の費目 lib/budget/classify.ts と同じ考え方）。
 *
 * 判定の順番:
 *   1. 定期から自動で作った取引（source='auto'）は無条件で固定（F1）
 *   2. それ以外（手入力・CSV・レシート）は、どれか1つの定期の条件にそろえば固定（F2）
 *        - 種別（収入／支出）が同じ
 *        - 定期にカテゴリーがあればカテゴリーが同じ
 *        - 定期にメモの語句があれば、取引のメモに部分一致（大文字小文字を区別しない: F3）
 *        - 「金額が毎回変わる」でなければ金額が同じ（F4）
 *      ただしメモの語句もカテゴリーも無い定期は、金額だけで何でも固定にしてしまうので当てはめない
 *   3. どれにも当たらなければ変動
 */

export interface FixedCondition {
  /** 定期の id（当てはまった件数を数えるのに使う） */
  id: string;
  type: "income" | "expense";
  categoryId: string | null;
  /** 正の金額（円） */
  amount: number;
  /** メモに含まれる語句。null・空なら見ない */
  matchNote: string | null;
  /** true なら金額を見ない（値上げ・為替で毎回変わるもの） */
  matchAnyAmount: boolean;
}

export interface FixedTx {
  /** "YYYY-MM-DD" */
  date: string;
  /** 正の金額（円） */
  amount: number;
  type: "income" | "expense";
  categoryId: string | null;
  note: string | null;
  source: string;
}

export type FixedKind = "fixed" | "variable";

export interface FixedSummary {
  fixedIncome: number;
  variableIncome: number;
  fixedExpense: number;
  variableExpense: number;
}

const normalizedNote = (s: string | null) => (s ?? "").trim().toLowerCase();

/** 手入力・CSV の取引が、ある定期の条件にそろうか（source は見ない） */
export function matchesCondition(tx: FixedTx, c: FixedCondition): boolean {
  const keyword = normalizedNote(c.matchNote);
  // 語句もカテゴリーも無い条件は当てはめない（金額が同じだけの偶然の一致を固定にしない）
  if (keyword === "" && c.categoryId === null) return false;
  if (tx.type !== c.type) return false;
  if (c.categoryId !== null && tx.categoryId !== c.categoryId) return false;
  if (keyword !== "" && !normalizedNote(tx.note).includes(keyword)) return false;
  if (!c.matchAnyAmount && tx.amount !== c.amount) return false;
  return true;
}

export function classifyFixed(tx: FixedTx, conditions: FixedCondition[]): FixedKind {
  if (tx.source === "auto") return "fixed";
  return conditions.some((c) => matchesCondition(tx, c)) ? "fixed" : "variable";
}

/** 渡した取引（ふつうは1か月分）を固定／変動 × 収入／支出に分けて足す（F8） */
export function summarizeFixed(txs: FixedTx[], conditions: FixedCondition[]): FixedSummary {
  const s: FixedSummary = { fixedIncome: 0, variableIncome: 0, fixedExpense: 0, variableExpense: 0 };
  for (const tx of txs) {
    const fixed = classifyFixed(tx, conditions) === "fixed";
    if (tx.type === "income") {
      if (fixed) s.fixedIncome += tx.amount;
      else s.variableIncome += tx.amount;
    } else if (fixed) s.fixedExpense += tx.amount;
    else s.variableExpense += tx.amount;
  }
  return s;
}

/**
 * 定期ごとに、条件に当てはまった手入力・CSV の取引の件数（定期の一覧で「当てはまった件数」として見せる）。
 * 自動で作った取引は定期の id で数えられるので、ここでは条件での一致だけを数える。
 */
export function countMatches(txs: FixedTx[], conditions: FixedCondition[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(conditions.map((c) => [c.id, 0]));
  for (const tx of txs) {
    if (tx.source === "auto") continue;
    for (const c of conditions) if (matchesCondition(tx, c)) out[c.id] += 1;
  }
  return out;
}

/**
 * 定期のある回（date）の期間に、条件に当てはまる手入力・CSV の取引が既にあるか（F7 の部品）。
 * 期間は 毎月・毎年＝同じ月、毎週・隔週＝同じ日。CSV で入れた仕送り（9/27）があれば、定期は 9月分を作らない。
 */
export function hasMatchingInPeriod(
  txs: FixedTx[],
  c: FixedCondition,
  date: string,
  cycle: "weekly" | "biweekly" | "monthly" | "yearly"
): boolean {
  const samePeriod = cycle === "weekly" || cycle === "biweekly"
    ? (d: string) => d === date
    : (d: string) => d.slice(0, 7) === date.slice(0, 7);
  return txs.some((tx) => tx.source !== "auto" && samePeriod(tx.date) && matchesCondition(tx, c));
}
