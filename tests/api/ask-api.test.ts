/**
 * @file tests/api/ask-api.test.ts
 * @description POST /api/v1/ask（mywork#500 第3弾）をローカル Supabase（RLS 有効）で確かめる。
 * - 未ログイン 401
 * - 答えの数字が GET /api/v1/summary と同じ（Q5）
 * - 他人の取引・カテゴリーが混ざらない: B の取引は A の合計に入らず、B のカテゴリー名は A の語彙に無い、
 *   B のカテゴリー id を reading に書いても 422、本文に userId を書いても無視される（S14）
 * 今日は 2026-10-14 に固定する。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));
vi.mock("@/lib/date/jst", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date/jst")>();
  return { ...actual, todayJst: () => "2026-10-14" };
});

import { signInAs } from "../helpers/auth-state";
import { getRequest, jsonRequest, readJson } from "../helpers/api";
import { adminSql, closeAdminSql, commonCategoryId, createTestUser, seedAccount, seedCategory, type TestUser } from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import * as askApi from "@/app/api/v1/ask/route";
import * as summaryApi from "@/app/api/v1/summary/route";

let A: TestUser;
let B: TestUser;
let food: string;
let bSecret: string;

async function seed(userId: string, account: string, date: string, amount: number, category: string | null) {
  await adminSql(
    `INSERT INTO transactions (user_id, account_id, category_id, amount, type, kind, transaction_date, source) VALUES ($1,$2,$3,$4,'expense','normal',$5,'manual')`,
    [userId, account, category, amount, date]
  );
}

async function ask(body: unknown) {
  const res = await askApi.POST(jsonRequest("POST", "/api/v1/ask", body));
  return { status: res.status, data: res.status === 200 ? (await readJson(res)).data : null };
}

beforeAll(async () => {
  A = await createTestUser("ask-a");
  B = await createTestUser("ask-b");
  const aAcc = await seedAccount(A.id);
  const bAcc = await seedAccount(B.id);
  food = await commonCategoryId("expense");
  bSecret = await seedCategory(B.id, "Bだけの秘密費");
  await seed(A.id, aAcc, "2026-10-02", 1200, food);
  await seed(A.id, aAcc, "2026-10-09", 800, food);
  await seed(B.id, bAcc, "2026-10-03", 50000, food);
  await seed(B.id, bAcc, "2026-10-04", 7000, bSecret);
});

afterEach(() => signInAs(null));

afterAll(async () => {
  await adminSql("DELETE FROM auth.users WHERE id = ANY($1)", [[A.id, B.id]]);
  await closeAdminSql();
  await prisma.$disconnect();
});

describe("POST /api/v1/ask", () => {
  it("未ログインは 401", async () => {
    expect((await ask({ question: "今月の支出" })).status).toBe(401);
  });

  it("答えは /api/v1/summary と同じ数字で、B の取引は入らない", async () => {
    signInAs({ id: A.id, email: A.email });
    const { status, data } = await ask({ question: "今月の支出はいくら？" });
    expect(status).toBe(200);
    expect(data.status).toBe("answer");
    expect(data.answer.value).toBe(2000);
    expect(data.answer.label).toBe("計算（2件）");
    const sum = (await readJson(await summaryApi.GET(getRequest("/api/v1/summary?month=2026-10")))).data;
    expect(data.answer.value).toBe(sum.expense.total);
  });

  it("B のカテゴリー名は A の語彙に無い（読めない）", async () => {
    signInAs({ id: A.id, email: A.email });
    const { data } = await ask({ question: "Bだけの秘密費" });
    expect(data.status).toBe("unsupported");
    expect(JSON.stringify(data)).not.toContain("秘密");
  });

  it("B のカテゴリー id を reading に書いても 422", async () => {
    signInAs({ id: A.id, email: A.email });
    const reading = { flow: "expense", period: { from: "2026-10", to: "2026-10", label: "今月" }, target: { type: "category", id: bSecret, name: "x" }, measure: "sum" };
    expect((await ask({ reading })).status).toBe(422);
  });

  it("本文に userId を書いても、ログインした本人の分しか数えない", async () => {
    signInAs({ id: A.id, email: A.email });
    const { data } = await ask({ question: "今月の支出", userId: B.id, user_id: B.id });
    expect(data.answer.value).toBe(2000);
  });

  it("B が聞けば B の分だけ（A の行は入らない）", async () => {
    signInAs({ id: B.id, email: B.email });
    const { data } = await ask({ question: "今月の支出は？" });
    expect(data.answer.value).toBe(57000);
    const own = await ask({ question: "Bだけの秘密費はいくら" });
    expect(own.data.answer.value).toBe(7000);
  });

  it("チップ（reading）で再計算でき、名前はサーバー側で付け直す", async () => {
    signInAs({ id: A.id, email: A.email });
    const reading = { flow: "expense", period: { from: "2026-10", to: "2026-10", label: "今月" }, target: { type: "category", id: food, name: "<script>" }, measure: "count" };
    const { data } = await ask({ reading });
    expect(data.answer.value).toBe(2);
    expect(data.answer.reading.target.name).not.toBe("<script>");
  });

  it("長すぎる質問は 422", async () => {
    signInAs({ id: A.id, email: A.email });
    expect((await ask({ question: "あ".repeat(201) })).status).toBe(422);
  });
});
