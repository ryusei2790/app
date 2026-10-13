/**
 * @file tests/helpers/local-supabase.ts
 * @description db テスト用の道具。ローカル Supabase だけを相手にする。
 * - createTestUser(): Auth にユーザーを作り、そのユーザーの JWT で動く supabase-js を返す
 *   （＝ブラウザから anon キー＋ログインで直接 DB を叩く「攻撃者の視点」をそのまま再現できる）
 * - anonClient(): 未ログイン（anon キーのみ）の supabase-js
 * - adminSql(): RLS を通らない管理者接続（前提データの用意・検査専用。アプリの経路ではない）
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { inject } from "vitest";

const env = () => inject("supabase");

export interface TestUser {
  id: string;
  email: string;
  /** このユーザーの JWT で動く supabase-js（RLS がそのまま効く） */
  client: SupabaseClient;
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

export function anonClient(): SupabaseClient {
  return createClient(env().apiUrl, env().anonKey, noPersist);
}

function serviceClient(): SupabaseClient {
  return createClient(env().apiUrl, env().serviceRoleKey, noPersist);
}

/** Auth にユーザーを1人作ってログインした状態のクライアントを返す */
export async function createTestUser(label = "user"): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const admin = serviceClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("ユーザー作成に失敗");

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

let pool: Pool | null = null;

/** 管理者接続で SQL を流す（前提データの用意と検査だけに使う） */
export async function adminSql<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  pool ??= new Pool({ connectionString: env().dbUrl, max: 2 });
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function closeAdminSql() {
  await pool?.end();
  pool = null;
}

/** 口座を1つ作る（管理者接続。テストの前提データ用） */
export async function seedAccount(userId: string, name = "財布"): Promise<string> {
  const rows = await adminSql<{ id: string }>(
    "INSERT INTO accounts (user_id, name, type) VALUES ($1, $2, 'cash') RETURNING id",
    [userId, name]
  );
  return rows[0].id;
}

/** ユーザー独自カテゴリを1つ作る */
export async function seedCategory(userId: string, name = "自分の費目"): Promise<string> {
  const rows = await adminSql<{ id: string }>(
    "INSERT INTO categories (user_id, name, type) VALUES ($1, $2, 'expense') RETURNING id",
    [userId, name]
  );
  return rows[0].id;
}

/** 取引を1件作る */
export async function seedTransaction(
  userId: string,
  accountId: string,
  opts: { amount?: number; date?: string; type?: "income" | "expense"; categoryId?: string | null } = {}
): Promise<string> {
  const rows = await adminSql<{ id: string }>(
    `INSERT INTO transactions (user_id, account_id, category_id, amount, type, transaction_date, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual') RETURNING id`,
    [
      userId,
      accountId,
      opts.categoryId ?? null,
      opts.amount ?? 1000,
      opts.type ?? "expense",
      opts.date ?? "2026-10-15",
    ]
  );
  return rows[0].id;
}

/** 共通カテゴリ（user_id IS NULL）の id を1つ返す */
export async function commonCategoryId(type: "income" | "expense" = "expense"): Promise<string> {
  const rows = await adminSql<{ id: string }>(
    "SELECT id FROM categories WHERE user_id IS NULL AND type = $1 ORDER BY created_at LIMIT 1",
    [type]
  );
  return rows[0].id;
}
