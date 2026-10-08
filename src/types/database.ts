/**
 * @file database.ts
 * @description DB テーブルに対応する TypeScript 型定義。
 * Prisma が生成する型とは別に、APIレスポンスや
 * Supabase クライアントで使う素の型をここで定義する。
 */

/** 口座タイプ */
export type AccountType = "cash" | "credit_card" | "bank";

/** カテゴリタイプ */
export type TransactionType = "income" | "expense";

/** トランザクションの発生元 */
export type TransactionSource = "manual" | "csv" | "auto" | "api" | "receipt";

/** CSVインポートのステータス */
export type CsvImportStatus = "pending" | "success" | "error";

// ─── テーブル型 ───────────────────────────────────────────

export interface Profile {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  currency: string;
  created_at: string;
}

export interface Category {
  id: string;
  user_id: string | null;
  name: string;
  type: TransactionType;
  color: string | null;
  icon: string | null;
  is_default: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string | null;
  fixed_cost_id: string | null;
  amount: number;
  type: TransactionType;
  transaction_date: string; // "YYYY-MM-DD"
  note: string | null;
  source: TransactionSource;
  csv_import_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FixedCost {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string | null;
  name: string;
  amount: number;
  type: "income" | "expense";
  cycle: "weekly" | "biweekly" | "monthly" | "yearly";
  billing_day: number | null;
  billing_month: number | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CsvImport {
  id: string;
  user_id: string;
  account_id: string;
  filename: string;
  status: CsvImportStatus;
  row_count: number;
  skipped_count: number;
  imported_at: string;
}

// ─── リレーション付き型（API レスポンスで使用）───────────────

/** カテゴリ・口座情報を含む収支レコード */
export interface TransactionWithRelations extends Transaction {
  category: Pick<Category, "id" | "name" | "color" | "icon"> | null;
  account: Pick<Account, "id" | "name" | "type">;
}
