/**
 * @file tests/db/security-rls.test.ts
 * @description テスト一覧 A（セキュリティ）の DB 層。ローカル Supabase に「本物の JWT」で繋ぎ、
 * ブラウザから anon キー＋ログインで直接 DB を叩かれた場合にも RLS が守るかを確かめる。
 * anon キーは公開される値なので、アプリを経由しない直接アクセスはいつでも起こりうる。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminSql,
  anonClient,
  closeAdminSql,
  commonCategoryId,
  createTestUser,
  seedAccount,
  seedCategory,
  seedTransaction,
  type TestUser,
} from "../helpers/local-supabase";

/** アプリが使う表（public スキーマ）。新しい表を足したらここにも足す */
const APP_TABLES = [
  "profiles", "accounts", "categories", "fixed_costs", "csv_imports", "transactions", "receipt_parse_logs",
];

let A: TestUser;
let B: TestUser;
let aAccount: string;
let aCategory: string;
let aTx: string;
let bAccount: string;
let bTx: string;
let aFixedCost: string;

beforeAll(async () => {
  A = await createTestUser("a");
  B = await createTestUser("b");
  aAccount = await seedAccount(A.id, "Aの財布");
  aCategory = await seedCategory(A.id, "Aの費目");
  aTx = await seedTransaction(A.id, aAccount, { amount: 5000, date: "2026-10-10" });
  bAccount = await seedAccount(B.id, "Bの財布");
  bTx = await seedTransaction(B.id, bAccount, { amount: 300, date: "2026-10-11" });
  const fc = await adminSql<{ id: string }>(
    "INSERT INTO fixed_costs (user_id, account_id, name, amount, billing_day) VALUES ($1,$2,'Aの家賃',80000,27) RETURNING id",
    [A.id, aAccount]
  );
  aFixedCost = fc[0].id;
  await adminSql(
    "INSERT INTO csv_imports (user_id, account_id, filename) VALUES ($1,$2,'a.csv')",
    [A.id, aAccount]
  );
});

afterAll(async () => {
  await closeAdminSql();
});

