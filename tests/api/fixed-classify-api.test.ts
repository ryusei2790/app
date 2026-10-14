/**
 * @file tests/api/fixed-classify-api.test.ts
 * @description テスト一覧 F（固定の収入・固定の支出、mywork#229）の API・DB 層。ローカル Supabase（RLS 有効）で確かめる。
 * - F2・F8 ダッシュボードの月の集計に 固定収入／変動収入／固定支出／変動支出 が出て、合計と一致する
 * - F5 他人の定期の条件で、自分の取引が固定にならない（RLS）
 * - F6 定期を削除すると過去の月も変動に戻る。一時停止では戻らない
 * - F7 登録した定期が、CSV で入れた月に二重に取引を作らない
 * - 定期の一覧に「当てはまった件数」、ダッシュボードに「今月の予定（未確定）」
 */

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));

import { signInAs } from "../helpers/auth-state";
import { getRequest, jsonRequest, params, readJson } from "../helpers/api";
import { adminSql, closeAdminSql, createTestUser, seedAccount, type TestUser } from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import { withUserDb } from "@/lib/db";
import { daysInMonth, todayJst } from "@/lib/date/jst";
import { expandFixedCostsForUser } from "@/lib/fixed-costs/expand";
import * as fcList from "@/app/api/v1/fixed-costs/route";
import * as fcOne from "@/app/api/v1/fixed-costs/[id]/route";
import * as summary from "@/app/api/v1/dashboard/summary/route";

const users: TestUser[] = [];
async function newUser(label: string) {
  const u = await createTestUser(label);
  users.push(u);
  return { user: u, account: await seedAccount(u.id) };
}

afterEach(() => signInAs(null));

afterAll(async () => {
  const ids = users.map((u) => u.id);
  await adminSql("DELETE FROM transactions WHERE user_id = ANY($1::uuid[])", [ids]);
  await adminSql("DELETE FROM fixed_costs WHERE user_id = ANY($1::uuid[])", [ids]);
  await prisma.$disconnect();
  await closeAdminSql();
});

const as = (u: TestUser) => signInAs({ id: u.id, email: u.email });

/** CSV で入れたのと同じ形の取引（source='csv'、メモ付き） */
async function csvTx(userId: string, account: string, date: string, amount: number, type: "income" | "expense", note: string | null) {
  await adminSql(
    `INSERT INTO transactions (user_id, account_id, amount, type, transaction_date, source, note)
     VALUES ($1,$2,$3,$4,$5,'csv',$6)`,
    [userId, account, amount, type, date, note]
  );
}

async function createFc(body: Record<string, unknown>) {
  const res = await fcList.POST(jsonRequest("POST", "/api/v1/fixed-costs", body));
  return { status: res.status, body: await readJson(res) };
}

async function monthSummary(year: number, month: number) {
  return (await readJson(await summary.GET(getRequest(`/api/v1/dashboard/summary?year=${year}&month=${month}`)))).data;
}

/** 9月の CSV 相当: 仕送り・給料・お祝い（収入）、家賃・Claude・食費（支出） */
async function seedSeptember(userId: string, account: string) {
  await csvTx(userId, account, "2026-09-27", 130000, "income", "仕送り");
  await csvTx(userId, account, "2026-09-30", 30000, "income", "給料");
  await csvTx(userId, account, "2026-09-10", 5000, "income", "お祝い");
  await csvTx(userId, account, "2026-09-27", 59590, "expense", "家賃");
  await csvTx(userId, account, "2026-09-18", 15600, "expense", "Claude Max（ドル建て・概算）");
  await csvTx(userId, account, "2026-09-03", 1200, "expense", null);
}

describe("F2・F8 月の集計に固定と変動が出て、合計と一致する", () => {
  it("条件に当てはまる取引が固定、それ以外は変動。固定＋変動＝合計", async () => {
    const { user, account } = await newUser("f8");
    await seedSeptember(user.id, account);
    as(user);
    const today = todayJst();
    for (const body of [
      { name: "仕送り", amount: 130000, type: "income", billing_day: 27, match_note: "仕送り" },
      { name: "給料", amount: 30000, type: "income", billing_day: 31, match_note: "給料" },
      { name: "家賃", amount: 59590, billing_day: 27, match_note: "家賃" },
      // ドル建ては円が毎回変わるので金額を見ない
      { name: "Claude Max", amount: 16500, billing_day: 18, match_note: "claude", match_any_amount: true },
    ]) {
      const r = await createFc({ account_id: account, start_date: today, ...body });
      expect(r.status).toBe(201);
    }

    const s = await monthSummary(2026, 9);
    expect(s.fixed).toEqual({
      fixed_income: 160000,
      variable_income: 5000,
      fixed_expense: 59590 + 15600,
      variable_expense: 1200,
    });
    expect(s.fixed.fixed_income + s.fixed.variable_income).toBe(s.total_income);
    expect(s.fixed.fixed_expense + s.fixed.variable_expense).toBe(s.total_expense);
  });

  it("定期の一覧に、条件に当てはまった件数が出る", async () => {
    const { user, account } = await newUser("f-count");
    await csvTx(user.id, account, "2026-09-27", 130000, "income", "仕送り");
    await csvTx(user.id, account, "2026-08-27", 130000, "income", "仕送り（8月）");
    as(user);
    await createFc({ account_id: account, name: "仕送り", amount: 130000, type: "income", billing_day: 27, match_note: "仕送り", start_date: todayJst() });
    const list = await readJson(await fcList.GET());
    expect(list.data[0]).toMatchObject({ name: "仕送り", match_note: "仕送り", match_any_amount: false, matched_count: 2 });
  });
});

