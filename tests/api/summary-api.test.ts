/**
 * @file tests/api/summary-api.test.ts
 * @description テスト一覧 D・V3・S14（mywork#425 第1弾）の API・DB 層。ローカル Supabase（RLS 有効）で確かめる。
 * - D1 transactions.kind は既定 normal、4種以外と「支出の返金」は DB の CHECK でも API でも入らない
 * - D2〜D4 GET /api/v1/summary が定義どおりの数字（支出＝購入−返金、振替・借入は除外、今日まで）を返す
 * - D9 ダッシュボード（互換 API）・収支一覧（取引から計算）・予算台帳（社長）が同じ数字
 * - D11 GET /api/v1/review の返金候補は、種類を「返金」に直すと消え、支出が減る
 * - V3 DB 関数 monthly_totals（SQL）と lib/aggregate（TS）が同じ入力で同じ数字
 * - S14 summary・review は未ログイン 401、他人の取引が混ざらない
 * 今日は 2026-10-14 に固定する（「今月は今日まで」を確かめるため）。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));
vi.mock("@/lib/date/jst", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date/jst")>();
  return { ...actual, todayJst: () => "2026-10-14" };
});

import { signInAs } from "../helpers/auth-state";
import { getRequest, jsonRequest, params, readJson } from "../helpers/api";
import { adminSql, closeAdminSql, commonCategoryId, createTestUser, seedAccount, seedCategory, type TestUser } from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import { withUserDb } from "@/lib/db";
import * as txList from "@/app/api/v1/transactions/route";
import * as txOne from "@/app/api/v1/transactions/[id]/route";
import * as summaryApi from "@/app/api/v1/summary/route";
import * as legacy from "@/app/api/v1/dashboard/summary/route";
import * as reviewApi from "@/app/api/v1/review/route";
import * as budget from "@/app/api/v1/budget/route";

let A: TestUser;
let B: TestUser;
let aAccount: string;
let bAccount: string;
let food: string; // 共通カテゴリー「食費」（支出）
let salary: string; // 共通カテゴリー「給与」（収入）
let rent: string; // A の「家賃」

const asA = () => signInAs({ id: A.id, email: A.email });
const asB = () => signInAs({ id: B.id, email: B.email });

/** 取引を1件、管理者接続で入れる（kind 付き） */
async function seed(
  userId: string,
  account: string,
  t: { date: string; amount: number; type: "income" | "expense"; kind?: string; category?: string | null; note?: string | null; source?: string }
) {
  const rows = await adminSql<{ id: string }>(
    `INSERT INTO transactions (user_id, account_id, category_id, amount, type, kind, transaction_date, note, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [userId, account, t.category ?? null, t.amount, t.type, t.kind ?? "normal", t.date, t.note ?? null, t.source ?? "csv"]
  );
  return rows[0].id;
}

async function getSummary(month: string) {
  const res = await summaryApi.GET(getRequest(`/api/v1/summary?month=${month}`));
  return { status: res.status, data: (await readJson(res)).data };
}

beforeAll(async () => {
  A = await createTestUser("sum-a");
  B = await createTestUser("sum-b");
  aAccount = await seedAccount(A.id);
  bAccount = await seedAccount(B.id);
  food = await commonCategoryId("expense");
  salary = await commonCategoryId("income");
  rent = await seedCategory(A.id, "家賃");

  // A の 2026年9月（過去の月）: 購入 1200・800（食費）・59590（家賃）、食費の返金 300、振替（出）5000、借入 20000、収入 130000
  await seed(A.id, aAccount, { date: "2026-09-03", amount: 1200, type: "expense", category: food });
  await seed(A.id, aAccount, { date: "2026-09-04", amount: 800, type: "expense", category: food });
  await seed(A.id, aAccount, { date: "2026-09-27", amount: 59590, type: "expense", category: rent });
  await seed(A.id, aAccount, { date: "2026-09-05", amount: 300, type: "income", kind: "refund", category: food, note: "返金" });
  await seed(A.id, aAccount, { date: "2026-09-06", amount: 5000, type: "expense", kind: "transfer", note: "Suica チャージ" });
  await seed(A.id, aAccount, { date: "2026-09-07", amount: 20000, type: "income", kind: "loan", note: "借入" });
  await seed(A.id, aAccount, { date: "2026-09-27", amount: 130000, type: "income", category: salary, note: "仕送り" });
  // A の 2026年10月（今月、今日は 10/14）: 10/1・10/14 は今日まで、10/15・10/31 は予定
  await seed(A.id, aAccount, { date: "2026-10-01", amount: 10, type: "expense", category: food });
  await seed(A.id, aAccount, { date: "2026-10-14", amount: 100, type: "expense", category: food });
  await seed(A.id, aAccount, { date: "2026-10-15", amount: 1000, type: "expense", category: food });
  await seed(A.id, aAccount, { date: "2026-10-31", amount: 30000, type: "income", category: salary });
  // B の 9月（A に混ざってはいけない）
  await seed(B.id, bAccount, { date: "2026-09-10", amount: 9999, type: "expense", category: food });
  await seed(B.id, bAccount, { date: "2026-09-11", amount: 777, type: "income", category: food, note: "B の返金候補" });
});

afterEach(() => {
  signInAs(null);
  delete process.env.OWNER_USER_IDS;
});

afterAll(async () => {
  await adminSql("DELETE FROM transactions WHERE user_id = ANY($1::uuid[])", [[A.id, B.id]]);
  await prisma.$disconnect();
  await closeAdminSql();
});

describe("D1 kind の列", () => {
  it("DB: 既定は normal。4種以外と「支出の返金」は CHECK で入らない", async () => {
    const rows = await adminSql<{ kind: string }>(
      `INSERT INTO transactions (user_id, account_id, amount, type, transaction_date, source)
       VALUES ($1,$2,1,'expense','2026-01-01','manual') RETURNING kind`,
      [A.id, aAccount]
    );
    expect(rows[0].kind).toBe("normal");
    await expect(seed(A.id, aAccount, { date: "2026-01-02", amount: 1, type: "expense", kind: "gift" })).rejects.toThrow();
    await expect(seed(A.id, aAccount, { date: "2026-01-02", amount: 1, type: "expense", kind: "refund" })).rejects.toThrow();
  });

  it("API: kind を受け付け、既定は normal。返金は収入の向きだけ", async () => {
    asA();
    const plain = await txList.POST(jsonRequest("POST", "/x", { account_id: aAccount, amount: 500, type: "expense", transaction_date: "2026-01-10" }));
    expect(plain.status).toBe(201);
    expect((await readJson(plain)).data.kind).toBe("normal");

    const transfer = await txList.POST(
      jsonRequest("POST", "/x", { account_id: aAccount, amount: 3000, type: "expense", kind: "transfer", transaction_date: "2026-01-10" })
    );
    expect(transfer.status).toBe(201);
    expect((await readJson(transfer)).data.kind).toBe("transfer");

    const badKind = await txList.POST(jsonRequest("POST", "/x", { account_id: aAccount, amount: 1, type: "expense", kind: "gift", transaction_date: "2026-01-10" }));
    expect(badKind.status).toBe(422);
    const expenseRefund = await txList.POST(
      jsonRequest("POST", "/x", { account_id: aAccount, amount: 1, type: "expense", kind: "refund", transaction_date: "2026-01-10" })
    );
    expect(expenseRefund.status).toBe(422);

    // 更新: 収入の取引を返金にできる。支出の取引を返金にはできない。返金の向きを支出には変えられない
    const income = (await readJson(await txList.POST(jsonRequest("POST", "/x", { account_id: aAccount, amount: 200, type: "income", transaction_date: "2026-01-11" })))).data;
    const toRefund = await txOne.PUT(jsonRequest("PUT", "/x", { kind: "refund" }), params(income.id));
    expect(toRefund.status).toBe(200);
    expect((await readJson(toRefund)).data.kind).toBe("refund");
    expect((await txOne.PUT(jsonRequest("PUT", "/x", { type: "expense" }), params(income.id))).status).toBe(422);
    const plainId = (await readJson(plain)).data.id as string;
    expect((await txOne.PUT(jsonRequest("PUT", "/x", { kind: "refund" }), params(plainId))).status).toBe(422);
    // 向きと種類を同時に変えるのは可
    expect((await txOne.PUT(jsonRequest("PUT", "/x", { kind: "normal", type: "expense" }), params(income.id))).status).toBe(200);

    // 一覧にも kind が出る
    const list = (await readJson(await txList.GET(getRequest("/x?year=2026&month=1")))).data as { kind: string }[];
    expect(list.map((t) => t.kind).sort()).toEqual(["normal", "normal", "normal", "transfer"]);
    await adminSql("DELETE FROM transactions WHERE user_id = $1 AND transaction_date < '2026-02-01'", [A.id]);
  });
});

describe("D2〜D4 GET /api/v1/summary は定義どおりの数字", () => {
  it("過去の月（9月）: 支出＝購入−返金、振替・借入は別枠、収入に返金・借入は入らない", async () => {
    asA();
    const { status, data } = await getSummary("2026-09");
    expect(status).toBe(200);
    expect(data.period).toEqual({ start: "2026-09-01", end: "2026-09-30", status: "past" });
    expect(data.expense).toMatchObject({ purchases: 61590, refunds: 300, total: 61290, refund_count: 1, refund_heavy: false });
    expect(data.income).toMatchObject({ total: 130000, count: 1 });
    expect(data.transfers).toEqual({ out: 5000, in: 0, count: 1 });
    expect(data.loans).toEqual({ repaid: 0, borrowed: 20000, count: 1 });
    expect(data.scheduled.count).toBe(0);
    expect(data.balance).toBe(130000 - 61290);
    expect(data.by_category.map((c: { name: string; amount: number }) => [c.name, c.amount])).toEqual([["家賃", 59590], ["食費", 1700]]);
    expect(data.fixed.fixed_expense + data.fixed.variable_expense).toBe(61290);
    expect(data.definitions_version).toMatch(/^\d{4}-/);
    // 互換の別名（ダッシュボードの古い型）
    expect(data).toMatchObject({ total_income: 130000, total_expense: 61290 });
  });

  it("今月（10月、今日は 10/14）: 今日までを合計し、それより後は予定", async () => {
    asA();
    const { data } = await getSummary("2026-10");
    expect(data.period).toEqual({ start: "2026-10-01", end: "2026-10-14", status: "current" });
    expect(data.expense.total).toBe(110);
    expect(data.income.total).toBe(0);
    expect(data.scheduled).toMatchObject({ expense: 1000, income: 30000, count: 2 });
    expect(data.scheduled.items.map((i: { date: string }) => i.date)).toEqual(["2026-10-15", "2026-10-31"]);
    expect(data.today).toBe("2026-10-14");
  });

  it("month は YYYY-MM。year・month の数字でも呼べる。おかしければ 422", async () => {
    asA();
    expect((await summaryApi.GET(getRequest("/x?month=2026-13"))).status).toBe(422);
    expect((await summaryApi.GET(getRequest("/x?month=abc"))).status).toBe(422);
    const byNumbers = await readJson(await summaryApi.GET(getRequest("/x?year=2026&month=9")));
    expect(byNumbers.data.month).toBe("2026-09");
    // 省略は今月
    const def = await readJson(await summaryApi.GET(getRequest("/x")));
    expect(def.data.month).toBe("2026-10");
  });
});

describe("D9 どの画面でも同じ数字", () => {
  it("互換 API（dashboard/summary）と同じ合計・内訳・固定／変動", async () => {
    asA();
    const { data: s } = await getSummary("2026-09");
    const l = (await readJson(await legacy.GET(getRequest("/api/v1/dashboard/summary?year=2026&month=9")))).data;
    expect(l.total_expense).toBe(s.expense.total);
    expect(l.total_income).toBe(s.income.total);
    expect(l.balance).toBe(s.balance);
    expect(l.by_category).toEqual(s.by_category);
    expect(l.fixed).toEqual(s.fixed);
    expect(l.expense).toEqual(s.expense);
  });

  it("収支一覧（取引の行）から定義どおりに足しても同じ支出・収入", async () => {
    asA();
    const { data: s } = await getSummary("2026-10");
    const rows = (await readJson(await txList.GET(getRequest("/x?year=2026&month=10")))).data as {
      amount: number; type: string; kind: string; transaction_date: string;
    }[];
    const upTo = rows.filter((r) => r.transaction_date <= s.period.end);
    const expense = upTo.filter((r) => r.type === "expense" && r.kind === "normal").reduce((a, r) => a + r.amount, 0)
      - upTo.filter((r) => r.type === "income" && r.kind === "refund").reduce((a, r) => a + r.amount, 0);
    const income = upTo.filter((r) => r.type === "income" && r.kind === "normal").reduce((a, r) => a + r.amount, 0);
    expect(expense).toBe(s.expense.total);
    expect(income).toBe(s.income.total);
    const scheduled = rows.filter((r) => r.transaction_date > s.period.end);
    expect(scheduled).toHaveLength(s.scheduled.count);
  });

  it("予算台帳（社長）の費目の合計は summary の frames と同じ。食費は返金を引いた額", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asA();
    const b = (await readJson(await budget.GET(getRequest("/api/v1/budget?month=2026-09")))).data;
    const { data: s } = await getSummary("2026-09");
    expect(s.frames).not.toBeNull();
    expect(s.frames.total.spent).toBe(b.summary.total.spent);
    const foodFrame = b.summary.frames.find((f: { name: string }) => f.name === "食費");
    expect(foodFrame.spent).toBe(1700);
    // 振替・借入は費目にも「枠の外」にも「未割り当て」にも入らない
    expect(b.summary.outside + b.summary.total.spent + b.summary.unassigned.amount).toBe(s.expense.total);
    // 今月の予算台帳は今日までの分だけ
    const oct = (await readJson(await budget.GET(getRequest("/api/v1/budget?month=2026-10")))).data;
    expect(oct.summary.total.spent + oct.summary.outside + oct.summary.unassigned.amount).toBe(110);
  });

  it("一般ユーザーの summary は frames が null（予算台帳は社長だけ）", async () => {
    asA();
    const { data } = await getSummary("2026-09");
    expect(data.frames).toBeNull();
  });
});

describe("V3 SQL（monthly_totals）と TS（lib/aggregate）が同じ数字", () => {
  async function sqlTotals(year: number, month: number, today: string) {
    const rows = await withUserDb(A.id, (db) =>
      db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM public.monthly_totals(${year}::int, ${month}::int, ${today}::date)`
    );
    return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
  }

  it("過去の月（9月）", async () => {
    asA();
    const { data: s } = await getSummary("2026-09");
    const q = await sqlTotals(2026, 9, "2026-10-14");
    expect(q).toMatchObject({
      purchases: s.expense.purchases,
      refunds: s.expense.refunds,
      expense: s.expense.total,
      income: s.income.total,
      transfers_out: s.transfers.out,
      transfers_in: s.transfers.in,
      loans_repaid: s.loans.repaid,
      loans_borrowed: s.loans.borrowed,
      scheduled_expense: 0,
      scheduled_income: 0,
    });
  });

  it("今月（予定あり）", async () => {
    asA();
    const { data: s } = await getSummary("2026-10");
    const q = await sqlTotals(2026, 10, "2026-10-14");
    expect(q).toMatchObject({
      expense: s.expense.total,
      income: s.income.total,
      scheduled_expense: s.scheduled.expense,
      scheduled_income: s.scheduled.income,
    });
    expect(q.expense).toBe(110);
  });

  it("monthly_summary（既存の RPC）は kind ごとの合計を返す", async () => {
    const rows = await withUserDb(A.id, (db) =>
      db.$queryRaw<{ type: string; kind: string; total: unknown }[]>`SELECT type, kind, total FROM public.monthly_summary(2026, 9)`
    );
    const transfer = rows.find((r) => r.kind === "transfer");
    expect(Number(transfer?.total)).toBe(5000);
  });
});

