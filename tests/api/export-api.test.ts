/**
 * @file tests/api/export-api.test.ts
 * @description テスト一覧 X1〜X6・S14（mywork#425 第2弾）の API・DB 層。ローカル Supabase（RLS 有効）だけを相手にする。
 *   X1 家計簿アプリ形式 CSV の書き出し（GET /api/v1/export?format=kakebo-csv）
 *   X2 完全形式 JSON に本人の全表が入り、他人の行は入らない（GET /api/v1/export?format=full-json）
 *   X3 復元は空の帳簿だけ（POST /api/v1/restore）。復元後に完全形式を取ると同じ内容
 *   X4 全削除（POST /api/v1/account/delete-all）。確認語が無ければ 422。他人の行と auth のユーザーは残る
 *   X5 取り込みの取り消し（DELETE /api/v1/import/:id）。その取り込みの取引だけ消え、定期・カテゴリーは残る
 *   X6 未ログインは 401。ログに中身を出さない
 *   RLS アプリのコードが userId の絞り込みを書き忘れても、他人の行は読めない・消せない（二重の守りの DB 側）
 * データは作り物だけ。本番の DB・設定には繋がない（global-setup が 127.0.0.1 以外を拒む）。
 */

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));

import { NextRequest } from "next/server";
import { signInAs } from "../helpers/auth-state";
import { getRequest, jsonRequest, params, readJson } from "../helpers/api";
import { adminSql, closeAdminSql, commonCategoryId, createTestUser, type TestUser } from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import { withUserDb } from "@/lib/db";
import { decodeCsv } from "@/lib/csv/decode";
import { parseKakebo } from "@/lib/csv/kakebo";
import * as exportRoute from "@/app/api/v1/export/route";
import * as restoreRoute from "@/app/api/v1/restore/route";
import * as deleteAllRoute from "@/app/api/v1/account/delete-all/route";
import * as importIdRoute from "@/app/api/v1/import/[id]/route";
import * as importRoute from "@/app/api/v1/import/route";

const users: TestUser[] = [];
async function newUser(label: string) {
  const u = await createTestUser(label);
  users.push(u);
  return u;
}
const as = (u: TestUser | null) => signInAs(u ? { id: u.id, email: u.email } : null);

afterEach(() => {
  signInAs(null);
  vi.restoreAllMocks();
});

afterAll(async () => {
  const ids = users.map((u) => u.id);
  // 参照の向きの逆順に消す（テストの後片付け。管理者接続）
  for (const t of ["receipts", "transactions", "budget_rules", "budget_frames", "fixed_costs", "csv_imports", "categories", "accounts"]) {
    await adminSql(`DELETE FROM ${t} WHERE user_id = ANY($1::uuid[])`, [ids]);
  }
  await prisma.$disconnect();
  await closeAdminSql();
});

