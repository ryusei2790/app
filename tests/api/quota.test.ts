/**
 * @file tests/api/quota.test.ts
 * @description テスト一覧 E（使いすぎ対策 L1〜L6）。1人 月30枚・1日5枚、アプリ全体 月3,000枚。
 * 回数の数え方（lib/quota.ts）をローカル Supabase で確かめる。レシート API の 429 は D（receipts-api.test.ts）で見る。
 *
 * 「いま」を引数で渡して日・月の切り替え（JST）を確かめる。全体の件数は全員で共有なので、
 * テストごとに離れた年月（2030年〜）を使い、他のテストや実際の利用と混ざらないようにする。
 */

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));

import { signInAs } from "../helpers/auth-state";
import { getRequest, readJson } from "../helpers/api";
import { adminSql, closeAdminSql, createTestUser, type TestUser } from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import { finishReceiptParse, getReceiptUsage, reserveReceiptParse } from "@/lib/quota";
import * as usage from "@/app/api/v1/usage/route";

const users: TestUser[] = [];
async function newUser(label: string) {
  const u = await createTestUser(label);
  users.push(u);
  return u;
}

afterEach(() => {
  signInAs(null);
  delete process.env.OWNER_USER_IDS;
});

afterAll(async () => {
  await adminSql("DELETE FROM receipt_parse_logs WHERE user_id = ANY($1::uuid[])", [users.map((u) => u.id)]);
  await prisma.$disconnect();
  await closeAdminSql();
});

/** JST の "YYYY-MM-DD HH:mm" → Date */
const jst = (s: string) => new Date(`${s.replace(" ", "T")}:00+09:00`);

/** 予約して、そのまま成功で閉じる（＝1枚読んだ） */
async function readOne(u: TestUser, now: Date) {
  const r = await reserveReceiptParse({ id: u.id, email: u.email }, { now });
  if (r.ok) await finishReceiptParse(r.logId, u.id, "succeeded");
  return r;
}

describe("L1 1日5枚まで。6枚目は日本語のメッセージで断る", () => {
  it("5枚目まで成功、同じ日の6枚目は user_day で拒否", async () => {
    const u = await newUser("l1");
    for (let i = 0; i < 5; i++) expect((await readOne(u, jst(`2030-01-10 1${i}:00`))).ok).toBe(true);
    const sixth = await readOne(u, jst("2030-01-10 20:00"));
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.reason).toBe("user_day");
      expect(sixth.message).toMatch(/今日.*上限.*5枚/);
    }
  });

  it("GET /api/v1/usage で今日・今月の使った枚数と上限が分かる", async () => {
    const u = await newUser("l1u");
    signInAs({ id: u.id, email: u.email });
    await readOne(u, new Date());
    const res = await usage.GET(getRequest("/api/v1/usage"));
    expect(res.status).toBe(200);
    const { data } = await readJson(res);
    expect(data.day).toEqual({ used: 1, limit: 5, remaining: 4 });
    expect(data.month).toMatchObject({ used: 1, limit: 30, remaining: 29 });
    expect(data.available).toBe(true);
  });

  it("usage は未ログインなら 401", async () => {
    expect((await usage.GET(getRequest("/api/v1/usage"))).status).toBe(401);
  });
});

describe("L2 日の切り替えは JST 0:00", () => {
  it("23:59 は同じ日、0:00 から新しい日", async () => {
    const u = await newUser("l2");
    for (let i = 0; i < 5; i++) await readOne(u, jst(`2030-02-10 0${i}:00`));
    expect((await readOne(u, jst("2030-02-10 23:59"))).ok).toBe(false);
    expect((await readOne(u, jst("2030-02-11 00:00"))).ok).toBe(true);
  });
});