describe("D11 要確認", () => {
  it("返金候補（収入なのに支出のカテゴリー）→ 種類を返金にすると消え、支出が減る", async () => {
    asA();
    const id = await seed(A.id, aAccount, { date: "2026-10-02", amount: 50, type: "income", category: food, note: null });
    const before = (await readJson(await reviewApi.GET(getRequest("/api/v1/review?month=2026-10")))).data;
    expect(before.refund_candidates.map((i: { id: string }) => i.id)).toEqual([id]);
    expect(before.refund_candidates[0]).toMatchObject({ amount: 50, type: "income", kind: "normal", category_name: "食費" });
    expect(before.scheduled).toHaveLength(2);
    const expenseBefore = (await getSummary("2026-10")).data.expense.total;

    const upd = await txOne.PUT(jsonRequest("PUT", "/x", { kind: "refund" }), params(id));
    expect(upd.status).toBe(200);
    const after = (await readJson(await reviewApi.GET(getRequest("/api/v1/review?month=2026-10")))).data;
    expect(after.refund_candidates).toHaveLength(0);
    expect((await getSummary("2026-10")).data.expense.total).toBe(expenseBefore - 50);
    await adminSql("DELETE FROM transactions WHERE id = $1", [id]);
  });

  it("重複候補と未割り当ても出る", async () => {
    asA();
    const d1 = await seed(A.id, aAccount, { date: "2026-10-03", amount: 400, type: "expense", category: food });
    const d2 = await seed(A.id, aAccount, { date: "2026-10-03", amount: 400, type: "expense", category: food });
    const u = await seed(A.id, aAccount, { date: "2026-10-04", amount: 70, type: "expense", category: null });
    const r = (await readJson(await reviewApi.GET(getRequest("/api/v1/review?month=2026-10")))).data;
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].items.map((i: { id: string }) => i.id).sort()).toEqual([d1, d2].sort());
    expect(r.unassigned.map((i: { id: string }) => i.id)).toEqual([u]);
    const s = (await getSummary("2026-10")).data;
    expect(s.review).toEqual({ refund_candidates: 0, unassigned: 1, scheduled: 2, duplicates: 1 });
    await adminSql("DELETE FROM transactions WHERE id = ANY($1::uuid[])", [[d1, d2, u]]);
  });
});

describe("S14 守り", () => {
  it("未ログインは 401", async () => {
    signInAs(null);
    expect((await summaryApi.GET(getRequest("/x?month=2026-09"))).status).toBe(401);
    expect((await reviewApi.GET(getRequest("/x?month=2026-09"))).status).toBe(401);
  });

  it("他人の取引は summary にも review にも混ざらない", async () => {
    asB();
    const { data: s } = await getSummary("2026-09");
    expect(s.expense.total).toBe(9999);
    expect(s.income.total).toBe(777);
    const r = (await readJson(await reviewApi.GET(getRequest("/x?month=2026-09")))).data;
    expect(r.refund_candidates).toHaveLength(1);
    expect(r.refund_candidates[0].note).toBe("B の返金候補");
    asA();
    const a = (await readJson(await reviewApi.GET(getRequest("/x?month=2026-09")))).data;
    expect(a.refund_candidates.map((i: { note: string | null }) => i.note)).not.toContain("B の返金候補");
  });
});
