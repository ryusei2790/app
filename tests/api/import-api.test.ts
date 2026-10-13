/**
 * @file tests/api/import-api.test.ts
 * @description テスト一覧 I（買い切り家計簿アプリの CSV 取り込み）と S10・S11 の API・DB 層。
 * POST /api/v1/import を preview（保存しない）→ commit（選んだ行だけ保存）の2段階で呼び、
 * ローカル Supabase（RLS 有効）に何が残るかを見る。CSV は作り物だけ。
 * 「今日」は実際の JST の日付なので、予定の行は 2099 年にしている。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));

import { NextRequest } from "next/server";
import { signInAs } from "../helpers/auth-state";
import { readJson } from "../helpers/api";
import { adminSql, closeAdminSql, createTestUser, seedAccount, type TestUser } from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import * as imp from "@/app/api/v1/import/route";

const HEADER = "金額,日付,メモ,カテゴリー名";
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n") + "\n";

const users: TestUser[] = [];
async function newUser(label: string) {
  const u = await createTestUser(label);
  users.push(u);
  signInAs({ id: u.id, email: u.email });
  return { user: u, account: await seedAccount(u.id) };
}

afterEach(() => {
  signInAs(null);
  vi.restoreAllMocks();
});

afterAll(async () => {
  const ids = users.map((u) => u.id);
  await adminSql("DELETE FROM transactions WHERE user_id = ANY($1::uuid[])", [ids]);
  await adminSql("DELETE FROM fixed_costs WHERE user_id = ANY($1::uuid[])", [ids]);
  await prisma.$disconnect();
  await closeAdminSql();
});

interface CallOpts {
  mode?: "preview" | "commit";
  accountId?: string;
  scheduleKeys?: string[];
  filename?: string;
  cardType?: string;
}

async function callImport(content: string | Uint8Array, o: CallOpts = {}) {
  const form = new FormData();
  form.append("file", new File([content], o.filename ?? "export.csv", { type: "text/csv" }));
  form.append("mode", o.mode ?? "commit");
  if (o.accountId) form.append("account_id", o.accountId);
  if (o.cardType) form.append("card_type", o.cardType);
  if (o.scheduleKeys) form.append("schedule_keys", JSON.stringify(o.scheduleKeys));
  const res = await imp.POST(new NextRequest("http://localhost:3000/api/v1/import", { method: "POST", body: form }));
  return { status: res.status, body: await readJson(res) };
}

const txRows = (userId: string) =>
  adminSql<{ d: string; amount: string; type: string; note: string | null; category: string | null; source: string; import_key: string | null }>(
    `SELECT to_char(t.transaction_date,'YYYY-MM-DD') AS d, t.amount, t.type, t.note, c.name AS category, t.source, t.import_key
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = $1 AND t.deleted_at IS NULL ORDER BY t.transaction_date, t.amount`,
    [userId]
  );

describe("家計簿アプリ形式の取り込み（基本）", () => {
  it("ヘッダーで形式を自動判定し、支出・収入・カテゴリー・メモ付きで取引になる", async () => {
    const { user, account } = await newUser("i-basic");
    const r = await callImport(csv("-500,2026/09/03,パン,食費", "30000,2026/09/30,,給料"), { accountId: account });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ format: "kakebo", imported_count: 2 });
    const rows = await txRows(user.id);
    expect(rows.map((t) => [t.d, Number(t.amount), t.type, t.note, t.category, t.source])).toEqual([
      ["2026-09-03", 500, "expense", "パン", "食費", "csv"],
      ["2026-09-30", 30000, "income", null, "給料", "csv"],
    ]);
    expect(rows.every((t) => t.import_key?.startsWith("v1:"))).toBe(true);
  });

  it("口座に new を指定すると「家計簿アプリ（移行）」口座を作り、2回目は同じ口座を使う", async () => {
    const { user } = await newUser("i-acct");
    await callImport(csv("-500,2026/09/03,パン,食費"), { accountId: "new" });
    await callImport(csv("-600,2026/09/04,パン,食費"), { accountId: "new" });
    const accts = await adminSql<{ name: string }>("SELECT name FROM accounts WHERE user_id = $1 AND name = '家計簿アプリ（移行）'", [user.id]);
    expect(accts).toHaveLength(1);
  });

  it("他人の口座を指定すると 404 で何も入らない", async () => {
    const other = await newUser("i-other");
    const { user } = await newUser("i-me");
    const r = await callImport(csv("-500,2026/09/03,パン,食費"), { accountId: other.account });
    expect(r.status).toBe(404);
    expect(await txRows(user.id)).toHaveLength(0);
    expect(await txRows(other.user.id)).toHaveLength(0);
  });
});

describe("I3 読めない行", () => {
  it("読めない行は行番号と理由付きで返り、他の行は取り込まれる", async () => {
    const { user, account } = await newUser("i3");
    const r = await callImport(csv("-500,2026/09/03,パン,食費", "0,2026/09/03,,食費", "-1,2026/02/30,,食費"), { accountId: account });
    expect(r.body.data.imported_count).toBe(1);
    expect(r.body.data.invalid.map((e: { line: number }) => e.line)).toEqual([3, 4]);
    expect(await txRows(user.id)).toHaveLength(1);
  });
});

describe("I4・I5・I6 何回入れても増えない", () => {
  it("I4 同じ CSV を2回取り込むと2回目は 0 件", async () => {
    const { user, account } = await newUser("i4");
    const file = csv("-500,2026/09/03,パン,食費", "-300,2026/09/01,,日用品");
    expect((await callImport(file, { accountId: account })).body.data.imported_count).toBe(2);
    const second = await callImport(file, { accountId: account, filename: "別の名前.csv" });
    expect(second.body.data).toMatchObject({ imported_count: 0, skipped_count: 2 });
    expect(await txRows(user.id)).toHaveLength(2);
  });

  it("I5 同じ日・金額・カテゴリー・メモの2行は2件入り、もう一度入れても2件のまま", async () => {
    const { user, account } = await newUser("i5");
    const file = csv("-500,2026/09/03,パン,食費", "-500,2026/09/03,パン,食費");
    await callImport(file, { accountId: account });
    await callImport(file, { accountId: account });
    expect(await txRows(user.id)).toHaveLength(2);
  });

  it("I6 期間が重なる書き出しを古い順に入れると、新しい行だけ増える", async () => {
    const { user, account } = await newUser("i6");
    await callImport(csv("-500,2026/09/03,パン,食費", "-300,2026/09/01,,日用品"), { accountId: account });
    const r = await callImport(csv("-700,2026/09/10,,食費", "-500,2026/09/03,パン,食費", "-300,2026/09/01,,日用品"), { accountId: account });
    expect(r.body.data.imported_count).toBe(1);
    expect((await txRows(user.id)).map((t) => t.d)).toEqual(["2026-09-01", "2026-09-03", "2026-09-10"]);
  });
});

describe("I7 今日より後の行は定期支出にするかを選ぶ", () => {
  const file = csv("-59590,2099/12/27,家賃,家賃", "200000,2099/12/31,,給料", "-500,2026/09/03,パン,食費");

  it("preview で予定の行が目印・支払日付きで返る", async () => {
    const { account } = await newUser("i7p");
    const r = await callImport(file, { mode: "preview", accountId: account });
    expect(r.body.data.counts).toMatchObject({ fresh: 1, future: 2 });
    expect(r.body.data.future.map((f: { date: string; billing_day: number }) => [f.date, f.billing_day])).toEqual([
      ["2099-12-27", 27],
      ["2099-12-31", 31],
    ]);
  });

  it("選んだ行だけ毎月・その日の定期になり、予定は取引にならない", async () => {
    const { user, account } = await newUser("i7c");
    const pv = await callImport(file, { mode: "preview", accountId: account });
    const rent = pv.body.data.future.find((f: { category_name: string }) => f.category_name === "家賃");
    const r = await callImport(file, { accountId: account, scheduleKeys: [rent.key] });
    expect(r.body.data).toMatchObject({ imported_count: 1, scheduled_count: 1 });

    const fcs = await adminSql<{ name: string; amount: string; type: string; cycle: string; billing_day: number; start: string; category: string }>(
      `SELECT f.name, f.amount, f.type, f.cycle, f.billing_day, to_char(f.start_date,'YYYY-MM-DD') AS start, c.name AS category
         FROM fixed_costs f LEFT JOIN categories c ON c.id = f.category_id WHERE f.user_id = $1`,
      [user.id]
    );
    expect(fcs.map((f) => [f.name, Number(f.amount), f.type, f.cycle, f.billing_day, f.start, f.category])).toEqual([
      ["家賃", 59590, "expense", "monthly", 27, "2099-12-27", "家賃"],
    ]);
    expect((await txRows(user.id)).map((t) => t.d)).toEqual(["2026-09-03"]);
  });

  it("何も選ばなければ定期は作られない。同じ予定をもう一度入れても定期は増えない", async () => {
    const { user, account } = await newUser("i7n");
    await callImport(file, { accountId: account, scheduleKeys: [] });
    expect(await adminSql("SELECT 1 FROM fixed_costs WHERE user_id = $1", [user.id])).toHaveLength(0);

    const pv = await callImport(file, { mode: "preview", accountId: account });
    const keys = pv.body.data.future.map((f: { key: string }) => f.key);
    await callImport(file, { accountId: account, scheduleKeys: keys });
    const again = await callImport(file, { mode: "preview", accountId: account });
    expect(again.body.data.future.every((f: { already_scheduled: boolean }) => f.already_scheduled)).toBe(true);
    await callImport(file, { accountId: account, scheduleKeys: keys });
    expect(await adminSql("SELECT 1 FROM fixed_costs WHERE user_id = $1", [user.id])).toHaveLength(2);
  });
});

describe("I8 定期で自動作成された取引と同じ行はとばす", () => {
  it("同じ日・金額・カテゴリーの自動取引があれば取り込まない", async () => {
    const { user, account } = await newUser("i8");
    // 先に CSV で家賃カテゴリーを作り、そのカテゴリーで定期の自動取引を用意する
    await callImport(csv("-1,2026/01/01,,家賃"), { accountId: account });
    const [{ id: cat }] = await adminSql<{ id: string }>("SELECT id FROM categories WHERE user_id = $1 AND name = '家賃'", [user.id]);
    const [{ id: fc }] = await adminSql<{ id: string }>(
      `INSERT INTO fixed_costs (user_id, account_id, category_id, name, amount, billing_day, start_date)
       VALUES ($1, $2, $3, '家賃', 59590, 27, '2026-09-01') RETURNING id`,
      [user.id, account, cat]
    );
    await adminSql(
      `INSERT INTO transactions (user_id, account_id, category_id, fixed_cost_id, amount, type, transaction_date, note, source)
       VALUES ($1, $2, $3, $4, 59590, 'expense', '2026-09-27', '家賃', 'auto')`,
      [user.id, account, cat, fc]
    );

    const r = await callImport(csv("-59590,2026/09/27,家賃,家賃"), { accountId: account });
    expect(r.body.data).toMatchObject({ imported_count: 0, skipped_count: 1 });
    const rent = (await txRows(user.id)).filter((t) => t.d === "2026-09-27");
    expect(rent.map((t) => t.source)).toEqual(["auto"]);
  });
});

describe("I9 カテゴリーは名前＋支出/収入で照合する", () => {
  it("無いカテゴリーは本人のカテゴリーとして作り、2回目は作らない。「その他」は支出と収入で別", async () => {
    const { user, account } = await newUser("i9");
    const file = csv("-100,2026/09/01,,趣味", "-200,2026/09/02,,その他", "300,2026/09/03,,その他");
    await callImport(file, { accountId: account });
    await callImport(csv("-150,2026/09/05,,趣味"), { accountId: account });
    const own = await adminSql<{ name: string; type: string }>(
      "SELECT name, type FROM categories WHERE user_id = $1 ORDER BY name, type",
      [user.id]
    );
    // 「その他（支出）」は共通カテゴリーにあるので作らない
    expect(own).toEqual([
      { name: "その他", type: "income" },
      { name: "趣味", type: "expense" },
    ]);
    const rows = await txRows(user.id);
    expect(rows.filter((t) => t.category === "その他").map((t) => t.type).sort()).toEqual(["expense", "income"]);
  });
});

describe("I10 preview は保存しない・commit は全部か無しか", () => {
  it("preview では取引・定期・履歴・カテゴリー・口座のどれも増えない", async () => {
    const { user } = await newUser("i10p");
    const r = await callImport(csv("-100,2026/09/01,,趣味", "-1,2099/01/01,,家賃"), { mode: "preview", accountId: "new" });
    expect(r.status).toBe(200);
    for (const table of ["transactions", "fixed_costs", "csv_imports", "categories"]) {
      expect(await adminSql(`SELECT 1 FROM ${table} WHERE user_id = $1`, [user.id])).toHaveLength(0);
    }
    expect(await adminSql("SELECT 1 FROM accounts WHERE user_id = $1", [user.id])).toHaveLength(1); // seedAccount の1つだけ
  });

  it("commit の途中（定期の作成）で失敗すると、取引・履歴・カテゴリーも残らない", async () => {
    const { user, account } = await newUser("i10c");
    await adminSql(`
      CREATE OR REPLACE FUNCTION public.test_fail_fixed_cost() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name = 'I10-FAIL' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`);
    await adminSql("DROP TRIGGER IF EXISTS test_fail_fixed_cost ON fixed_costs");
    await adminSql("CREATE TRIGGER test_fail_fixed_cost BEFORE INSERT ON fixed_costs FOR EACH ROW EXECUTE FUNCTION public.test_fail_fixed_cost()");
    try {
      const file = csv("-100,2026/09/01,,趣味", "-1,2099/01/01,I10-FAIL,家賃");
      const pv = await callImport(file, { mode: "preview", accountId: account });
      const r = await callImport(file, { accountId: account, scheduleKeys: [pv.body.data.future[0].key] });
      expect(r.status).toBe(500);
      for (const table of ["transactions", "fixed_costs", "csv_imports", "categories"]) {
        expect(await adminSql(`SELECT 1 FROM ${table} WHERE user_id = $1`, [user.id])).toHaveLength(0);
      }
    } finally {
      await adminSql("DROP TRIGGER IF EXISTS test_fail_fixed_cost ON fixed_costs");
      await adminSql("DROP FUNCTION IF EXISTS public.test_fail_fixed_cost()");
    }
  });
});

describe("I11 Shift_JIS", () => {
  it("Shift_JIS の CSV も取り込める", async () => {
    const { user, account } = await newUser("i11");
    // 「金額,日付,メモ,カテゴリー名\n-100,2026/09/01,パン,食費\n」の Shift_JIS
    const sjis = new Uint8Array([
      0x8b, 0xe0, 0x8a, 0x7a, 0x2c, 0x93, 0xfa, 0x95, 0x74, 0x2c, 0x83, 0x81, 0x83, 0x82, 0x2c,
      0x83, 0x4a, 0x83, 0x65, 0x83, 0x53, 0x83, 0x8a, 0x81, 0x5b, 0x96, 0xbc, 0x0a,
      0x2d, 0x31, 0x30, 0x30, 0x2c, 0x32, 0x30, 0x32, 0x36, 0x2f, 0x30, 0x39, 0x2f, 0x30, 0x31, 0x2c,
      0x83, 0x70, 0x83, 0x93, 0x2c, 0x90, 0x48, 0x94, 0xef, 0x0a,
    ]);
    const r = await callImport(sjis, { accountId: account });
    expect(r.body.data.imported_count).toBe(1);
    expect((await txRows(user.id))[0]).toMatchObject({ note: "パン", category: "食費" });
  });
});

describe("I12 大きすぎる CSV は断る", () => {
  it("5MB を超えると 413", async () => {
    const { account } = await newUser("i12a");
    const big = HEADER + "\n" + `-1,2026/09/01,${"あ".repeat(100)},食費\n`.repeat(20_000);
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(5 * 1024 * 1024);
    expect((await callImport(big, { accountId: account })).status).toBe(413);
  });

  it("2万行を超えると 422", async () => {
    const { user, account } = await newUser("i12b");
    const many = HEADER + "\n" + "-1,2026/09/01,,食費\n".repeat(20_001);
    expect((await callImport(many, { accountId: account })).status).toBe(422);
    expect(await txRows(user.id)).toHaveLength(0);
  });
});

describe("S10 目印の一意は利用者ごと", () => {
  it("2人が同じ CSV を入れても、互いに影響せず両方に入る", async () => {
    const file = csv("-500,2026/09/03,パン,食費", "-500,2026/09/03,パン,食費");
    const a = await newUser("s10a");
    await callImport(file, { accountId: a.account });
    const b = await newUser("s10b");
    const r = await callImport(file, { accountId: b.account });
    expect(r.body.data.imported_count).toBe(2);
    expect(await txRows(a.user.id)).toHaveLength(2);
    expect(await txRows(b.user.id)).toHaveLength(2);
  });

  it("他人が取り込んだかどうかは preview に出ない（自分の分だけで判定）", async () => {
    const file = csv("-777,2026/09/07,同じ,食費");
    const a = await newUser("s10c");
    await callImport(file, { accountId: a.account });
    const b = await newUser("s10d");
    const pv = await callImport(file, { mode: "preview", accountId: b.account });
    expect(pv.body.data.counts).toMatchObject({ fresh: 1, already: 0 });
  });
});

describe("S11 CSV の中身を残さない・ログに出さない", () => {
  it("取り込み中に金額・メモがログに出ない", async () => {
    const { account } = await newUser("s11a");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await callImport(csv("-4321,2026/09/03,ひみつのメモ,食費", "0,2026/09/03,ひみつ2,食費"), { mode: "preview", accountId: account });
    await callImport(csv("-4321,2026/09/03,ひみつのメモ,食費", "0,2026/09/03,ひみつ2,食費"), { accountId: account });
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
    expect(logged).not.toContain("ひみつ");
    expect(logged).not.toContain("4321");
  });

  it("取り込み履歴にはファイル名と件数だけ（CSV の中身は残さない）", async () => {
    const { user, account } = await newUser("s11b");
    await callImport(csv("-4321,2026/09/03,ひみつのメモ,食費"), { accountId: account, filename: "kakebo.csv" });
    const rows = await adminSql("SELECT * FROM csv_imports WHERE user_id = $1", [user.id]);
    expect(rows).toHaveLength(1);
    const dump = JSON.stringify(rows);
    expect(dump).toContain("kakebo.csv");
    expect(dump).not.toContain("ひみつ");
    expect(dump).not.toContain("4321");
  });
});

describe("既存のカード形式（エポス）は今までどおり", () => {
  it("card_type=epos で取り込める", async () => {
    const { user, account } = await newUser("epos");
    const r = await callImport("ご利用日,ご利用先など,ご利用金額(円)\n2026/09/01,コンビニ,500\n", { accountId: account, cardType: "epos" });
    expect(r.status).toBe(200);
    expect(await txRows(user.id)).toHaveLength(1);
  });
});
