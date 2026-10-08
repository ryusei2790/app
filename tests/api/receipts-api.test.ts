/**
 * @file tests/api/receipts-api.test.ts
 * @description テスト一覧 D（レシート P4〜P9）と S7・L1（429）・L6 の API 層。
 * AI 提供元は偽物（helpers/fake-receipt-provider.ts）に差し替え、DB は本物のローカル Supabase を使う。
 *   POST /api/v1/receipts/parse … 画像 → 下書き（保存しない）
 *   POST /api/v1/receipts       … 利用者が確認・修正した内容を取引＋レシート情報として保存
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));
vi.mock("@/lib/receipt/providers", () => import("../helpers/fake-receipt-provider"));

import sharp from "sharp";
import { NextRequest } from "next/server";
import normal from "../fixtures/receipts/normal.json";
import { signInAs } from "../helpers/auth-state";
import { jsonRequest, readJson } from "../helpers/api";
import { fakeReceipt } from "../helpers/fake-receipt-provider";
import {
  adminSql,
  closeAdminSql,
  commonCategoryId,
  createTestUser,
  seedAccount,
  type TestUser,
} from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import * as parse from "@/app/api/v1/receipts/parse/route";
import * as receipts from "@/app/api/v1/receipts/route";

let A: TestUser;
let B: TestUser;
let aAccount: string;
let bAccount: string;
let jpeg: Buffer;

beforeAll(async () => {
  A = await createTestUser("rc-a");
  B = await createTestUser("rc-b");
  aAccount = await seedAccount(A.id);
  bAccount = await seedAccount(B.id);
  // 画像の中身に目印の文字列を埋め込み、どこかに残っていないかを後で探す（P5）
  jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fafafa" } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { ImageDescription: "SECRET-RECEIPT-MARKER" } } })
    .toBuffer();
});

beforeEach(() => {
  fakeReceipt.next = { kind: "text", text: JSON.stringify(normal) };
  fakeReceipt.calls = [];
});

afterEach(() => signInAs(null));

afterAll(async () => {
  await adminSql("DELETE FROM receipt_parse_logs WHERE user_id = ANY($1::uuid[])", [[A.id, B.id]]);
  await prisma.$disconnect();
  await closeAdminSql();
});

const asA = () => signInAs({ id: A.id, email: A.email });

function parseRequest(bytes: Uint8Array | Buffer, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("image", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "r.jpg");
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return new NextRequest("http://localhost:3000/api/v1/receipts/parse", { method: "POST", body: form });
}

async function logs(userId: string) {
  return adminSql<{ status: string }>("SELECT status FROM receipt_parse_logs WHERE user_id=$1 ORDER BY created_at", [userId]);
}

async function txCount(userId: string) {
  const r = await adminSql<{ n: string }>("SELECT count(*) AS n FROM transactions WHERE user_id=$1", [userId]);
  return Number(r[0].n);
}

describe("未ログイン", () => {
  it("parse・保存とも 401", async () => {
    expect((await parse.POST(parseRequest(jpeg))).status).toBe(401);
    expect((await receipts.POST(jsonRequest("POST", "/x", {}))).status).toBe(401);
  });
});

describe("P1・P8 読み取りは下書きを返すだけで、保存しない", () => {
  it("parse は下書きを返し、取引は増えない。1枚として数える", async () => {
    asA();
    const before = await txCount(A.id);
    const res = await parse.POST(parseRequest(jpeg));
    expect(res.status).toBe(200);
    const { data } = await readJson(res);
    expect(data.draft).toMatchObject({ status: "ok", total: 598, merchant: "ファミリーマート 青山店" });
    expect(data.usage.day.used).toBeGreaterThanOrEqual(1);
    expect(await txCount(A.id)).toBe(before);
    expect((await logs(A.id)).at(-1)!.status).toBe("succeeded");
  });

  it("保存すると、利用者が直した値で取引（source=receipt）とレシート情報が1つずつできる", async () => {
    asA();
    const category = await commonCategoryId("expense");
    const res = await receipts.POST(jsonRequest("POST", "/api/v1/receipts", {
      account_id: aAccount,
      category_id: category,
      transaction_date: "2026-10-07",
      total: 600, // AI は 598 と読んだが、利用者が 600 に直した
      merchant: "ファミマ",
      items: normal.items,
    }));
    expect(res.status).toBe(201);
    const { data } = await readJson(res);
    const tx = await adminSql<{ amount: string; source: string; type: string; note: string; user_id: string }>(
      "SELECT amount, source, type, note, user_id FROM transactions WHERE id=$1", [data.transaction.id]
    );
    expect(tx[0]).toMatchObject({ source: "receipt", type: "expense", note: "ファミマ", user_id: A.id });
    expect(Number(tx[0].amount)).toBe(600);
    const rc = await adminSql<{ merchant: string; total: string; items: unknown[] }>(
      "SELECT merchant, total, items FROM receipts WHERE transaction_id=$1", [data.transaction.id]
    );
    expect(rc).toHaveLength(1);
    expect(rc[0].merchant).toBe("ファミマ");
    expect(rc[0].items).toHaveLength(3);
  });

  it.each([
    ["金額が0", { total: 0 }],
    ["日付が不正", { transaction_date: "2026-13-01" }],
    ["明細が配列でない", { items: "x" }],
    ["明細の金額が小数", { items: [{ name: "a", quantity: 1, amount: 1.5 }] }],
  ])("保存の入力チェック: %s は 422", async (_l, patch) => {
    asA();
    const res = await receipts.POST(jsonRequest("POST", "/x", {
      account_id: aAccount, transaction_date: "2026-10-07", total: 100, merchant: "x", items: [], ...patch,
    }));
    expect(res.status).toBe(422);
  });
});

describe("S7 他人の user_id・口座を body で渡しても無視・拒否", () => {
  it("parse の body に user_id=B を付けても、A の枚数として数える", async () => {
    asA();
    const bBefore = (await logs(B.id)).length;
    const res = await parse.POST(parseRequest(jpeg, { user_id: B.id }));
    expect(res.status).toBe(200);
    expect((await logs(B.id)).length).toBe(bBefore);
  });

  it("保存の body に user_id=B を付けても A の取引になる", async () => {
    asA();
    const res = await receipts.POST(jsonRequest("POST", "/x", {
      user_id: B.id, account_id: aAccount, transaction_date: "2026-10-07", total: 100, merchant: "x", items: [],
    }));
    const { data } = await readJson(res);
    const tx = await adminSql<{ user_id: string }>("SELECT user_id FROM transactions WHERE id=$1", [data.transaction.id]);
    expect(tx[0].user_id).toBe(A.id);
  });

  it("B の口座を指定した保存は 404", async () => {
    asA();
    const res = await receipts.POST(jsonRequest("POST", "/x", {
      account_id: bAccount, transaction_date: "2026-10-07", total: 100, merchant: "x", items: [],
    }));
    expect(res.status).toBe(404);
  });
});

describe("P4 画像の検査は回数を消費する前に行う", () => {
  it.each([
    ["画像以外", () => new TextEncoder().encode("not an image"), 415],
    ["壊れた JPEG", () => jpeg.subarray(0, jpeg.length - 10), 422],
    ["2MB 超", () => { const b = new Uint8Array(2 * 1024 * 1024 + 1); b.set([0xff, 0xd8, 0xff]); return b; }, 413],
  ] as const)("%s は %d で、AI も呼ばず、枚数も増えない", async (_l, make, status) => {
    asA();
    const before = (await logs(A.id)).length;
    const res = await parse.POST(parseRequest(make()));
    expect(res.status).toBe(status);
    expect(fakeReceipt.calls).toHaveLength(0);
    expect((await logs(A.id)).length).toBe(before);
  });

  it("image が無ければ 422", async () => {
    asA();
    const form = new FormData();
    const res = await parse.POST(new NextRequest("http://localhost:3000/x", { method: "POST", body: form }));
    expect(res.status).toBe(422);
  });
});

describe("P5 画像をどこにも残さない", () => {
  it("読み取り後、DB・ストレージ・ログに画像や base64 が残らない", async () => {
    asA();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    const storageBefore = await adminSql<{ n: string }>("SELECT count(*) AS n FROM storage.objects");
    const res = await parse.POST(parseRequest(jpeg));
    expect(res.status).toBe(200);

    const b64 = jpeg.toString("base64");
    const needles = ["SECRET-RECEIPT-MARKER", b64.slice(0, 40), b64.slice(-40)];
    // DB: 自分の行を文字列にして探す
    const dump = JSON.stringify([
      await adminSql("SELECT * FROM receipt_parse_logs WHERE user_id=$1", [A.id]),
      await adminSql("SELECT * FROM receipts WHERE user_id=$1", [A.id]),
      await adminSql("SELECT * FROM transactions WHERE user_id=$1", [A.id]),
    ]);
    for (const n of needles) expect(dump).not.toContain(n);
    // ストレージ: 増えていない
    const storageAfter = await adminSql<{ n: string }>("SELECT count(*) AS n FROM storage.objects");
    expect(storageAfter[0].n).toBe(storageBefore[0].n);
    // ログ: console に画像の中身が出ていない
    const printed = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const n of needles) expect(printed).not.toContain(n);
    // 応答にも画像を返さない
    expect(JSON.stringify(await readJson(res))).not.toContain(b64.slice(0, 40));
    spies.forEach((s) => s.mockRestore());
  });
});

describe("P6 AI の失敗では手入力へ案内し、回数を消費しない", () => {
  it("提供元のエラーは 503 と日本語の案内。記録は failed（数えない）", async () => {
    const u = await createTestUser("rc-p6");
    signInAs({ id: u.id, email: u.email });
    fakeReceipt.next = { kind: "error" };
    const res = await parse.POST(parseRequest(jpeg));
    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect(body.error!.message).toMatch(/手入力/);
    expect((await logs(u.id)).map((l) => l.status)).toEqual(["failed"]);
  });

  it("AI が対象外（外貨）と返しても 200 で status=unsupported", async () => {
    asA();
    fakeReceipt.next = { kind: "text", text: JSON.stringify({ ...normal, currency: "USD" }) };
    const { data } = await readJson(await parse.POST(parseRequest(jpeg)));
    expect(data.draft.status).toBe("unsupported");
    expect(data.draft.warnings[0].message).toMatch(/対象外|日本円/);
  });
});

describe("P9 AI に個人情報を渡さない", () => {
  it("提供元に渡るのは画像・形式・指示文だけで、ユーザー ID・メールを含まない", async () => {
    asA();
    await parse.POST(parseRequest(jpeg));
    expect(fakeReceipt.calls).toHaveLength(1);
    const call = fakeReceipt.calls[0];
    expect(Object.keys(call).sort()).toEqual(["image", "mediaType", "prompt"]);
    expect(call.prompt).not.toContain(A.id);
    expect(call.prompt).not.toContain(A.email);
  });
});

describe("L1 上限を超えたら 429 と日本語の理由", () => {
  it("同じ日の6枚目は 429。AI は呼ばない", async () => {
    const u = await createTestUser("rc-l1");
    signInAs({ id: u.id, email: u.email });
    for (let i = 0; i < 5; i++) expect((await parse.POST(parseRequest(jpeg))).status).toBe(200);
    fakeReceipt.calls = [];
    const res = await parse.POST(parseRequest(jpeg));
    expect(res.status).toBe(429);
    expect((await readJson(res)).error!.message).toMatch(/今日.*上限/);
    expect(fakeReceipt.calls).toHaveLength(0);
  });
});