describe("F5 他人の定期の条件で自分の取引が固定にならない（RLS）", () => {
  it("B が A の取引と同じ条件の定期を持っていても、A の集計は変動のまま", async () => {
    const a = await newUser("f5-a");
    const b = await newUser("f5-b");
    await csvTx(a.user.id, a.account, "2026-09-27", 130000, "income", "仕送り");
    as(b.user);
    await createFc({ account_id: b.account, name: "仕送り", amount: 130000, type: "income", billing_day: 27, match_note: "仕送り", start_date: todayJst() });

    as(a.user);
    const s = await monthSummary(2026, 9);
    expect(s.fixed).toMatchObject({ fixed_income: 0, variable_income: 130000 });
  });
});

describe("F6 定期を削除すると過去も変動に戻る（一時停止では戻らない）", () => {
  it("一時停止中も過去の取引は固定のまま、削除すると変動", async () => {
    const { user, account } = await newUser("f6");
    await csvTx(user.id, account, "2026-04-27", 130000, "income", "仕送り");
    as(user);
    const fc = await createFc({ account_id: account, name: "仕送り", amount: 130000, type: "income", billing_day: 27, match_note: "仕送り", start_date: todayJst() });
    const id = fc.body.data.id;
    expect((await monthSummary(2026, 4)).fixed.fixed_income).toBe(130000);

    expect((await fcOne.PUT(jsonRequest("PUT", "/x", { is_active: false }), params(id))).status).toBe(200);
    expect((await monthSummary(2026, 4)).fixed.fixed_income).toBe(130000);

    expect((await fcOne.DELETE(jsonRequest("DELETE", "/x"), params(id))).status).toBe(200);
    expect((await monthSummary(2026, 4)).fixed).toMatchObject({ fixed_income: 0, variable_income: 130000 });
  });
});

describe("F7 登録した定期が、CSV で入れた月に二重に取引を作らない", () => {
  it("開始日を過去にしても、条件に当てはまる取引がある月（9月）は作らず、無い月だけ作る", async () => {
    const { user, account } = await newUser("f7");
    await csvTx(user.id, account, "2026-09-27", 130000, "income", "仕送り");
    as(user);
    const fc = await createFc({
      account_id: account, name: "仕送り", amount: 130000, type: "income",
      billing_day: 27, start_date: "2026-08-01", match_note: "仕送り",
    });
    await withUserDb(user.id, (db) => expandFixedCostsForUser(db, user.id, "2026-10-31"));
    const rows = await adminSql<{ d: string }>(
      `SELECT to_char(transaction_date,'YYYY-MM-DD') AS d FROM transactions
        WHERE user_id=$1 AND fixed_cost_id=$2 AND deleted_at IS NULL ORDER BY 1`,
      [user.id, fc.body.data.id]
    );
    expect(rows.map((r) => r.d)).toEqual(["2026-08-27", "2026-10-27"]);
    // 9月は CSV の1件だけ（固定として数える）
    expect((await monthSummary(2026, 9)).fixed.fixed_income).toBe(130000);
  });

  it("条件の無い定期（メモの語句もカテゴリーも無い）は今までどおり全部の回を作る", async () => {
    const { user, account } = await newUser("f7-plain");
    await csvTx(user.id, account, "2026-09-05", 3000, "expense", "保険");
    as(user);
    const fc = await createFc({ account_id: account, name: "保険", amount: 3000, billing_day: 5, start_date: "2026-09-01" });
    await withUserDb(user.id, (db) => expandFixedCostsForUser(db, user.id, "2026-10-10"));
    const rows = await adminSql<{ d: string }>(
      "SELECT to_char(transaction_date,'YYYY-MM-DD') AS d FROM transactions WHERE fixed_cost_id=$1 ORDER BY 1",
      [fc.body.data.id]
    );
    expect(rows.map((r) => r.d)).toEqual(["2026-09-05", "2026-10-05"]);
  });
});

describe("今月の予定（未確定）", () => {
  it("有効な定期のまだ取引になっていない回が、今月の予定として出る（取引にはしない）", async () => {
    const { user, account } = await newUser("upcoming");
    as(user);
    const today = todayJst();
    const [y, m] = today.split("-").map(Number);
    const monthEnd = `${today.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
    await createFc({ account_id: account, name: "給料", amount: 30000, type: "income", billing_day: 31, match_note: "給料", start_date: today });

    const s = await monthSummary(y, m);
    expect(s.upcoming).toEqual([{ fixed_cost_id: expect.any(String), date: monthEnd, name: "給料", type: "income", amount: 30000 }]);
    // 予定は合計に入れない（実績ではない）
    expect(s.total_income).toBe(0);
  });
});

describe("固定の条件の入力（API）", () => {
  it("語句が長すぎる・金額を見ないかが真偽値でない は 422", async () => {
    const { user, account } = await newUser("f-valid");
    as(user);
    const base = { account_id: account, name: "x", amount: 100, billing_day: 1 };
    expect((await createFc({ ...base, match_note: "あ".repeat(51) })).status).toBe(422);
    expect((await createFc({ ...base, match_any_amount: "yes" })).status).toBe(422);
    const ok = await createFc({ ...base, match_note: "  " });
    expect(ok.status).toBe(201);
    expect(ok.body.data.match_note).toBeNull();
  });
});