describe("S1 他人の行は読めない", () => {
  it("B の JWT で A の transactions を select すると0件", async () => {
    const { data, error } = await B.client.from("transactions").select("*").eq("user_id", A.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const byId = await B.client.from("transactions").select("*").eq("id", aTx);
    expect(byId.data).toEqual([]);
  });

  it("B からは A の口座・独自カテゴリ・固定費・CSV 履歴・プロフィールも見えない", async () => {
    for (const table of ["accounts", "fixed_costs", "csv_imports"]) {
      const { data } = await B.client.from(table).select("*").eq("user_id", A.id);
      expect(data, table).toEqual([]);
    }
    const cat = await B.client.from("categories").select("*").eq("id", aCategory);
    expect(cat.data).toEqual([]);
    const prof = await B.client.from("profiles").select("*").eq("id", A.id);
    expect(prof.data).toEqual([]);
  });

  it("自分の行と共通カテゴリは読める（守りすぎていない）", async () => {
    const own = await B.client.from("transactions").select("id");
    expect(own.data?.map((r) => r.id)).toEqual([bTx]);
    const common = await B.client.from("categories").select("id").is("user_id", null);
    expect(common.data?.length).toBeGreaterThan(0);
  });
});

describe("S2 他人の行は書き換え・削除できない", () => {
  it("B が A の取引を update しても0行で、A の行は変わらない", async () => {
    const { data } = await B.client.from("transactions").update({ amount: 1 }).eq("id", aTx).select();
    expect(data ?? []).toEqual([]);
    const rows = await adminSql<{ amount: string }>("SELECT amount FROM transactions WHERE id=$1", [aTx]);
    expect(Number(rows[0].amount)).toBe(5000);
  });

  it("B が A の取引を delete しても0行で、A の行は残る", async () => {
    const { data } = await B.client.from("transactions").delete().eq("id", aTx).select();
    expect(data ?? []).toEqual([]);
    const rows = await adminSql("SELECT 1 FROM transactions WHERE id=$1", [aTx]);
    expect(rows).toHaveLength(1);
  });

  it("B が A の口座・固定費を update / delete しても0行", async () => {
    const acc = await B.client.from("accounts").update({ name: "乗っ取り" }).eq("id", aAccount).select();
    expect(acc.data ?? []).toEqual([]);
    const fc = await B.client.from("fixed_costs").delete().eq("id", aFixedCost).select();
    expect(fc.data ?? []).toEqual([]);
    const rows = await adminSql<{ name: string }>("SELECT name FROM accounts WHERE id=$1", [aAccount]);
    expect(rows[0].name).toBe("Aの財布");
  });

  it("B が自分の取引の user_id を A に付け替えることはできない", async () => {
    const { error } = await B.client.from("transactions").update({ user_id: A.id }).eq("id", bTx).select();
    expect(error).not.toBeNull();
  });
});

describe("S3 他人の口座・カテゴリを自分の取引に使えない（DB の WITH CHECK）", () => {
  it("B が A の account_id で取引を insert すると拒否", async () => {
    const { error } = await B.client.from("transactions").insert({
      user_id: B.id, account_id: aAccount, amount: 100, type: "expense",
      transaction_date: "2026-10-12", source: "manual",
    });
    expect(error).not.toBeNull();
  });

  it("B が A の category_id で取引を insert すると拒否", async () => {
    const { error } = await B.client.from("transactions").insert({
      user_id: B.id, account_id: bAccount, category_id: aCategory, amount: 100, type: "expense",
      transaction_date: "2026-10-12", source: "manual",
    });
    expect(error).not.toBeNull();
  });

  it("B が自分の取引を A の口座・カテゴリに update すると拒否", async () => {
    const acc = await B.client.from("transactions").update({ account_id: aAccount }).eq("id", bTx).select();
    expect(acc.error).not.toBeNull();
    const cat = await B.client.from("transactions").update({ category_id: aCategory }).eq("id", bTx).select();
    expect(cat.error).not.toBeNull();
    const rows = await adminSql<{ account_id: string; category_id: string | null }>(
      "SELECT account_id, category_id FROM transactions WHERE id=$1", [bTx]
    );
    expect(rows[0]).toEqual({ account_id: bAccount, category_id: null });
  });

  it("B が A の固定費・口座を指す固定費や取引を作れない", async () => {
    const fc = await B.client.from("fixed_costs").insert({
      user_id: B.id, account_id: aAccount, name: "x", amount: 100, billing_day: 1,
    });
    expect(fc.error).not.toBeNull();
    const tx = await B.client.from("transactions").insert({
      user_id: B.id, account_id: bAccount, fixed_cost_id: aFixedCost, amount: 100, type: "expense",
      transaction_date: "2026-10-12", source: "auto",
    });
    expect(tx.error).not.toBeNull();
  });

  it("自分の口座＋共通カテゴリなら insert できる（守りすぎていない）", async () => {
    const { error } = await B.client.from("transactions").insert({
      user_id: B.id, account_id: bAccount, category_id: await commonCategoryId(), amount: 100,
      type: "expense", transaction_date: "2026-10-12", source: "manual",
    });
    expect(error).toBeNull();
  });
});

describe("S4 未ログイン（anon キーのみ）は全テーブルで拒否", () => {
  it.each(APP_TABLES)("%s を select するとエラー", async (table) => {
    const { error } = await anonClient().from(table).select("*").limit(1);
    expect(error).not.toBeNull();
  });

  it.each(APP_TABLES.filter((t) => t !== "profiles"))("%s に insert するとエラー", async (table) => {
    const { error } = await anonClient().from(table).insert({ user_id: A.id, name: "x" });
    expect(error).not.toBeNull();
  });
});

describe("S5 全テーブルで RLS が有効", () => {
  it("public スキーマの全テーブルで rowsecurity = true", async () => {
    const rows = await adminSql<{ tablename: string; rowsecurity: boolean }>(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'"
    );
    expect(rows.length).toBeGreaterThanOrEqual(APP_TABLES.length);
    for (const r of rows) expect(r.rowsecurity, r.tablename).toBe(true);
  });

  it("どのポリシーも anon / public ロールに与えていない（ログイン済みだけが対象）", async () => {
    const rows = await adminSql<{ tablename: string; policyname: string; roles: string[] | string }>(
      "SELECT tablename, policyname, roles FROM pg_policies WHERE schemaname = 'public'"
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const roles = Array.isArray(r.roles) ? r.roles : String(r.roles).replace(/[{}]/g, "").split(",");
      expect(roles, `${r.tablename}.${r.policyname}`).toEqual(["authenticated"]);
    }
  });
});

describe("S8 レポート用 RPC は自分の分しか集計しない", () => {
  it("monthly_summary は呼んだ本人の取引だけを合計する", async () => {
    const { data, error } = await B.client.rpc("monthly_summary", { p_year: 2026, p_month: 10 });
    expect(error).toBeNull();
    const total = (data as { type: string; total: number }[])
      .filter((r) => r.type === "expense")
      .reduce((s, r) => s + Number(r.total), 0);
    // 期待値は管理者接続で数えた「B 本人の10月の支出」。A の 5000 が混ざっていないこと
    const expected = await adminSql<{ s: string }>(
      `SELECT COALESCE(SUM(amount),0) AS s FROM transactions
        WHERE user_id=$1 AND type='expense' AND deleted_at IS NULL
          AND transaction_date >= '2026-10-01' AND transaction_date < '2026-11-01'`,
      [B.id]
    );
    expect(total).toBe(Number(expected[0].s));
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(5000);
  });

  it("未ログインでは monthly_summary を呼べない", async () => {
    const { error } = await anonClient().rpc("monthly_summary", { p_year: 2026, p_month: 10 });
    expect(error).not.toBeNull();
  });
});