/** 全部の表に1行以上ある帳簿を作る（作り物）。marker はメモに入れて、他人の行が混ざっていないかを見る目印 */
async function seedFull(userId: string, marker: string) {
  const one = async (sql: string, p: unknown[]) => (await adminSql<{ id: string }>(sql, p))[0].id;
  const account = await one("INSERT INTO accounts (user_id, name, type) VALUES ($1, '財布', 'cash') RETURNING id", [userId]);
  const ownCat = await one("INSERT INTO categories (user_id, name, type, color) VALUES ($1, '推し活', 'expense', '#FF6B6B') RETURNING id", [userId]);
  const common = await commonCategoryId("expense");
  const fixed = await one(
    `INSERT INTO fixed_costs (user_id, account_id, category_id, name, amount, type, cycle, billing_day, start_date, match_note)
     VALUES ($1, $2, $3, '家賃', 80000, 'expense', 'monthly', 25, '2026-01-01', '家賃') RETURNING id`,
    [userId, account, common]
  );
  const imp = await one(
    "INSERT INTO csv_imports (user_id, account_id, filename, status, row_count) VALUES ($1, $2, 'old.csv', 'success', 1) RETURNING id",
    [userId, account]
  );
  const tx = (o: { amount: number; type: string; kind?: string; date: string; note: string; source: string; cat?: string | null; fixed?: string | null; imp?: string | null; key?: string | null; deleted?: boolean }) =>
    one(
      `INSERT INTO transactions (user_id, account_id, category_id, fixed_cost_id, amount, type, kind, transaction_date, note, source, csv_import_id, import_key, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [userId, account, o.cat ?? null, o.fixed ?? null, o.amount, o.type, o.kind ?? "normal", o.date, o.note, o.source, o.imp ?? null, o.key ?? null, o.deleted ? new Date() : null]
    );
  const manual = await tx({ amount: 1200, type: "expense", date: "2026-09-03", note: `${marker} ランチ`, source: "manual", cat: common });
  await tx({ amount: 300, type: "income", kind: "refund", date: "2026-09-05", note: `${marker} 返金`, source: "manual", cat: common });
  await tx({ amount: 80000, type: "expense", date: "2026-09-25", note: `${marker} 家賃`, source: "auto", fixed });
  await tx({ amount: 500, type: "expense", date: "2026-09-10", note: `${marker} CSV`, source: "csv", cat: ownCat, imp, key: `v1:${marker}:1` });
  await tx({ amount: 999, type: "expense", date: "2026-09-11", note: `${marker} 消した行`, source: "manual", deleted: true });
  await tx({ amount: 5000, type: "expense", date: "2099-12-25", note: `${marker} 予定`, source: "manual" });
  await adminSql(
    `INSERT INTO receipts (user_id, transaction_id, merchant, purchased_at, total, items, model)
     VALUES ($1, $2, 'パン屋', '2026-09-03', 1200, '[{"name":"パン","price":1200}]'::jsonb, 'mock')`,
    [userId, manual]
  );
  const frame = await one("INSERT INTO budget_frames (user_id, name, monthly_limit, sort_order) VALUES ($1, '食費', 30000, 1) RETURNING id", [userId]);
  await adminSql("INSERT INTO budget_rules (user_id, category_id, frame_id, priority) VALUES ($1, $2, $3, 1)", [userId, common, frame]);
  return { account, ownCat, common, fixed, imp, manual, frame };
}

const TABLES = ["accounts", "categories", "fixed_costs", "csv_imports", "transactions", "receipts", "budget_frames", "budget_rules"] as const;
async function countAll(userId: string) {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    out[t] = Number((await adminSql<{ n: string }>(`SELECT count(*) AS n FROM ${t} WHERE user_id = $1`, [userId]))[0].n);
  }
  return out;
}

async function getExport(format: string) {
  return exportRoute.GET(getRequest(`/api/v1/export?format=${encodeURIComponent(format)}`));
}
async function fullJson() {
  const res = await getExport("full-json");
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}
const restore = (body: unknown) =>
  restoreRoute.POST(new NextRequest("http://localhost:3000/api/v1/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
const deleteAll = (body?: unknown) => deleteAllRoute.POST(jsonRequest("POST", "/api/v1/account/delete-all", body));
const undo = (id: string) => importIdRoute.DELETE(new NextRequest(`http://localhost:3000/api/v1/import/${id}`, { method: "DELETE" }), params(id));

/** 中身の比較用: 書き出した日時だけ外す */
const withoutStamp = (b: { exported_at?: string }) => ({ ...b, exported_at: undefined });

describe("X6・S14 未ログインは 401", () => {
  it("書き出し・復元・全削除・取り込みの取り消しは 401", async () => {
    as(null);
    expect((await getExport("kakebo-csv")).status).toBe(401);
    expect((await getExport("full-json")).status).toBe(401);
    expect((await restore({})).status).toBe(401);
    expect((await deleteAll({ confirm: "削除" })).status).toBe(401);
    expect((await undo("11111111-1111-4111-8111-111111111111")).status).toBe(401);
  });
});

describe("X1 家計簿アプリ形式 CSV の書き出し", () => {
  it("本人の消していない取引だけが、BOM 付き UTF-8 の添付ファイルで返り、読み戻せる", async () => {
    const me = await newUser("x1-me");
    const other = await newUser("x1-other");
    await seedFull(me.id, "自分");
    await seedFull(other.id, "他人");
    as(me);

    const res = await getExport("kakebo-csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="kakebo_\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const { rows, invalid } = parseKakebo(decodeCsv(bytes));
    expect(invalid).toEqual([]);
    // 6件のうち消した1件を除く5件。返金（種類 refund）は収入の向きなので正、予定も入る
    expect(rows.map((r) => [r.date, r.type === "expense" ? -r.amount : r.amount, r.note])).toEqual([
      ["2026-09-03", -1200, "自分 ランチ"],
      ["2026-09-05", 300, "自分 返金"],
      ["2026-09-10", -500, "自分 CSV"],
      ["2026-09-25", -80000, "自分 家賃"],
      ["2099-12-25", -5000, "自分 予定"],
    ]);
    expect(rows.find((r) => r.note === "自分 CSV")?.categoryName).toBe("推し活");
    expect(rows.some((r) => r.note.startsWith("他人"))).toBe(false);
  });

  it("format が無い・知らない形式なら 422", async () => {
    const me = await newUser("x1-format");
    as(me);
    expect((await exportRoute.GET(getRequest("/api/v1/export"))).status).toBe(422);
    expect((await getExport("xlsx")).status).toBe(422);
  });
});

describe("X2 完全形式 JSON", () => {
  it("本人の全表（消した取引・種類・行の目印・レシート・費目・対応表・定期の条件込み）が入り、他人の行は入らない", async () => {
    const me = await newUser("x2-me");
    const other = await newUser("x2-other");
    const mine = await seedFull(me.id, "自分");
    await seedFull(other.id, "他人");
    as(me);

    const res = await getExport("full-json");
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="kakebo-full_\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    const b = JSON.parse(text);
    expect(b).toMatchObject({ format: "kakebo-full", version: 1 });
    expect(b.counts).toEqual({
      accounts: 1, categories: 1, fixed_costs: 1, csv_imports: 1, transactions: 6, receipts: 1, budget_frames: 1, budget_rules: 1,
    });
    const txs = b.data.transactions as Array<Record<string, unknown>>;
    expect(txs.find((t) => t.note === "自分 返金")).toMatchObject({ kind: "refund", type: "income", amount: 300 });
    expect(txs.find((t) => t.note === "自分 消した行")?.deleted_at).not.toBeNull();
    expect(txs.find((t) => t.note === "自分 CSV")).toMatchObject({ import_key: "v1:自分:1", csv_import_id: mine.imp, source: "csv" });
    expect(b.data.fixed_costs[0]).toMatchObject({ name: "家賃", match_note: "家賃", billing_day: 25, start_date: "2026-01-01" });
    expect(b.data.receipts[0]).toMatchObject({ merchant: "パン屋", items: [{ name: "パン", price: 1200 }] });
    expect(b.data.budget_rules[0]).toMatchObject({ frame_id: mine.frame, category_id: mine.common });
    // 共通カテゴリーは「名前と種別」で持つ（別の DB に戻しても id を付け直せるように）
    expect(b.data.common_categories).toContainEqual({ id: mine.common, name: expect.any(String), type: "expense" });
    // 他人の行・他人の id は1つも入っていない
    expect(text).not.toContain("他人");
    expect(text).not.toContain(other.id);
  });

  it("RLS: アプリのコードが userId の絞り込みを書き忘れても、他人の取引は読めない", async () => {
    const me = await newUser("x2-rls-me");
    const other = await newUser("x2-rls-other");
    await seedFull(me.id, "自分");
    await seedFull(other.id, "他人");
    const all = await withUserDb(me.id, (db) => db.transaction.findMany({ select: { userId: true } }));
    expect(all.length).toBe(6);
    expect(all.every((t) => t.userId === me.id)).toBe(true);
  });
});

describe("X3 復元", () => {
  it("空でない帳簿には 409 で何も変えない", async () => {
    const me = await newUser("x3-409");
    await seedFull(me.id, "自分");
    as(me);
    const backup = await fullJson();
    const before = await countAll(me.id);
    const res = await restore(backup);
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.message).toMatch(/全削除/);
    expect(await countAll(me.id)).toEqual(before);
  });

  it("全削除 → 復元すると、復元後の完全形式が元と同じ内容になる（id・作成日時も保つ）", async () => {
    const me = await newUser("x3-roundtrip");
    await seedFull(me.id, "自分");
    as(me);
    const original = await fullJson();
    expect((await deleteAll({ confirm: "削除" })).status).toBe(200);

    const res = await restore(original);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data.restored).toEqual(original.counts);
    const again = await fullJson();
    expect(withoutStamp(again)).toEqual(withoutStamp(original));
  });

  it("同じミリ秒に作った行（DB はマイクロ秒まで持つ）でも、復元の前後で並びが変わらない", async () => {
    const me = await newUser("x3-micro");
    const { account } = await seedFull(me.id, "自分");
    // マイクロ秒の順（A→B）と id の順（B→A）が逆になる2行
    const ins = (id: string, at: string, note: string) =>
      adminSql(
        `INSERT INTO transactions (id, user_id, account_id, amount, type, transaction_date, note, source, created_at, updated_at)
         VALUES ($1, $2, $3, 100, 'expense', '2026-09-01', $4, 'manual', $5, $5)`,
        [id, me.id, account, note, at]
      );
    await ins("ffffffff-ffff-4fff-bfff-ffffffffffff", "2026-01-01T00:00:00.000100Z", "A");
    await ins("00000000-0000-4000-8000-000000000001", "2026-01-01T00:00:00.000900Z", "B");
    as(me);
    const original = await fullJson();
    await deleteAll({ confirm: "削除" });
    expect((await restore(original)).status).toBe(200);
    expect(withoutStamp(await fullJson())).toEqual(withoutStamp(original));
  });

  it("自動で作られた費目の初期値だけがある帳簿は「空」とみなし、バックアップの費目で置き換える", async () => {
    const me = await newUser("x3-frames");
    await seedFull(me.id, "自分");
    as(me);
    const original = await fullJson();
    await deleteAll({ confirm: "削除" });
    // 予算台帳を開くと初期の8費目が自動で作られる（ensureBudgetDefaults）のと同じ状態
    await adminSql("INSERT INTO budget_frames (user_id, name, monthly_limit) VALUES ($1, '自動の費目', 0)", [me.id]);
    expect((await restore(original)).status).toBe(200);
    const frames = await adminSql<{ name: string }>("SELECT name FROM budget_frames WHERE user_id = $1", [me.id]);
    expect(frames.map((f) => f.name)).toEqual(["食費"]);
  });

  it("他人のバックアップ（同じ id の行が他人の帳簿にある）は 409 で、どちらの帳簿も変わらない", async () => {
    const owner = await newUser("x3-owner");
    const thief = await newUser("x3-thief");
    await seedFull(owner.id, "持ち主");
    as(owner);
    const backup = await fullJson();
    const ownerBefore = await countAll(owner.id);
    as(thief);
    const res = await restore(backup);
    expect(res.status).toBe(409);
    expect(await countAll(owner.id)).toEqual(ownerBefore);
    expect(Object.values(await countAll(thief.id)).every((n) => n === 0)).toBe(true);
  });

  it("形が不正な JSON・参照先の無い行は 422 で、途中まで入ることはない", async () => {
    const me = await newUser("x3-422");
    as(me);
    expect((await restore("{not json")).status).toBe(422);
    expect((await restore({ format: "other" })).status).toBe(422);

    const src = await newUser("x3-422-src");
    await seedFull(src.id, "元");
    as(src);
    const backup = await fullJson();
    // 口座の一覧から外す → 取引・定期・履歴が口座を参照できない
    backup.data.accounts = [];
    backup.counts.accounts = 0;
    as(me);
    const res = await restore(backup);
    expect(res.status).toBe(422);
    expect(Object.values(await countAll(me.id)).every((n) => n === 0)).toBe(true);
  });

  it("4MB を超える本文は 413", async () => {
    const me = await newUser("x3-413");
    as(me);
    const res = await restore(JSON.stringify({ pad: "x".repeat(4 * 1024 * 1024 + 1) }));
    expect(res.status).toBe(413);
  });
});

describe("X4 全削除", () => {
  it("確認語が無い・違うなら 422 で何も消えない", async () => {
    const me = await newUser("x4-422");
    await seedFull(me.id, "自分");
    as(me);
    const before = await countAll(me.id);
    expect((await deleteAll()).status).toBe(422);
    expect((await deleteAll({})).status).toBe(422);
    expect((await deleteAll({ confirm: "さくじょ" })).status).toBe(422);
    expect((await deleteAll({ confirm: " 削除" })).status).toBe(422);
    expect(await countAll(me.id)).toEqual(before);
  });

  it("確認語「削除」で本人の全表が消える。他人の行・auth のユーザー・profiles は残る", async () => {
    const me = await newUser("x4-me");
    const other = await newUser("x4-other");
    await seedFull(me.id, "自分");
    await seedFull(other.id, "他人");
    const otherBefore = await countAll(other.id);
    as(me);

    const res = await deleteAll({ confirm: "削除" });
    expect(res.status).toBe(200);
    expect((await readJson(res)).data.deleted).toMatchObject({ transactions: 6, accounts: 1, categories: 1, receipts: 1 });
    expect(Object.values(await countAll(me.id)).every((n) => n === 0)).toBe(true);
    expect(await countAll(other.id)).toEqual(otherBefore);
    expect(await adminSql("SELECT id FROM auth.users WHERE id = $1", [me.id])).toHaveLength(1);
    expect(await adminSql("SELECT id FROM profiles WHERE id = $1", [me.id])).toHaveLength(1);
    // 共通カテゴリーは消えない
    expect(Number((await adminSql<{ n: string }>("SELECT count(*) AS n FROM categories WHERE user_id IS NULL"))[0].n)).toBeGreaterThan(0);
  });

  it("RLS: アプリのコードが userId の絞り込みを書き忘れても、他人の行は消せない", async () => {
    const me = await newUser("x4-rls-me");
    const other = await newUser("x4-rls-other");
    await seedFull(other.id, "他人");
    const before = await countAll(other.id);
    await withUserDb(me.id, async (db) => {
      await db.transaction.deleteMany({});
      await db.fixedCost.deleteMany({});
      await db.budgetRule.deleteMany({});
      await db.budgetFrame.deleteMany({});
      await db.csvImport.deleteMany({});
    });
    expect(await countAll(other.id)).toEqual(before);
    // ブラウザから anon キー＋自分のログインで直接消そうとしても消えない
    await me.client.from("transactions").delete().eq("user_id", other.id);
    await me.client.from("accounts").delete().eq("user_id", other.id);
    expect(await countAll(other.id)).toEqual(before);
  });
});

describe("X5 取り込みの取り消し", () => {
  const HEADER = "金額,日付,メモ,カテゴリー名";
  async function importCsv(lines: string[], scheduleAll = false) {
    const form = new FormData();
    form.append("file", new File([[HEADER, ...lines].join("\n") + "\n"], "export.csv", { type: "text/csv" }));
    form.append("mode", "commit");
    form.append("account_id", "new");
    if (scheduleAll) {
      // 予定の行を全部「定期にする」（preview で目印を取ってから）
      const pv = new FormData();
      pv.append("file", new File([[HEADER, ...lines].join("\n") + "\n"], "export.csv", { type: "text/csv" }));
      pv.append("mode", "preview");
      const p = await readJson(await importRoute.POST(new NextRequest("http://localhost:3000/api/v1/import", { method: "POST", body: pv })));
      form.append("schedule_keys", JSON.stringify(p.data.future.map((f: { key: string }) => f.key)));
    }
    const res = await importRoute.POST(new NextRequest("http://localhost:3000/api/v1/import", { method: "POST", body: form }));
    const body = await readJson(res);
    expect(res.status).toBe(200);
    return body.data as { import_id: string; imported_count: number };
  }
  const notes = async (userId: string) =>
    (await adminSql<{ note: string }>("SELECT note FROM transactions WHERE user_id = $1 ORDER BY note", [userId])).map((r) => r.note);

  it("その取り込みの取引だけ消え、他の取り込み・手入力・定期・新しく作ったカテゴリーは残る。履歴は「取り消し済み」", async () => {
    const me = await newUser("x5-me");
    as(me);
    const first = await importCsv(["-500,2026/09/03,一回目A,新しい費目", "-600,2026/09/04,一回目B,食費", "-80000,2099/12/25,家賃,住居"], true);
    const second = await importCsv(["-700,2026/09/05,二回目,食費"]);
    const account = (await adminSql<{ id: string }>("SELECT id FROM accounts WHERE user_id = $1", [me.id]))[0].id;
    await adminSql(
      "INSERT INTO transactions (user_id, account_id, amount, type, transaction_date, note, source) VALUES ($1, $2, 100, 'expense', '2026-09-06', '手入力', 'manual')",
      [me.id, account]
    );
    // 一回目の行を1件だけ画面で消していた（論理削除）
    await adminSql("UPDATE transactions SET deleted_at = now() WHERE user_id = $1 AND note = '一回目B'", [me.id]);
    const fixedBefore = await adminSql("SELECT id FROM fixed_costs WHERE user_id = $1", [me.id]);
    expect(fixedBefore).toHaveLength(1);

    const res = await undo(first.import_id);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toMatchObject({ import_id: first.import_id, deleted_count: 2 });
    expect(await notes(me.id)).toEqual(["二回目", "手入力"]);
    expect(await adminSql("SELECT id FROM fixed_costs WHERE user_id = $1", [me.id])).toHaveLength(1);
    expect(await adminSql("SELECT id FROM categories WHERE user_id = $1 AND name = '新しい費目'", [me.id])).toHaveLength(1);
    const hist = await readJson(await importRoute.GET());
    expect(hist.data.find((h: { id: string }) => h.id === first.import_id).status).toBe("undone");
    expect(hist.data.find((h: { id: string }) => h.id === second.import_id).status).toBe("success");
  });

  it("取り消した CSV はもう一度取り込める（行の目印も消えるので）。2回目の取り消しは 409", async () => {
    const me = await newUser("x5-again");
    as(me);
    const lines = ["-500,2026/09/03,パン,食費", "-300,2026/09/01,,日用品"];
    const first = await importCsv(lines);
    expect((await undo(first.import_id)).status).toBe(200);
    expect((await undo(first.import_id)).status).toBe(409);
    const again = await importCsv(lines);
    expect(again.imported_count).toBe(2);
  });

  it("他人の取り込み・無い id・形の違う id は 404 で、何も消えない", async () => {
    const other = await newUser("x5-other");
    as(other);
    const theirs = await importCsv(["-500,2026/09/03,他人の行,食費"]);
    const me = await newUser("x5-thief");
    as(me);
    expect((await undo(theirs.import_id)).status).toBe(404);
    expect((await undo("11111111-1111-4111-8111-111111111111")).status).toBe(404);
    expect((await undo("not-a-uuid")).status).toBe(404);
    expect(await notes(other.id)).toEqual(["他人の行"]);
    expect((await adminSql<{ status: string }>("SELECT status FROM csv_imports WHERE id = $1", [theirs.import_id]))[0].status).toBe("success");
  });
});

describe("X6 ログに中身を出さない", () => {
  it("書き出し・復元・全削除・取り消しの間、console にメモ・金額が出ない", async () => {
    const me = await newUser("x6-log");
    await seedFull(me.id, "ログに出ない秘密");
    as(me);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await getExport("kakebo-csv");
    const backup = await fullJson();
    await restore(backup); // 409（空でない）
    await deleteAll({ confirm: "削除" });
    await restore({ ...backup, data: { ...backup.data, accounts: [] } }); // 422
    await restore(backup);
    const printed = spies.flatMap((s) => s.mock.calls.flat()).map(String).join("\n");
    expect(printed).not.toContain("ログに出ない秘密");
    expect(printed).not.toContain("80000");
  });
});
