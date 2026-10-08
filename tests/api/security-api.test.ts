/**
 * @file tests/api/security-api.test.ts
 * @description テスト一覧 A（セキュリティ）の API 層。route handler を直接呼ぶ。
 * ログイン中のユーザーだけを差し替え（auth-state）、DB は本物のローカル Supabase を使う。
 * DB 層（tests/db）と合わせて「アプリ側の所有確認」と「RLS」の二重の守りを確かめる。
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
  seedTransaction,
  type TestUser,
} from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import * as txList from "@/app/api/v1/transactions/route";
import * as txOne from "@/app/api/v1/transactions/[id]/route";
import * as accList from "@/app/api/v1/accounts/route";
import * as accOne from "@/app/api/v1/accounts/[id]/route";
import * as catList from "@/app/api/v1/categories/route";
import * as catOne from "@/app/api/v1/categories/[id]/route";
import * as fcList from "@/app/api/v1/fixed-costs/route";
import * as fcOne from "@/app/api/v1/fixed-costs/[id]/route";
import * as fcGen from "@/app/api/v1/fixed-costs/generate/route";
import * as importRoute from "@/app/api/v1/import/route";
import * as summary from "@/app/api/v1/dashboard/summary/route";

let A: TestUser;
let B: TestUser;
let aAccount: string;
let aCategory: string;
let aTx: string;
let aFixedCost: string;
let bAccount: string;
let bTx: string;
let bFixedCost: string;

const asB = () => signInAs({ id: B.id, email: B.email });

beforeAll(async () => {
  A = await createTestUser("api-a");
  B = await createTestUser("api-b");
  aAccount = await seedAccount(A.id, "Aの口座");
  aCategory = await seedCategory(A.id, "Aの費目");
  aTx = await seedTransaction(A.id, aAccount, { amount: 9000, date: "2026-10-05" });
  bAccount = await seedAccount(B.id, "Bの口座");
  bTx = await seedTransaction(B.id, bAccount, { amount: 120, date: "2026-10-06" });
  const fcs = await adminSql<{ id: string; user_id: string }>(
    `INSERT INTO fixed_costs (user_id, account_id, name, amount, billing_day)
     VALUES ($1,$2,'Aの家賃',80000,27), ($3,$4,'Bのサブスク',990,1) RETURNING id, user_id`,
    [A.id, aAccount, B.id, bAccount]
  );
  aFixedCost = fcs.find((r) => r.user_id === A.id)!.id;
  bFixedCost = fcs.find((r) => r.user_id === B.id)!.id;
});

afterEach(() => {
  signInAs(null);
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeAdminSql();
});

async function txRow(id: string) {
  const rows = await adminSql<{ amount: string; account_id: string; category_id: string | null; user_id: string; note: string | null }>(
    "SELECT amount, account_id, category_id, user_id, note FROM transactions WHERE id=$1",
    [id]
  );
  return rows[0];
}

describe("S1 他人の取引は API から読めない", () => {
  it("B が A の取引 id を GET すると 404", async () => {
    asB();
    const res = await txOne.GET(getRequest(`/api/v1/transactions/${aTx}`), params(aTx));
    expect(res.status).toBe(404);
  });

  it("B の一覧に A の取引は出ない", async () => {
    asB();
    const res = await txList.GET(getRequest("/api/v1/transactions?year=2026&month=10"));
    const body = await readJson(res);
    expect(res.status).toBe(200);
    const ids = body.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(bTx);
    expect(ids).not.toContain(aTx);
  });
});

describe("S2 他人の取引は API から更新・削除できない", () => {
  it("B が A の取引を PUT すると 404 で、中身は変わらない", async () => {
    asB();
    const res = await txOne.PUT(jsonRequest("PUT", `/api/v1/transactions/${aTx}`, { amount: 1 }), params(aTx));
    expect(res.status).toBe(404);
    expect(Number((await txRow(aTx)).amount)).toBe(9000);
  });

  it("B が A の取引を DELETE すると 404 で、行は残る", async () => {
    asB();
    const res = await txOne.DELETE(jsonRequest("DELETE", `/api/v1/transactions/${aTx}`), params(aTx));
    expect(res.status).toBe(404);
    expect(await txRow(aTx)).toBeDefined();
  });

  it("B が A の口座・カテゴリ・固定費を更新・削除できない", async () => {
    asB();
    expect((await accOne.PUT(jsonRequest("PUT", "/x", { name: "乗っ取り" }), params(aAccount))).status).toBe(404);
    expect((await accOne.DELETE(jsonRequest("DELETE", "/x"), params(aAccount))).status).toBe(404);
    expect((await catOne.PUT(jsonRequest("PUT", "/x", { name: "乗っ取り" }), params(aCategory))).status).toBe(404);
    expect((await catOne.DELETE(jsonRequest("DELETE", "/x"), params(aCategory))).status).toBe(404);
    expect((await fcOne.PUT(jsonRequest("PUT", "/x", { amount: 1 }), params(aFixedCost))).status).toBe(404);
    expect((await fcOne.DELETE(jsonRequest("DELETE", "/x"), params(aFixedCost))).status).toBe(404);
  });
});

describe("S3 自分の取引に他人の口座・カテゴリを指定できない（アプリ側の所有確認）", () => {
  it("POST で A の account_id → 拒否", async () => {
    asB();
    const res = await txList.POST(jsonRequest("POST", "/api/v1/transactions", {
      account_id: aAccount, amount: 100, type: "expense", transaction_date: "2026-10-07",
    }));
    expect(res.status).toBe(404);
  });

  it("POST で A の category_id → 拒否（取引は作られない）", async () => {
    asB();
    const before = await adminSql("SELECT id FROM transactions WHERE user_id=$1", [B.id]);
    const res = await txList.POST(jsonRequest("POST", "/api/v1/transactions", {
      account_id: bAccount, category_id: aCategory, amount: 100, type: "expense", transaction_date: "2026-10-07",
    }));
    expect(res.status).toBe(404);
    const after = await adminSql("SELECT id FROM transactions WHERE user_id=$1", [B.id]);
    expect(after.length).toBe(before.length);
  });

  it("PUT で自分の取引を A の account_id / category_id に付け替え → 拒否", async () => {
    asB();
    const r1 = await txOne.PUT(jsonRequest("PUT", "/x", { account_id: aAccount }), params(bTx));
    expect(r1.status).toBe(404);
    const r2 = await txOne.PUT(jsonRequest("PUT", "/x", { category_id: aCategory }), params(bTx));
    expect(r2.status).toBe(404);
    const row = await txRow(bTx);
    expect(row.account_id).toBe(bAccount);
    expect(row.category_id).toBeNull();
  });

  it("固定費の POST / PUT で A のカテゴリ → 拒否", async () => {
    asB();
    const r1 = await fcList.POST(jsonRequest("POST", "/x", {
      account_id: bAccount, category_id: aCategory, name: "x", amount: 100, billing_day: 1,
    }));
    expect(r1.status).toBe(404);
    const r2 = await fcOne.PUT(jsonRequest("PUT", "/x", { category_id: aCategory }), params(bFixedCost));
    expect(r2.status).toBe(404);
  });

  it("自分の口座＋共通カテゴリなら作れる（守りすぎていない）", async () => {
    asB();
    const res = await txList.POST(jsonRequest("POST", "/api/v1/transactions", {
      account_id: bAccount, category_id: await commonCategoryId(), amount: 100, type: "expense",
      transaction_date: "2026-10-07",
    }));
    expect(res.status).toBe(201);
  });
});

describe("S4 未ログインは全 API で 401", () => {
  const id = "00000000-0000-0000-0000-000000000000";
  const cases: [string, () => Promise<Response>][] = [
    ["GET transactions", () => txList.GET(getRequest("/x?year=2026&month=10"))],
    ["POST transactions", () => txList.POST(jsonRequest("POST", "/x", {}))],
    ["GET transactions/:id", () => txOne.GET(getRequest("/x"), params(id))],
    ["PUT transactions/:id", () => txOne.PUT(jsonRequest("PUT", "/x", {}), params(id))],
    ["DELETE transactions/:id", () => txOne.DELETE(jsonRequest("DELETE", "/x"), params(id))],
    ["GET accounts", () => accList.GET()],
    ["POST accounts", () => accList.POST(jsonRequest("POST", "/x", {}))],
    ["GET categories", () => catList.GET(getRequest("/x"))],
    ["POST categories", () => catList.POST(jsonRequest("POST", "/x", {}))],
    ["GET fixed-costs", () => fcList.GET()],
    ["POST fixed-costs", () => fcList.POST(jsonRequest("POST", "/x", {}))],
    ["POST fixed-costs/generate", () => fcGen.POST(jsonRequest("POST", "/x", { year: 2026, month: 10 }))],
    ["GET import", () => importRoute.GET()],
    ["GET dashboard/summary", () => summary.GET(getRequest("/x?year=2026&month=10"))],
  ];
  it.each(cases)("%s → 401", async (_name, call) => {
    signInAs(null);
    expect((await call()).status).toBe(401);
  });
});

describe("S7 body の user_id は無視し、ログイン中のユーザーで処理する", () => {
  it("取引: B が user_id=A を付けて POST しても B の取引になる", async () => {
    asB();
    const res = await txList.POST(jsonRequest("POST", "/x", {
      user_id: A.id, account_id: bAccount, amount: 50, type: "expense", transaction_date: "2026-10-08",
    }));
    expect(res.status).toBe(201);
    const { data } = await readJson(res);
    expect((await txRow(data.id)).user_id).toBe(B.id);
  });

  it("取引の PUT で user_id=A を渡しても持ち主は変わらない", async () => {
    asB();
    await txOne.PUT(jsonRequest("PUT", "/x", { user_id: A.id, note: "メモ" }), params(bTx));
    expect((await txRow(bTx)).user_id).toBe(B.id);
  });

  it("口座・カテゴリ・固定費の POST でも user_id は無視される", async () => {
    asB();
    const acc = await readJson(await accList.POST(jsonRequest("POST", "/x", { user_id: A.id, name: "n", type: "cash" })));
    const cat = await readJson(await catList.POST(jsonRequest("POST", "/x", { user_id: A.id, name: "n", type: "expense" })));
    const fc = await readJson(await fcList.POST(jsonRequest("POST", "/x", {
      user_id: A.id, account_id: bAccount, name: "n", amount: 100, billing_day: 3,
    })));
    expect(acc.data.user_id).toBe(B.id);
    expect(cat.data.user_id).toBe(B.id);
    expect(fc.data.user_id).toBe(B.id);
  });

  // レシート API（/api/v1/receipts/parse・/api/v1/receipts）の S7 は、AI 提供元を偽物に差し替える必要があるので
  // tests/api/receipts-api.test.ts の「S7 他人の user_id・口座を body で渡しても無視・拒否」に置いている。
});

describe("S8 集計 API は自分の分しか返さない", () => {
  it("B のダッシュボード集計に A の取引（9000円）が入らない", async () => {
    asB();
    const res = await summary.GET(getRequest("/api/v1/dashboard/summary?year=2026&month=10"));
    const { data } = await readJson(res);
    const expected = await adminSql<{ s: string }>(
      `SELECT COALESCE(SUM(amount),0) AS s FROM transactions
        WHERE user_id=$1 AND type='expense' AND deleted_at IS NULL
          AND transaction_date >= '2026-10-01' AND transaction_date < '2026-11-01'`,
      [B.id]
    );
    expect(data.total_expense).toBe(Number(expected[0].s));
    expect(data.total_expense).toBeLessThan(9000);
  });
});
