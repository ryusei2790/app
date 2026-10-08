/**
 * @file tests/api/transactions-api.test.ts
 * @description テスト一覧 B（取引 T1〜T4）の API・DB 層。
 * route handler を直接呼び、ローカル Supabase（RLS 有効）に本当に書き込んで確かめる。
 * テストは TZ=Asia/Tokyo で動く（vitest.config.ts）。本番の Vercel は UTC なので、
 * どちらの TZ でも同じ結果になる実装でなければ T3 が落ちる。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));

import { signInAs } from "../helpers/auth-state";
import { getRequest, jsonRequest, params, readJson } from "../helpers/api";
import {
  adminSql,
  closeAdminSql,
  commonCategoryId,
  createTestUser,
  seedAccount,
  seedCategory,
  type TestUser,
} from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import * as txList from "@/app/api/v1/transactions/route";
import * as txOne from "@/app/api/v1/transactions/[id]/route";
import * as accOne from "@/app/api/v1/accounts/[id]/route";
import * as catOne from "@/app/api/v1/categories/[id]/route";
import * as summary from "@/app/api/v1/dashboard/summary/route";

let U: TestUser;
let account: string;

beforeAll(async () => {
  U = await createTestUser("tx");
  account = await seedAccount(U.id);
});

afterEach(() => signInAs(null));

afterAll(async () => {
  await prisma.$disconnect();
  await closeAdminSql();
});

const asU = () => signInAs({ id: U.id, email: U.email });

async function create(body: Record<string, unknown>) {
  return txList.POST(jsonRequest("POST", "/api/v1/transactions", body));
}

describe("T1 取引の作成・更新・削除と金額のルール", () => {
  it("支出・収入を作成→更新→削除できる", async () => {
    asU();
    const exp = await create({
      account_id: account, category_id: await commonCategoryId("expense"),
      amount: 1280, type: "expense", transaction_date: "2026-10-08", note: "昼ごはん",
    });
    expect(exp.status).toBe(201);
    const e = (await readJson(exp)).data;
    expect(e.amount).toBe(1280);
    expect(e.type).toBe("expense");

    const inc = await create({ account_id: account, amount: 250000, type: "income", transaction_date: "2026-10-25" });
    expect(inc.status).toBe(201);
    const i = (await readJson(inc)).data;

    const upd = await txOne.PUT(jsonRequest("PUT", "/x", { amount: 1300, note: "大盛り" }), params(e.id));
    expect(upd.status).toBe(200);
    expect((await readJson(upd)).data).toMatchObject({ amount: 1300, note: "大盛り" });

    for (const id of [e.id, i.id]) {
      expect((await txOne.DELETE(jsonRequest("DELETE", "/x"), params(id))).status).toBe(200);
      expect((await txOne.GET(getRequest("/x"), params(id))).status).toBe(404);
    }
  });

  it.each([
    ["小数", 1.5],
    ["負数", -100],
    ["0", 0],
    ["文字列", "1000"],
  ])("作成: 金額が%sなら 422", async (_l, amount) => {
    asU();
    const res = await create({ account_id: account, amount, type: "expense", transaction_date: "2026-10-08" });
    expect(res.status).toBe(422);
  });

  it.each([["小数", 99.9], ["負数", -1], ["0", 0]])("更新: 金額が%sなら 422 で、元の金額のまま", async (_l, amount) => {
    asU();
    const { data } = await readJson(await create({ account_id: account, amount: 500, type: "expense", transaction_date: "2026-10-08" }));
    const res = await txOne.PUT(jsonRequest("PUT", "/x", { amount }), params(data.id));
    expect(res.status).toBe(422);
    const rows = await adminSql<{ amount: string }>("SELECT amount FROM transactions WHERE id=$1", [data.id]);
    expect(Number(rows[0].amount)).toBe(500);
  });

  it("DB でも小数・0・負数の金額は入らない（CHECK 制約）", async () => {
    for (const amount of [1.5, 0, -10]) {
      await expect(
        adminSql(
          `INSERT INTO transactions (user_id, account_id, amount, type, transaction_date, source)
           VALUES ($1,$2,$3,'expense','2026-10-01','manual')`,
          [U.id, account, amount]
        ),
        `amount=${amount}`
      ).rejects.toThrow();
    }
  });
});

describe("T2 日付のルール", () => {
  it.each(["2026-02-30", "abc", "2026/10/01", "2026-13-01"])("作成: %s は 422", async (d) => {
    asU();
    const res = await create({ account_id: account, amount: 100, type: "expense", transaction_date: d });
    expect(res.status).toBe(422);
  });

  it("未来日は登録できる", async () => {
    asU();
    const res = await create({ account_id: account, amount: 100, type: "expense", transaction_date: "2030-12-31" });
    expect(res.status).toBe(201);
    expect((await readJson(res)).data.transaction_date).toBe("2030-12-31");
  });

  it("更新: 不正な日付は 422", async () => {
    asU();
    const { data } = await readJson(await create({ account_id: account, amount: 100, type: "expense", transaction_date: "2026-10-01" }));
    const res = await txOne.PUT(jsonRequest("PUT", "/x", { transaction_date: "2026-02-30" }), params(data.id));
    expect(res.status).toBe(422);
  });
});

describe("T3 月別の一覧・集計は JST の月境界で正しい", () => {
  let M: TestUser;
  let macc: string;
  beforeAll(async () => {
    M = await createTestUser("month");
    macc = await seedAccount(M.id);
    // 9/30（前月末）・10/1（月初）・10/31（月末）・11/1（翌月初）
    for (const [d, amt] of [["2026-09-30", 1], ["2026-10-01", 10], ["2026-10-31", 100], ["2026-11-01", 1000]] as const) {
      await adminSql(
        `INSERT INTO transactions (user_id, account_id, amount, type, transaction_date, source)
         VALUES ($1,$2,$3,'expense',$4,'manual')`,
        [M.id, macc, amt, d]
      );
    }
  });

  it("10月の一覧は 10/1 と 10/31 だけ（9/30・11/1 は入らない）", async () => {
    signInAs({ id: M.id, email: M.email });
    const res = await txList.GET(getRequest("/api/v1/transactions?year=2026&month=10"));
    const dates = (await readJson(res)).data.map((t: { transaction_date: string }) => t.transaction_date).sort();
    expect(dates).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("10月の集計は 10 + 100 = 110 円", async () => {
    signInAs({ id: M.id, email: M.email });
    const res = await summary.GET(getRequest("/api/v1/dashboard/summary?year=2026&month=10"));
    expect((await readJson(res)).data.total_expense).toBe(110);
  });

  it("12月→翌年1月の境界も正しい", async () => {
    signInAs({ id: M.id, email: M.email });
    await adminSql(
      `INSERT INTO transactions (user_id, account_id, amount, type, transaction_date, source)
       VALUES ($1,$2,7,'expense','2026-12-31','manual'), ($1,$2,70,'expense','2027-01-01','manual')`,
      [M.id, macc]
    );
    const dec = await readJson(await summary.GET(getRequest("/x?year=2026&month=12")));
    const jan = await readJson(await summary.GET(getRequest("/x?year=2027&month=1")));
    expect(dec.data.total_expense).toBe(7);
    expect(jan.data.total_expense).toBe(70);
  });

  it("月が 1〜12 以外なら 422", async () => {
    signInAs({ id: M.id, email: M.email });
    expect((await txList.GET(getRequest("/x?year=2026&month=13"))).status).toBe(422);
    expect((await summary.GET(getRequest("/x?year=2026&month=0"))).status).toBe(422);
  });
});

describe("T4 口座・カテゴリを消しても取引が孤児にならない", () => {
  let D: TestUser;
  beforeAll(async () => {
    D = await createTestUser("del");
  });
  const asD = () => signInAs({ id: D.id, email: D.email });

  async function orphanCount() {
    const rows = await adminSql<{ n: string }>(
      `SELECT count(*) AS n FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE a.id IS NULL OR (t.category_id IS NOT NULL AND c.id IS NULL)`
    );
    return Number(rows[0].n);
  }

  it("使っていない口座・カテゴリは削除できる", async () => {
    asD();
    const acc = await seedAccount(D.id, "空の口座");
    const cat = await seedCategory(D.id, "空の費目");
    expect((await accOne.DELETE(jsonRequest("DELETE", "/x"), params(acc))).status).toBe(200);
    expect((await catOne.DELETE(jsonRequest("DELETE", "/x"), params(cat))).status).toBe(200);
  });

  it("取引で使っている口座・カテゴリは 409 で、取引はそのまま残る", async () => {
    asD();
    const acc = await seedAccount(D.id);
    const cat = await seedCategory(D.id);
    const { data } = await readJson(await create({ account_id: acc, category_id: cat, amount: 100, type: "expense", transaction_date: "2026-10-01" }));
    expect((await accOne.DELETE(jsonRequest("DELETE", "/x"), params(acc))).status).toBe(409);
    expect((await catOne.DELETE(jsonRequest("DELETE", "/x"), params(cat))).status).toBe(409);
    const rows = await adminSql("SELECT 1 FROM transactions WHERE id=$1", [data.id]);
    expect(rows).toHaveLength(1);
  });

  it("論理削除済みの取引（固定費由来）だけが残る口座・カテゴリも 409（500 にならない）", async () => {
    asD();
    const acc = await seedAccount(D.id);
    const cat = await seedCategory(D.id);
    await adminSql(
      `INSERT INTO transactions (user_id, account_id, category_id, amount, type, transaction_date, source, deleted_at)
       VALUES ($1,$2,$3,100,'expense','2026-10-01','auto', now())`,
      [D.id, acc, cat]
    );
    expect((await accOne.DELETE(jsonRequest("DELETE", "/x"), params(acc))).status).toBe(409);
    expect((await catOne.DELETE(jsonRequest("DELETE", "/x"), params(cat))).status).toBe(409);
    expect(await orphanCount()).toBe(0);
  });

  it("固定費で使っている口座・カテゴリも 409（500 にならない）", async () => {
    asD();
    const acc = await seedAccount(D.id);
    const cat = await seedCategory(D.id);
    await adminSql(
      "INSERT INTO fixed_costs (user_id, account_id, category_id, name, amount, billing_day) VALUES ($1,$2,$3,'家賃',50000,27)",
      [D.id, acc, cat]
    );
    expect((await accOne.DELETE(jsonRequest("DELETE", "/x"), params(acc))).status).toBe(409);
    expect((await catOne.DELETE(jsonRequest("DELETE", "/x"), params(cat))).status).toBe(409);
  });

  it("DB でも参照中の口座は消せない（外部キー）", async () => {
    const acc = await seedAccount(D.id);
    await adminSql(
      `INSERT INTO transactions (user_id, account_id, amount, type, transaction_date, source)
       VALUES ($1,$2,100,'expense','2026-10-01','manual')`,
      [D.id, acc]
    );
    await expect(adminSql("DELETE FROM accounts WHERE id=$1", [acc])).rejects.toThrow();
    expect(await orphanCount()).toBe(0);
  });
});
