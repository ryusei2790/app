/**
 * @file api.ts
 * @description API リクエスト・レスポンスの型定義。
 * 全エンドポイントで統一した JSON 構造を型で保証する。
 */

// ─── 共通レスポンス形式 ──────────────────────────────────

/** 成功レスポンスの共通ラッパー */
export interface ApiSuccess<T> {
  data: T;
  meta?: ApiMeta;
}

/** ページネーションメタ情報 */
export interface ApiMeta {
  total: number;
  page?: number;
  per_page?: number;
}

/** エラーレスポンスの共通ラッパー */
export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** エラーコード一覧 */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR";

// ─── Transactions ─────────────────────────────────────

export interface CreateTransactionRequest {
  account_id: string;
  category_id?: string;
  amount: number;
  type: "income" | "expense";
  transaction_date: string; // "YYYY-MM-DD"
  note?: string;
  source: "manual";
}

export type UpdateTransactionRequest = Partial<Omit<CreateTransactionRequest, "source">>;

export interface TransactionQuery {
  year: number;
  month: number;
  account_id?: string;
  category_id?: string;
  type?: "income" | "expense";
  source?: "manual" | "csv" | "auto";
}

// ─── Categories ──────────────────────────────────────

export interface CreateCategoryRequest {
  name: string;
  type: "income" | "expense";
  color?: string;
  icon?: string;
}

// ─── Accounts ────────────────────────────────────────

export interface CreateAccountRequest {
  name: string;
  type: "cash" | "credit_card" | "bank";
  currency?: string;
}

// ─── Fixed Costs ─────────────────────────────────────

export interface CreateFixedCostRequest {
  account_id: string;
  category_id?: string;
  name: string;
  amount: number;
  type?: "income" | "expense";
  cycle?: "weekly" | "biweekly" | "monthly" | "yearly";
  /** 毎月・毎年で必須。毎週・隔週は不要（開始日の曜日で決まる） */
  billing_day?: number | null;
  /** 毎年で必須 */
  billing_month?: number | null;
  start_date?: string;
  end_date?: string | null;
  is_active?: boolean;
}

// ─── CSV Import ──────────────────────────────────────

export interface ImportResult {
  import_id: string;
  imported_count: number;
  skipped_count: number;
  preview: CsvPreviewRow[];
}

export interface CsvPreviewRow {
  transaction_date: string;
  note: string;
  amount: number;
}

// ─── Dashboard ───────────────────────────────────────

export interface DashboardSummary {
  total_income: number;
  total_expense: number;
  balance: number;
  by_category: CategorySummary[];
}

export interface CategorySummary {
  category_id: string;
  name: string;
  color: string | null;
  amount: number;
  ratio: number;
}