describe("L3 月30枚。翌月1日（JST）にリセット", () => {
  it("30枚使った月の末日は拒否、翌月1日 0:00 は成功", async () => {
    const u = await newUser("l3");
    await adminSql(
      `INSERT INTO receipt_parse_logs (user_id, status, created_at)
       SELECT $1, 'succeeded', timestamptz '2030-03-01 10:00+09' + (g / 5) * interval '1 day'
         FROM generate_series(0, 29) g`,
      [u.id]
    );
    const r = await readOne(u, jst("2030-03-31 23:00"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("user_month");
      expect(r.message).toMatch(/今月.*上限.*30枚/);
    }
    expect((await readOne(u, jst("2030-04-01 00:00"))).ok).toBe(true);
  });
});

describe("L4 アプリ全体で月3,000枚。社長アカウントは対象外", () => {
  it("全体が3,000枚に達したら一般ユーザーは止まり、社長は使える", async () => {
    const filler = await newUser("l4-filler");
    await adminSql(
      `INSERT INTO receipt_parse_logs (user_id, status, created_at)
       SELECT $1, 'succeeded', timestamptz '2031-01-05 10:00+09' FROM generate_series(1, 3000)`,
      [filler.id]
    );
    const normal = await newUser("l4-normal");
    const owner = await newUser("l4-owner");
    process.env.OWNER_USER_IDS = owner.id;

    const r = await readOne(normal, jst("2031-01-20 12:00"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("global_month");
      expect(r.message).toMatch(/手入力/);
    }
    expect((await readOne(owner, jst("2031-01-20 12:00"))).ok).toBe(true);
  });

  it("社長が読んだ分は全体の枚数に数えない", async () => {
    const filler = await newUser("l4b-filler");
    await adminSql(
      `INSERT INTO receipt_parse_logs (user_id, status, created_at)
       SELECT $1, 'succeeded', timestamptz '2031-02-05 10:00+09' FROM generate_series(1, 2999)`,
      [filler.id]
    );
    const owner = await newUser("l4b-owner");
    process.env.OWNER_USER_IDS = owner.id;
    expect((await readOne(owner, jst("2031-02-06 12:00"))).ok).toBe(true);
    delete process.env.OWNER_USER_IDS;
    const normal = await newUser("l4b-normal");
    // 社長の1枚を数えていなければ、まだ 2,999 枚なので一般ユーザーも1枚読める
    expect((await readOne(normal, jst("2031-02-06 12:00"))).ok).toBe(true);
    expect((await readOne(normal, jst("2031-02-06 12:01"))).ok).toBe(false);
  });
});

describe("L5 同時に10リクエストでも上限を超えない", () => {
  it("同じ人が同時に10回予約しても通るのは5回だけ", async () => {
    const u = await newUser("l5");
    const now = jst("2030-05-10 12:00");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveReceiptParse({ id: u.id, email: u.email }, { now }))
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const rows = await adminSql("SELECT 1 FROM receipt_parse_logs WHERE user_id=$1", [u.id]);
    expect(rows).toHaveLength(5);
  });
});

describe("L6 AI の失敗・取り消しは枚数に数えない", () => {
  it("失敗・取り消しを何度しても、成功5枚までは読める", async () => {
    const u = await newUser("l6");
    const me = { id: u.id, email: u.email };
    const now = jst("2030-06-10 12:00");
    for (let i = 0; i < 3; i++) {
      const r = await reserveReceiptParse(me, { now });
      expect(r.ok).toBe(true);
      if (r.ok) await finishReceiptParse(r.logId, u.id, i === 0 ? "cancelled" : "failed");
    }
    for (let i = 0; i < 5; i++) expect((await readOne(u, now)).ok).toBe(true);
    expect((await readOne(u, now)).ok).toBe(false);
    const day = await getReceiptUsage(me, { now });
    expect(day.day.used).toBe(5);
  });

  it("予約したまま5分以上たったもの（途中で落ちた等）は数えない", async () => {
    const u = await newUser("l6s");
    await adminSql(
      `INSERT INTO receipt_parse_logs (user_id, status, created_at)
       SELECT $1, 'reserved', timestamptz '2030-07-10 09:00+09' FROM generate_series(1, 5)`,
      [u.id]
    );
    expect((await readOne(u, jst("2030-07-10 09:10"))).ok).toBe(true);
  });

  it("他人の予約は閉じられない（user_id が違えば何もしない）", async () => {
    const a = await newUser("l6a");
    const b = await newUser("l6b");
    const r = await reserveReceiptParse({ id: a.id, email: a.email }, { now: jst("2030-08-10 12:00") });
    expect(r.ok).toBe(true);
    if (r.ok) await finishReceiptParse(r.logId, b.id, "failed");
    const rows = await adminSql<{ status: string }>("SELECT status FROM receipt_parse_logs WHERE user_id=$1", [a.id]);
    expect(rows[0].status).toBe("reserved");
  });
});

describe("記録の守り（S5 と同じ考え方）", () => {
  it("利用者は自分の記録を読めるが、書き換え・追加・回数の関数は使えない", async () => {
    const u = await newUser("l-sec");
    const other = await newUser("l-sec-other");
    await readOne(u, jst("2030-09-10 12:00"));
    await readOne(other, jst("2030-09-10 12:00"));

    const mine = await u.client.from("receipt_parse_logs").select("user_id");
    expect(mine.error).toBeNull();
    expect(mine.data!.every((r) => r.user_id === u.id)).toBe(true);
    expect(mine.data).toHaveLength(1);

    const ins = await u.client.from("receipt_parse_logs").insert({ user_id: u.id, status: "failed" });
    expect(ins.error).not.toBeNull();
    const upd = await u.client.from("receipt_parse_logs").update({ status: "failed" }).eq("user_id", u.id).select();
    expect(upd.data ?? []).toHaveLength(0);
    const rpc = await u.client.rpc("reserve_receipt_parse", {
      p_user: u.id, p_user_month: 9999, p_user_day: 9999, p_global_month: 99999, p_exempt_global: true,
    });
    expect(rpc.error).not.toBeNull();
  });
});
