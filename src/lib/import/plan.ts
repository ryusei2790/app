/**
 * @file lib/import/plan.ts
 * @description 取り込み計画を作る純粋関数（テスト一覧 I4〜I8）。DB には触らない。
 *
 * 目印付きの行を、次の4つに分ける:
 *   - fresh         新規 … 取引にする
 *   - already       取り込み済み … 目印がもう DB にある（何回入れても増えない: I4〜I6）
 *   - recurringDone 定期で作成済み … 定期支出から自動で作った取引と同じ行（I8）
 *   - future        予定 … 今日（JST）より後の行。取引にはせず、定期支出にするかを本人が選ぶ（I7）
 *
 * DB から読んだ「既存の目印」「定期の自動取引」「登録済みの定期」を引数でもらう。
 * こうするとテストで DB 無しに確かめられ、API 側は読み込み→計画→保存の順で
 * トランザクションを短くできる。commit でも計画を作り直し、preview の結果は信用しない。
 */

import type { KeyedRow } from "@/lib/csv/import-key";

/** 定期から自動で作られた取引（source='auto'）。照合に使う項目だけ */
export interface AutoTx {
  date: string;
  amount: number;
  type: "income" | "expense";
  /** カテゴリー無しは "" */
  categoryName: string;
}

/** 登録済みの毎月の定期（有効なもの） */
export interface ScheduledFixedCost {
  amount: number;
  type: "income" | "expense";
  categoryName: string;
  billingDay: number;
}

export interface PlanInput {
  rows: KeyedRow[];
  /** JST の今日 "YYYY-MM-DD"。これより後の行が予定 */
  today: string;
  existingKeys: Set<string>;
  autoTransactions: AutoTx[];
  scheduled: ScheduledFixedCost[];
}

export type FutureRow = KeyedRow & {
  /** 毎月の支払日（日付の日。31日は月末に丸めるのは定期支出側） */
  billingDay: number;
  /** 同じ定期がもう登録済み（またはこのファイルの前の行で選ばれる）なら true。初期値で選ばない */
  alreadyScheduled: boolean;
};

export interface ImportPlan {
  fresh: KeyedRow[];
  already: KeyedRow[];
  recurringDone: KeyedRow[];
  future: FutureRow[];
}

const scheduleSig = (s: { amount: number; type: string; categoryName: string; billingDay: number }) =>
  `${s.type}\n${s.amount}\n${s.categoryName}\n${s.billingDay}`;
const autoSig = (s: { date: string; amount: number; type: string; categoryName: string }) =>
  `${s.date}\n${s.type}\n${s.amount}\n${s.categoryName}`;

export function buildImportPlan(input: PlanInput): ImportPlan {
  const plan: ImportPlan = { fresh: [], already: [], recurringDone: [], future: [] };

  // 自動取引は「1件で1行だけ」とばせるよう、内容ごとの残り件数で持つ（多重集合）
  const autoLeft = new Map<string, number>();
  for (const a of input.autoTransactions) autoLeft.set(autoSig(a), (autoLeft.get(autoSig(a)) ?? 0) + 1);

  // 登録済みの定期。このファイルで選ばれる予定もここに足し、同じ定期を2つ作らない
  const scheduled = new Set(input.scheduled.map(scheduleSig));

  for (const row of input.rows) {
    // 1. 今日より後 → 予定（"YYYY-MM-DD" は文字列比較で前後が分かる）
    if (row.date > input.today) {
      const billingDay = Number(row.date.slice(8, 10));
      const sig = scheduleSig({ ...row, billingDay });
      const alreadyScheduled = scheduled.has(sig);
      scheduled.add(sig);
      plan.future.push({ ...row, billingDay, alreadyScheduled });
      continue;
    }
    // 2. 目印が DB にある → 取り込み済み（自動取引とは照合しない）
    if (input.existingKeys.has(row.importKey)) {
      plan.already.push(row);
      continue;
    }
    // 3. 同じ日・金額・種別・カテゴリーの自動取引が残っていれば、それを1件使ってとばす
    const sig = autoSig(row);
    const left = autoLeft.get(sig) ?? 0;
    if (left > 0) {
      autoLeft.set(sig, left - 1);
      plan.recurringDone.push(row);
      continue;
    }
    // 4. どれでもない → 新規
    plan.fresh.push(row);
  }
  return plan;
}
