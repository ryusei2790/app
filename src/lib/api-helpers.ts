/**
 * @file lib/api-helpers.ts
 * @description API Route 共通ヘルパー関数。
 * 認証チェック・統一レスポンス生成を担う。
 * 全エンドポイントでこのファイルを使い一貫したレスポンス形式を保証する。
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/features";
import type { ErrorCode } from "@/types/api";

// ─── レスポンスヘルパー ───────────────────────────────────

/** 成功レスポンスを返す */
export function ok<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ data, ...(meta ? { meta } : {}) }, { status });
}

/** 作成成功レスポンスを返す (201 Created) */
export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

/** エラーレスポンスを返す */
export function error(
  code: ErrorCode,
  message: string,
  status: number,
  details?: Record<string, unknown>
) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status }
  );
}

// ─── シリアライザ ─────────────────────────────────────────

/**
 * Prisma の Transaction レコード（camelCase）を
 * フロントエンド型 TransactionWithRelations（snake_case）に変換する。
 * Prisma は @map() を使っても JS プロパティ名は camelCase のまま返すため、
 * API レスポンス前にこの関数で正規化する。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeTransaction(tx: any) {
  return {
    id: tx.id,
    user_id: tx.userId,
    account_id: tx.accountId,
    category_id: tx.categoryId ?? null,
    fixed_cost_id: tx.fixedCostId ?? null,
    amount: Number(tx.amount),
    type: tx.type,
    transaction_date: tx.transactionDate instanceof Date
      ? tx.transactionDate.toISOString().split("T")[0]
      : String(tx.transactionDate).split("T")[0],
    note: tx.note ?? null,
    source: tx.source,
    csv_import_id: tx.csvImportId ?? null,
    deleted_at: tx.deletedAt ?? null,
    created_at: tx.createdAt instanceof Date
      ? tx.createdAt.toISOString()
      : String(tx.createdAt),
    updated_at: tx.updatedAt instanceof Date
      ? tx.updatedAt.toISOString()
      : String(tx.updatedAt),
    category: tx.category ?? null,
    account: tx.account ?? null,
  };
}

/**
 * Prisma の FixedCost レコード（camelCase）を
 * フロントエンド型（snake_case）に変換する。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeFixedCost(fc: any) {
  return {
    id: fc.id,
    user_id: fc.userId,
    account_id: fc.accountId,
    category_id: fc.categoryId ?? null,
    name: fc.name,
    amount: Number(fc.amount),
    type: fc.type,
    cycle: fc.cycle,
    billing_day: fc.billingDay ?? null,
    billing_month: fc.billingMonth ?? null,
    start_date: fc.startDate instanceof Date ? fc.startDate.toISOString().slice(0, 10) : fc.startDate ?? null,
    end_date: fc.endDate instanceof Date ? fc.endDate.toISOString().slice(0, 10) : fc.endDate ?? null,
    is_active: fc.isActive,
    created_at: fc.createdAt instanceof Date
      ? fc.createdAt.toISOString()
      : String(fc.createdAt),
    category: fc.category ?? null,
    account: fc.account ?? null,
  };
}

/** Prisma の Account レコードを snake_case に変換する */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeAccount(a: any) {
  return {
    id: a.id,
    user_id: a.userId,
    name: a.name,
    type: a.type,
    currency: a.currency,
    created_at: a.createdAt instanceof Date
      ? a.createdAt.toISOString()
      : String(a.createdAt),
  };
}

/** Prisma の Category レコードを snake_case に変換する */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeCategory(c: any) {
  return {
    id: c.id,
    user_id: c.userId ?? null,
    name: c.name,
    type: c.type,
    color: c.color ?? null,
    icon: c.icon ?? null,
    is_default: c.isDefault,
    created_at: c.createdAt instanceof Date
      ? c.createdAt.toISOString()
      : String(c.createdAt),
  };
}

/** Prisma の CsvImport レコードを snake_case に変換する */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeCsvImport(imp: any) {
  return {
    id: imp.id,
    user_id: imp.userId,
    account_id: imp.accountId,
    filename: imp.filename,
    status: imp.status,
    row_count: imp.rowCount,
    skipped_count: imp.skippedCount,
    imported_at: imp.importedAt instanceof Date
      ? imp.importedAt.toISOString()
      : String(imp.importedAt),
    account: imp.account ?? null,
  };
}

// ─── 認証ヘルパー ─────────────────────────────────────────

/**
 * リクエストのJWTトークンを検証してユーザーIDを返す。
 * 認証失敗時は null を返す（呼び出し側でエラーレスポンスを返すこと）。
 */
export async function getAuthUser(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  return { id: user.id, email: user.email ?? "" };
}

/**
 * 認証必須の API Route で使う共通チェック。
 * ユーザーが取得できない場合は 401 レスポンスを返す。
 *
 * @example
 * const { user, response } = await requireAuth();
 * if (response) return response; // 未認証
 */
export async function requireAuth(): Promise<
  | { user: { id: string; email: string }; response: null }
  | { user: null; response: ReturnType<typeof error> }
> {
  const user = await getAuthUser();
  if (!user) {
    return {
      user: null,
      response: error("UNAUTHORIZED", "認証が必要です", 401),
    };
  }
  return { user, response: null };
}

/**
 * 社長専用の API Route で使うチェック（S6）。
 * 未ログインは 401、ログインしていても社長（OWNER_USER_IDS）でなければ 403。
 */
export async function requireOwner(): Promise<
  | { user: { id: string; email: string }; response: null }
  | { user: null; response: ReturnType<typeof error> }
> {
  const auth = await requireAuth();
  if (auth.response) return auth;
  if (!isOwner(auth.user)) {
    return { user: null, response: error("FORBIDDEN", "この機能は使えません", 403) };
  }
  return auth;
}

/**
 * リクエストボディを JSON として読む。読めなければ 422 のレスポンスを返す。
 * 戻り値はオブジェクトに限る（配列・null・数値などは不正扱い）。
 */
export async function readJsonBody(
  request: Request
): Promise<{ body: Record<string, unknown>; response: null } | { body: null; response: ReturnType<typeof error> }> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return { body: body as Record<string, unknown>, response: null };
    }
  } catch {
    // 下で 422 を返す
  }
  return { body: null, response: error("VALIDATION_ERROR", "リクエストボディが不正です", 422) };
}
