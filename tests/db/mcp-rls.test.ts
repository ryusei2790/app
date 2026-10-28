/**
 * @file tests/db/mcp-rls.test.ts
 * @description AI 接続（mywork#882）の DB の守り（migration 20261028100000_mcp.sql）を、攻撃者の視点で確かめる。
 *
 * AI に渡るトークンは画面のログインと同じ authenticated の JWT（client_id だけが違う）なので、
 * anon キー（公開値）と組み合わせれば PostgREST を直接叩ける。そこで:
 *   R1 OAuth のトークンでは、自分の行であっても public の表を1行も読めない
 *   R2 書き込み（追加・更新・削除）もできない
 *   R3 画面のログイン（client_id 無し）は今までどおり自分の行を読み書きできる（守りを足して壊していない）
 *   R4 mcp_calls は本人の行だけ読めて、他人の行は読めず、他人の名前で足せず、書き換え・削除もできない
 *   R5 RLS が有効な public の表すべてに制限ポリシーが付いている（表を足したときの付け忘れを検出）
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inject } from "vitest";
import { adminSql, closeAdminSql, createTestUser, seedAccount, seedTransaction, type TestUser } from "../helpers/local-supabase";
import { obtainOAuthToken } from "../helpers/oauth";

const env = () => inject("supabase");

/** AI のトークンで PostgREST を直接叩くクライアント */
function bearerClient(token: string): SupabaseClient {
  return createClient(env().apiUrl, env().anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

let A: TestUser;
let B: TestUser;
let ai: SupabaseClient;
let accA: string;
let txA: string;

beforeAll(async () => {
  A = await createTestUser("rls-mcp-a");
  B = await createTestUser("rls-mcp-b");
  accA = await seedAccount(A.id, "Aの財布");
  txA = await seedTransaction(A.id, accA, { amount: 1234 });
  await adminSql("INSERT INTO fixed_costs (user_id, account_id, name, amount, billing_day) VALUES ($1, $2, 'Aの家賃', 80000, 27)", [A.id, accA]);
  await adminSql("INSERT INTO mcp_calls (user_id, client_id, tool) VALUES ($1, 'c-a', 'list_recent'), ($2, 'c-b', 'list_recent')", [A.id, B.id]);
  const t = await obtainOAuthToken(env().apiUrl, A.client);
  ai = bearerClient(t.access_token);
});

afterAll(async () => {
  await closeAdminSql();
});

describe("R1・R2 OAuth のトークンでは DB を直接触れない", () => {
  it("R1 自分の行でも読めない（取引・口座・定期・プロフィール・呼び出し記録）", async () => {
    for (const table of ["transactions", "accounts", "fixed_costs", "profiles", "mcp_calls", "categories"]) {
      const { data, error } = await ai.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  it("R2 追加できない", async () => {
    const tx = await ai.from("transactions").insert({ user_id: A.id, account_id: accA, amount: 1, type: "expense", transaction_date: "2026-10-01", source: "api" });
    expect(tx.error?.code).toBe("42501");
    const acc = await ai.from("accounts").insert({ user_id: A.id, name: "x", type: "cash" });
    expect(acc.error?.code).toBe("42501");
  });

  it("R2 更新・削除しても1行も変わらない", async () => {
    await ai.from("transactions").update({ amount: 1 }).eq("id", txA);
    await ai.from("transactions").delete().eq("id", txA);
    const rows = await adminSql<{ amount: string; deleted_at: Date | null }>("SELECT amount, deleted_at FROM transactions WHERE id = $1", [txA]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(1234);
  });
});

describe("R3 画面のログインは今までどおり", () => {
  it("自分の取引・口座を読める", async () => {
    const { data } = await A.client.from("transactions").select("id");
    expect(data?.map((r) => r.id)).toContain(txA);
    const acc = await A.client.from("accounts").select("id");
    expect(acc.data?.map((r) => r.id)).toContain(accA);
  });
});

describe("R4 mcp_calls", () => {
  it("本人の行だけ読める", async () => {
    const { data } = await A.client.from("mcp_calls").select("user_id");
    expect(data?.length).toBeGreaterThan(0);
    expect(data?.every((r) => r.user_id === A.id)).toBe(true);
  });

  it("他人の名前では足せない・書き換え・削除はできない", async () => {
    const ins = await A.client.from("mcp_calls").insert({ user_id: B.id, client_id: "x", tool: "add_expense" });
    expect(ins.error?.code).toBe("42501");
    await A.client.from("mcp_calls").delete().eq("user_id", A.id);
    await A.client.from("mcp_calls").update({ ok: false }).eq("user_id", A.id);
    const rows = await adminSql<{ ok: boolean }>("SELECT ok FROM mcp_calls WHERE user_id = $1", [A.id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.ok)).toBe(true);
  });
});

describe("R5 付け忘れの検出", () => {
  it("RLS が有効な public の表すべてに no_oauth_client_direct_access が付いている", async () => {
    const missing = await adminSql<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
         AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
                         AND p.policyname = 'no_oauth_client_direct_access' AND p.permissive = 'RESTRICTIVE')`
    );
    expect(missing.map((r) => r.relname)).toEqual([]);
  });
});
