/**
 * @file api.ts
 * @description API リクエスト・レスポンスの型定義。
 * 全エンドポイントで統一した JSON 構造を型で保証する。
 */

import type { TransactionKind } from "@/lib/aggregate/definitions";
import type { MonthSummary as BudgetMonthSummary } from "@/lib/budget/summary";

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
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "CANCELLED"
  | "INTERNAL_ERROR";

// ─── Transactions ─────────────────────────────────────

export interface CreateTransactionRequest {
  account_id: string;
  category_id?: string;
  amount: number;
  type: "income" | "expense";
  /** 取引の種類（既定 normal）。返金は type: "income" とだけ組める（lib/aggregate/definitions.ts） */
  kind?: TransactionKind;
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
  /** 固定の判定: メモに含まれる語句（空なら見ない） */
  match_note?: string | null;
  /** 固定の判定: true なら金額を見ない */
  match_any_amount?: boolean;
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

// ─── Summary（統一集計 API /api/v1/summary。mywork#425 第1弾） ─────────

export type PeriodStatus = "past" | "current" | "future";

export interface SummaryResponse {
  definitions_version: string;
  month: string;
  today: string;
  period: { start: string; end: string; status: PeriodStatus };
  expense: { total: number; purchases: number; refunds: number; purchase_count: number; refund_count: number; refund_heavy: boolean };
  income: { total: number; count: number };
  transfers: { out: number; in: number; count: number };
  loans: { repaid: number; borrowed: number; count: number };
  /** 今日より後の日付の取引（定期のまだ来ていない回は upcoming） */
  scheduled: { expense: number; income: number; count: number; items: ScheduledItem[] };
  /** 収入 − 支出（今日まで） */
  balance: number;
  fixed: DashboardSummary["fixed"];
  by_category: CategorySummary[];
  /** 予算の費目（社長だけ。他は null） */
  frames: BudgetMonthSummary | null;
  review: { refund_candidates: number; unassigned: number; scheduled: number; duplicates: number };
  upcoming: UpcomingItem[];
  /** 互換（同じ数字） */
  total_income: number;
  total_expense: number;
}

export interface ScheduledItem {
  id: string | null;
  date: string;
  name: string;
  type: "income" | "expense";
  kind: TransactionKind;
  amount: number;
}

// ─── Dashboard（古い型。/api/v1/dashboard/summary も同じ数字を返す） ───────

export interface DashboardSummary {
  total_income: number;
  total_expense: number;
  balance: number;
  by_category: CategorySummary[];
  /** 固定／変動の内訳（mywork#229 F8）。固定＋変動＝合計 */
  fixed: {
    fixed_income: number;
    variable_income: number;
    fixed_expense: number;
    variable_expense: number;
  };
  /** 今月の予定（未確定）。定期のまだ取引になっていない回。合計には入らない */
  upcoming: UpcomingItem[];
}

export interface UpcomingItem {
  fixed_cost_id: string;
  date: string;
  name: string;
  type: "income" | "expense";
  amount: number;
}

export interface CategorySummary {
  category_id: string;
  name: string;
  color: string | null;
  /** 購入 − 返金（返金が多ければ負になりうる） */
  amount: number;
  purchases?: number;
  refunds?: number;
  count?: number;
  ratio: number;
}
