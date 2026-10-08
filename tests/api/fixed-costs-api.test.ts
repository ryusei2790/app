/**
 * @file tests/api/fixed-costs-api.test.ts
 * @description テスト一覧 C（定期支出 R1〜R9）の API・DB 層。
 * route handler とサーバー側の展開処理（lib/fixed-costs/expand・cron）を、ローカル Supabase（RLS 有効）で確かめる。
 * 日付を自由に動かしたい R6・R8 は「今日」を引数で渡せる展開処理を直接呼ぶ。
 * 画面から呼ばれる API（今日 = 実際の JST の日付）は、今日からの相対日付で確かめる。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));

import { signInAs } from "../helpers/auth-state";
import { getRequest, jsonRequest, params, readJson } from "../helpers/api";
import {
  adminSql,
  closeAdminSql,
  createTestUser,
  seedAccount,
  type TestUser,
} from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import { withUserDb } from "@/lib/db";
import { todayJst } from "@/lib/date/jst";
import { addDays } from "@/lib/fixed-costs/schedule";
import { expandFixedCostsForUser } from "@/lib/fixed-costs/expand";
import { runFixedCostExpansion } from "@/lib/fixed-costs/cron";
import * as fcList from "@/app/api/v1/fixed-costs/route";
import * as fcOne from "@/app/api/v1/fixed-costs/[id]/route";
import * as fcGen from "@/app/api/v1/fixed-costs/generate/route";
import * as cron from "@/app/api/cron/fixed-costs/route";

const users: TestUser[] = [];
async function newUser(label: string) {
  const u = await createTestUser(label);
  users.push(u);
  return { user: u, account: await seedAccount(u.id) };
}

afterEach(() => {
  signInAs(null);
  delete process.env.CRON_SECRET;
});

afterAll(async () => {
  // 後のテスト実行で cron が毎回この人たちの分まで回らないよう、作った定期支出を消しておく
  const ids = users.map((u) => u.id);
  await adminSql("DELETE FROM transactions WHERE user_id = ANY($1::uuid[])", [ids]);
  await adminSql("DELETE FROM fixed_costs WHERE user_id = ANY($1::uuid[])", [ids]);
  await prisma.$disconnect();
  await closeAdminSql();
});

const as = (u: TestUser) => signInAs({ id: u.id, email: u.email });

async function createFc(body: Record<string, unknown>) {
  const res = await fcList.POST(jsonRequest("POST", "/api/v1/fixed-costs", body));
  return { status: res.status, body: await readJson(res) };
}

async function autoTx(userId: string, fixedCostId?: string) {
  return adminSql<{ d: string; amount: string; type: string; note: string | null; fixed_cost_id: string }>(
    `SELECT to_char(transaction_date,'YYYY-MM-DD') AS d, amount, type, note, fixed_cost_id
       FROM transactions
      WHERE user_id=$1 AND source='auto' AND deleted_at IS NULL
        AND ($2::uuid IS NULL OR fixed_cost_id=$2::uuid)
      ORDER BY transaction_date`,
    [userId, fixedCostId ?? null]
  );
}

const expand = (userId: string, today: string) =>
  withUserDb(userId, (db) => expandFixedCostsForUser(db, userId, today));

describe("R1 定期支出は件数の上限なく登録できる", () => {
  it("日本円の定期支出を100件登録し、一覧に100件出る", async () => {
    const { user, account } = await newUser("r1");
    as(user);
    for (let i = 1; i <= 100; i++) {
      const r = await createFc({ account_id: account, name: `サブスク${i}`, amount: 100 + i, billing_day: (i % 28) + 1 });
      expect(r.status).toBe(201);
    }
    const res = await fcList.GET();
    const { data } = await readJson(res);
    expect(data).toHaveLength(100);
  });
});

describe("R4 収入の定期", () => {
  it("type=income の定期を登録すると、収入の取引として作られる", async () => {
    const { user, account } = await newUser("r4");
    as(user);
    const r = await createFc({
      account_id: account, name: "給料", amount: 250000, type: "income",
      billing_day: 25, start_date: "2026-08-01",
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ type: "income", cycle: "monthly" });
    await expand(user.id, "2026-09-30");
    const rows = await autoTx(user.id, r.body.data.id);
    expect(rows.map((x) => [x.d, x.type])).toEqual([["2026-08-25", "income"], ["2026-09-25", "income"]]);
  });
});

describe("R5 アプリを開かなくてもサーバー側で展開され、二重にならない", () => {
  it("定期実行の入口は CRON_SECRET が無い・違うと 401", async () => {
    expect((await cron.GET(getRequest("/api/cron/fixed-costs"))).status).toBe(401);
    process.env.CRON_SECRET = "s3cret-for-test";
    const wrong = new Request("http://localhost/api/cron/fixed-costs", { headers: { authorization: "Bearer nope" } });
    expect((await cron.GET(wrong)).status).toBe(401);
  });

  it("正しい鍵の定期実行で、ログインしていない人の分も今日まで作られ、2回目は0件", async () => {
    const { user, account } = await newUser("r5");
    const today = todayJst();
    await adminSql(
      `INSERT INTO fixed_costs (user_id, account_id, name, amount, cycle, start_date)
       VALUES ($1,$2,'週1のジム',1000,'weekly',$3)`,
      [user.id, account, addDays(today, -14)]
    );
    process.env.CRON_SECRET = "s3cret-for-test";
    const req = () =>
      new Request("http://localhost/api/cron/fixed-costs", { headers: { authorization: "Bearer s3cret-for-test" } });

    const first = await cron.GET(req());
    expect(first.status).toBe(200);
    expect((await autoTx(user.id)).map((x) => x.d)).toEqual([addDays(today, -14), addDays(today, -7), today]);

    const second = await cron.GET(req());
    expect(second.status).toBe(200);
    expect(await autoTx(user.id)).toHaveLength(3);
  });

  it("同じ日に展開処理を2回走らせても重複しない（同時でも）", async () => {
    const { user, account } = await newUser("r5b");
    await adminSql(
      `INSERT INTO fixed_costs (user_id, account_id, name, amount, billing_day, start_date)
       VALUES ($1,$2,'家賃',80000,27,'2026-08-01')`,
      [user.id, account]
    );
    await Promise.all([expand(user.id, "2026-10-31"), expand(user.id, "2026-10-31")]);
    await expand(user.id, "2026-10-31");
    expect((await autoTx(user.id)).map((x) => x.d)).toEqual(["2026-08-27", "2026-09-27", "2026-10-27"]);
  });

  it("runFixedCostExpansion は複数の人をまとめて処理し、作った件数を返す", async () => {
    const a = await newUser("r5c-a");
    const b = await newUser("r5c-b");
    for (const { user, account } of [a, b]) {
      await adminSql(
        `INSERT INTO fixed_costs (user_id, account_id, name, amount, billing_day, start_date)
         VALUES ($1,$2,'保険',3000,5,'2026-09-01')`,
        [user.id, account]
      );
    }
    const result = await runFixedCostExpansion("2026-10-10");
    expect(result.generated).toBeGreaterThanOrEqual(4);
    expect((await autoTx(a.user.id)).map((x) => x.d)).toEqual(["2026-09-05", "2026-10-05"]);
    expect((await autoTx(b.user.id)).map((x) => x.d)).toEqual(["2026-09-05", "2026-10-05"]);
  });

  it("画面を開いたときの generate も今日までを作る（body 不要・冪等）", async () => {
    const { user, account } = await newUser("r5d");
    const today = todayJst();
    await adminSql(
      `INSERT INTO fixed_costs (user_id, account_id, name, amount, cycle, start_date)
       VALUES ($1,$2,'隔週',500,'biweekly',$3)`,
      [user.id, account, addDays(today, -14)]
    );
    as(user);
    const r1 = await readJson(await fcGen.POST(jsonRequest("POST", "/x", {})));
    expect(r1.data.generated_count).toBe(2);
    const r2 = await readJson(await fcGen.POST(jsonRequest("POST", "/x", {})));
    expect(r2.data.generated_count).toBe(0);
  });
});

describe("R6 しばらく展開されなかった後の初回で、抜けた回がすべて補完される", () => {
  it("最後に展開したのが7月なら、8・9・10月分をまとめて作る", async () => {
    const { user, account } = await newUser("r6");
    await adminSql(
      `INSERT INTO fixed_costs (user_id, account_id, name, amount, billing_day, start_date, generated_through)
       VALUES ($1,$2,'スマホ',3000,15,'2026-06-01','2026-07-31')`,
      [user.id, account]
    );
    const n = await expand(user.id, "2026-10-20");
    expect(n).toBe(3);
    expect((await autoTx(user.id)).map((x) => x.d)).toEqual(["2026-08-15", "2026-09-15", "2026-10-15"]);
  });

  it("毎年払いは数年空いても支払月の分だけ作る", async () => {
    const { user, account } = await newUser("r6y");
    await adminSql(
      `INSERT INTO fixed_costs (user_id, account_id, name, amount, cycle, billing_day, billing_month, start_date)
       VALUES ($1,$2,'年会費',11000,'yearly',1,4,'2024-01-01')`,
      [user.id, account]
    );
    await expand(user.id, "2026-10-08");
    expect((await autoTx(user.id)).map((x) => x.d)).toEqual(["2024-04-01", "2025-04-01", "2026-04-01"]);
  });
});

describe("R7 開始日・終了日・一時停止", () => {
  it("開始日が未来なら作らない／終了日を過ぎた分は作らない", async () => {
    const { user, account } = await newUser("r7");
    await adminSql(
      `INSERT INTO fixed_costs (user_id, account_id, name, amount, billing_day, start_date, end_date)
       VALUES ($1,$2,'未来',100,1,'2027-01-01',NULL), ($1,$2,'終わった',200,1,'2026-07-01','2026-08-31')`,
      [user.id, account]
    );
    await expand(user.id, "2026-10-08");
    expect((await autoTx(user.id)).map((x) => [x.d, x.note])).toEqual([
      ["2026-07-01", "終わった"],
      ["2026-08-01", "終わった"],
    ]);
  });

  it("一時停止中は作らず、再開しても止めていた間の分は作らない", async () => {
    const { user, account } = await newUser("r7p");
    const today = todayJst();
    as(user);
    const fc = await createFc({
      account_id: account, name: "週1", amount: 700, cycle: "weekly", start_date: addDays(today, -35),
    });
    const id = fc.body.data.id;
    // 5週間前に作り、その時点で展開済みだったことにする
    await adminSql("UPDATE fixed_costs SET generated_through=$2 WHERE id=$1", [id, addDays(today, -35)]);
    await adminSql(
      `INSERT INTO transactions (user_id, account_id, fixed_cost_id, amount, type, transaction_date, source, note)
       VALUES ($1,$2,$3,700,'expense',$4,'auto','週1')`,
      [user.id, account, id, addDays(today, -35)]
    );

    expect((await fcOne.PUT(jsonRequest("PUT", "/x", { is_active: false }), params(id))).status).toBe(200);
    await expand(user.id, today);
    expect(await autoTx(user.id, id)).toHaveLength(1);

    expect((await fcOne.PUT(jsonRequest("PUT", "/x", { is_active: true }), params(id))).status).toBe(200);
    await expand(user.id, today);
    // 再開後に作られるのは今日の分だけ（止めていた -28, -21, -14, -7 日の分は作らない）
    expect((await autoTx(user.id, id)).map((x) => x.d)).toEqual([addDays(today, -35), today]);
  });
});

describe("R8 定期の編集は、もう作った取引を書き換えない", () => {
  it("金額・名前を変えても過去の取引はそのまま、以降の回だけ新しい値", async () => {
    const { user, account } = await newUser("r8");
    as(user);
    const fc = await createFc({
      account_id: account, name: "電気", amount: 1000, billing_day: 1, start_date: "2026-08-01",
    });
    const id = fc.body.data.id;
    await expand(user.id, "2026-09-30");

    const upd = await fcOne.PUT(jsonRequest("PUT", "/x", { amount: 2000, name: "電気（新プラン）" }), params(id));
    expect(upd.status).toBe(200);
    await expand(user.id, "2026-10-31");

    expect((await autoTx(user.id, id)).map((x) => [x.d, Number(x.amount), x.note])).toEqual([
      ["2026-08-01", 1000, "電気"],
      ["2026-09-01", 1000, "電気"],
      ["2026-10-01", 2000, "電気（新プラン）"],
    ]);
  });

  it("定期を削除しても作った取引は残る", async () => {
    const { user, account } = await newUser("r8d");
    as(user);
    const fc = await createFc({ account_id: account, name: "x", amount: 300, billing_day: 1, start_date: "2026-09-01" });
    await expand(user.id, "2026-10-08");
    expect((await fcOne.DELETE(jsonRequest("DELETE", "/x"), params(fc.body.data.id))).status).toBe(200);
    const rows = await adminSql("SELECT 1 FROM transactions WHERE user_id=$1 AND deleted_at IS NULL", [user.id]);
    expect(rows).toHaveLength(2);
  });
});

describe("R9 一覧は次回日付順で、月の固定費合計が出る", () => {
  it("次回日付の昇順（止めているものは最後）と、月あたりの支出・収入合計", async () => {
    const { user, account } = await newUser("r9");
    const today = todayJst();
    as(user);
    const day = (d: string) => Number(d.slice(8, 10));
    const month = (d: string) => Number(d.slice(5, 7));
    const m = addDays(today, 10);
    const y = addDays(today, 5);
    await createFc({ account_id: account, name: "毎月", amount: 1000, billing_day: day(m), start_date: m });
    await createFc({
      account_id: account, name: "毎年", amount: 12000, cycle: "yearly",
      billing_day: day(y), billing_month: month(y), start_date: y,
    });
    await createFc({ account_id: account, name: "毎週", amount: 500, cycle: "weekly", start_date: addDays(today, 2) });
    await createFc({ account_id: account, name: "止めた", amount: 9999, billing_day: 1, is_active: false });
    await createFc({ account_id: account, name: "給料", amount: 200000, type: "income", billing_day: day(m), start_date: m });

    const res = await fcList.GET();
    const { data, meta } = (await res.json()) as { data: { name: string; next_date: string | null }[]; meta: Record<string, number> };
    expect(data.map((x) => [x.name, x.next_date])).toEqual([
      ["毎週", addDays(today, 2)],
      ["毎年", y],
      ["毎月", m],
      ["給料", m],
      ["止めた", null],
    ]);
    // 1000 + 12000/12 + 500×52/12（=2167）。止めたものは入れない
    expect(meta.monthly_expense_total).toBe(4167);
    expect(meta.monthly_income_total).toBe(200000);
  });
});

describe("定期支出の入力（API）", () => {
  it("不正な周期・毎年なのに月が無い は 422", async () => {
    const { user, account } = await newUser("fcv");
    as(user);
    expect((await createFc({ account_id: account, name: "x", amount: 100, billing_day: 1, cycle: "daily" })).status).toBe(422);
    expect((await createFc({ account_id: account, name: "x", amount: 100, billing_day: 1, cycle: "yearly" })).status).toBe(422);
  });

  it("更新で毎年に変えるときも billing_month が要る（既存の値と合わせて確かめる）", async () => {
    const { user, account } = await newUser("fcv2");
    as(user);
    const fc = await createFc({ account_id: account, name: "x", amount: 100, billing_day: 1 });
    const id = fc.body.data.id;
    expect((await fcOne.PUT(jsonRequest("PUT", "/x", { cycle: "yearly" }), params(id))).status).toBe(422);
    expect((await fcOne.PUT(jsonRequest("PUT", "/x", { cycle: "yearly", billing_month: 6 }), params(id))).status).toBe(200);
  });
});
