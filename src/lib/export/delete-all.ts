/**
 * @file lib/export/delete-all.ts
 * @description 全削除（mywork#425 第2弾、設計書 4-11、テスト X4）。
 *
 * 本人の全表（口座・自分のカテゴリー・定期・取り込み履歴・取引・レシート・費目・対応表）を1つのトランザクションで消す。
 * 残すもの: auth のユーザー（ログインはそのままできる）・profiles・共通カテゴリー・レシートの読み取り回数の記録
 * （回数の記録は上限の計算に使う。消すと上限を回避できてしまうので残す）。
 *
 * withUserDb の中で呼ぶ。RLS の DELETE ポリシー（本人の行だけ）と where: { userId } の二重で、他人の行は消えない。
 * 取り返しがつかないので、確認語（DELETE_CONFIRM_WORD）の検査は route で、直前のバックアップは画面で必須にしている。
 */

import type { UserDb } from "@/lib/db";

/** 全削除の確認語。前後の空白も許さず、この文字列と完全に一致したときだけ消す */
export const DELETE_CONFIRM_WORD = "削除";

export interface DeleteAllCounts {
  receipts: number;
  transactions: number;
  budget_rules: number;
  budget_frames: number;
  fixed_costs: number;
  csv_imports: number;
  categories: number;
  accounts: number;
}

/**
 * 参照されている側を後に消す（外部キーの向き）:
 *   レシート → 取引 → 対応表 → 費目 → 定期 → 取り込み履歴 → カテゴリー → 口座
 * 取引は論理削除した行（deleted_at あり）も含めて物理削除する（帳簿を空にするため）。
 */
export async function deleteAllData(db: UserDb, userId: string): Promise<DeleteAllCounts> {
  const where = { userId };
  const receipts = await db.receipt.deleteMany({ where });
  const transactions = await db.transaction.deleteMany({ where });
  const budgetRules = await db.budgetRule.deleteMany({ where });
  const budgetFrames = await db.budgetFrame.deleteMany({ where });
  const fixedCosts = await db.fixedCost.deleteMany({ where });
  const csvImports = await db.csvImport.deleteMany({ where });
  const categories = await db.category.deleteMany({ where });
  const accounts = await db.account.deleteMany({ where });
  return {
    receipts: receipts.count,
    transactions: transactions.count,
    budget_rules: budgetRules.count,
    budget_frames: budgetFrames.count,
    fixed_costs: fixedCosts.count,
    csv_imports: csvImports.count,
    categories: categories.count,
    accounts: accounts.count,
  };
}
