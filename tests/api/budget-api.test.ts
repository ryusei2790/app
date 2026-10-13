/**
 * @file tests/api/budget-api.test.ts
 * @description テスト一覧 M（費目の枠・対応表・集計）と S9・S12 の API・DB 層。
 *   GET  /api/v1/budget?month=YYYY-MM   … 今月の費目別・食費の1日目安・12か月の推移（初回に初期の枠と対応表を作る）
 *   PUT  /api/v1/budget/frames          … 枠の金額を直す
 *   GET/POST /api/v1/budget/rules       … 対応表の一覧・追加
 *   PUT/DELETE /api/v1/budget/rules/:id … 対応表の変更・削除
 * どれも社長（OWNER_USER_IDS）だけ。DB はローカル Supabase（RLS 有効）。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));

import { NextRequest } from "next/server";
import { signInAs } from "../helpers/auth-state";
import { getRequest, jsonRequest, params, readJson } from "../helpers/api";
import { adminSql, anonClient, closeAdminSql, createTestUser, seedAccount, type TestUser } from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import * as budget from "@/app/api/v1/budget/route";
import * as frames from "@/app/api/v1/budget/frames/route";
import * as rules from "@/app/api/v1/budget/rules/route";
import * as ruleOne from "@/app/api/v1/budget/rules/[id]/route";
import * as imp from "@/app/api/v1/import/route";

let A: TestUser; // 社長
let B: TestUser; // 一般
let aAccount: string;

const asA = () => signInAs({ id: A.id, email: A.email });
const asB = () => signInAs({ id: B.id, email: B.email });

beforeAll(async () => {
  A = await createTestUser("bg-owner");
  B = await createTestUser("bg-general");
  aAccount = await seedAccount(A.id);
});

afterEach(() => {
  signInAs(null);
});

afterAll(async () => {
  delete process.env.OWNER_USER_IDS;
  await adminSql("DELETE FROM transactions WHERE user_id = ANY($1::uuid[])", [[A.id, B.id]]);
  await prisma.$disconnect();
  await closeAdminSql();
});

async function getBudget(month: string) {
  const res = await budget.GET(getRequest(`/api/v1/budget?month=${month}`));
  return { status: res.status, body: await readJson(res) };
}

async function importCsv(text: string) {
  const form = new FormData();
  form.append("file", new File([text], "export.csv"));
  form.append("mode", "commit");
  form.append("account_id", aAccount);
  const res = await imp.POST(new NextRequest("http://localhost:3000/api/v1/import", { method: "POST", body: form }));
  expect(res.status).toBe(200);
}

const frameOf = (body: Awaited<ReturnType<typeof getBudget>>["body"], name: string) =>
  body.data.summary.frames.find((f: { name: string }) => f.name === name);

describe("M1 初期の枠と対応表", () => {
  it("初めて開くと8費目と対応表が作られ、2回開いても増えない", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asA();
    const first = await getBudget("2026-10");
    expect(first.status).toBe(200);
    expect(first.body.data.frames.map((f: { name: string }) => f.name)).toEqual([
      "食費", "サブスク", "日用品", "移動", "先取り貯蓄", "自己投資", "自由費", "予備",
    ]);
    const count = async () => ({
      frames: (await adminSql("SELECT 1 FROM budget_frames WHERE user_id = $1", [A.id])).length,
      rules: (await adminSql("SELECT 1 FROM budget_rules WHERE user_id = $1", [A.id])).length,
    });
    const c1 = await count();
    expect(c1.frames).toBe(8);
    expect(c1.rules).toBeGreaterThan(10);
    await getBudget("2026-10");
    expect(await count()).toEqual(c1);
  });
});

describe("M2〜M6 取り込んだ取引の集計", () => {
  it("CSV を取り込むと費目別に集計され、食費の1日目安が出る", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asA();
    await importCsv(
      [
        "金額,日付,メモ,カテゴリー名",
        "-12000,2026/09/03,,食費",
        "-245,2026/09/04,,お菓子",
        "-2440,2026/09/23,Spotify,その他",
        "-790,2026/09/24,,その他",
        "-6540,2026/09/10,,外食費",
        "-59590,2026/09/27,,家賃",
        "130000,2026/09/27,仕送り,その他",
      ].join("\n")
    );
    const { body } = await getBudget("2026-09");
    expect(frameOf(body, "食費").spent).toBe(12245);
    expect(frameOf(body, "サブスク").spent).toBe(2440);
    expect(frameOf(body, "自由費").spent).toBe(7330);
    expect(body.data.summary.outside).toBe(59590);
    expect(body.data.summary.income).toBe(130000);
    expect(body.data.summary.food).toMatchObject({ limit: 20000, target: 15000, spent: 12245 });
    // 推移は12か月、9月の合計に家賃・収入は入らない
    expect(body.data.trend).toHaveLength(12);
    expect(body.data.trend.at(-1)).toMatchObject({ month: "2026-09", total: 12245 + 2440 + 7330 });
  });
});

describe("M7 対応表を直すと過去の月も変わる", () => {
  it("外食費を自由費→食費に変えると9月の食費が増え、戻すと元に戻る", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asA();
    const list = await readJson(await rules.GET());
    const eatOut = list.data.rules.find((r: { category_name: string | null }) => r.category_name === "外食費");
    const food = list.data.frames.find((f: { name: string }) => f.name === "食費");
    const free = list.data.frames.find((f: { name: string }) => f.name === "自由費");

    const put = await ruleOne.PUT(jsonRequest("PUT", `/api/v1/budget/rules/${eatOut.id}`, { frame_id: food.id }), params(eatOut.id));
    expect(put.status).toBe(200);
    expect(frameOf((await getBudget("2026-09")).body, "食費").spent).toBe(12245 + 6540);

    await ruleOne.PUT(jsonRequest("PUT", `/api/v1/budget/rules/${eatOut.id}`, { frame_id: free.id }), params(eatOut.id));
    expect(frameOf((await getBudget("2026-09")).body, "食費").spent).toBe(12245);
  });

  it("メモの語句ルールを足す・消すと集計が変わる", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asA();
    const list = await readJson(await rules.GET());
    const invest = list.data.frames.find((f: { name: string }) => f.name === "自己投資");
    // 9/24 の「その他 790」はメモが無いので語句では動かない。外食費のカテゴリー全体ではなく、語句「Spotify」を自己投資に
    const created = await rules.POST(jsonRequest("POST", "/api/v1/budget/rules", { memo_keyword: "spotify", frame_id: invest.id, priority: -1 }));
    expect(created.status).toBe(201);
    const id = (await readJson(created)).data.id;
    expect(frameOf((await getBudget("2026-09")).body, "自己投資").spent).toBe(2440);
    expect((await ruleOne.DELETE(getRequest(`/api/v1/budget/rules/${id}`), params(id))).status).toBe(200);
    expect(frameOf((await getBudget("2026-09")).body, "自己投資").spent).toBe(0);
  });

  it("枠の金額を直せる（食費の上限を 25,000 に）", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asA();
    const { body } = await getBudget("2026-09");
    const food = body.data.frames.find((f: { name: string }) => f.name === "食費");
    const res = await frames.PUT(jsonRequest("PUT", "/api/v1/budget/frames", { frames: [{ id: food.id, monthly_limit: 25000, target: 15000 }] }));
    expect(res.status).toBe(200);
    expect(frameOf((await getBudget("2026-09")).body, "食費").limit).toBe(25000);
    await frames.PUT(jsonRequest("PUT", "/api/v1/budget/frames", { frames: [{ id: food.id, monthly_limit: 20000, target: 15000 }] }));
  });

  it("枠の金額は 0 以上の整数円だけ", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asA();
    const { body } = await getBudget("2026-09");
    const food = body.data.frames.find((f: { name: string }) => f.name === "食費");
    for (const bad of [-1, 1.5, "1000"]) {
      const res = await frames.PUT(jsonRequest("PUT", "/api/v1/budget/frames", { frames: [{ id: food.id, monthly_limit: bad }] }));
      expect(res.status).toBe(422);
    }
  });
});

describe("S12 予算の API は社長以外 401/403", () => {
  const calls = {
    "GET /budget": () => budget.GET(getRequest("/api/v1/budget?month=2026-10")),
    "PUT /budget/frames": () => frames.PUT(jsonRequest("PUT", "/api/v1/budget/frames", { frames: [] })),
    "GET /budget/rules": () => rules.GET(),
    "POST /budget/rules": () => rules.POST(jsonRequest("POST", "/api/v1/budget/rules", { memo_keyword: "x", frame_id: null })),
    "PUT /budget/rules/:id": () => ruleOne.PUT(jsonRequest("PUT", "/api/v1/budget/rules/x", { frame_id: null }), params("00000000-0000-0000-0000-000000000000")),
    "DELETE /budget/rules/:id": () => ruleOne.DELETE(getRequest("/api/v1/budget/rules/x"), params("00000000-0000-0000-0000-000000000000")),
  };

  it.each(Object.keys(calls))("%s: 未ログインは 401", async (name) => {
    process.env.OWNER_USER_IDS = A.id;
    expect((await calls[name as keyof typeof calls]()).status).toBe(401);
  });

  it.each(Object.keys(calls))("%s: 一般ユーザーは 403", async (name) => {
    process.env.OWNER_USER_IDS = A.id;
    asB();
    expect((await calls[name as keyof typeof calls]()).status).toBe(403);
  });
});

describe("S9 他人の枠・対応表は読めない・書けない", () => {
  let aFrame: string;
  let aRule: string;

  beforeAll(async () => {
    process.env.OWNER_USER_IDS = A.id;
    asA();
    await getBudget("2026-10"); // A の初期データ
    signInAs(null);
    aFrame = (await adminSql<{ id: string }>("SELECT id FROM budget_frames WHERE user_id = $1 LIMIT 1", [A.id]))[0].id;
    aRule = (await adminSql<{ id: string }>("SELECT id FROM budget_rules WHERE user_id = $1 LIMIT 1", [A.id]))[0].id;
  });

  it("B が A の枠・対応表を select しても 0 件", async () => {
    expect((await B.client.from("budget_frames").select("*").eq("id", aFrame)).data).toEqual([]);
    expect((await B.client.from("budget_rules").select("*").eq("id", aRule)).data).toEqual([]);
  });

  it("B が A の枠を書き換えようとしても変わらない", async () => {
    await B.client.from("budget_frames").update({ monthly_limit: 1 }).eq("id", aFrame);
    const [row] = await adminSql<{ monthly_limit: number }>("SELECT monthly_limit FROM budget_frames WHERE id = $1", [aFrame]);
    expect(row.monthly_limit).not.toBe(1);
  });

  it("B が A の枠を指す対応表を作ろうとすると拒否", async () => {
    const { error } = await B.client.from("budget_rules").insert({ user_id: B.id, memo_keyword: "x", frame_id: aFrame, priority: 0 });
    expect(error).not.toBeNull();
  });

  it("B が A のカテゴリーを指す対応表を作ろうとすると拒否", async () => {
    const [{ id: aCat }] = await adminSql<{ id: string }>("SELECT id FROM categories WHERE user_id = $1 LIMIT 1", [A.id]);
    const { error } = await B.client.from("budget_rules").insert({ user_id: B.id, category_id: aCat, frame_id: null, priority: 0 });
    expect(error).not.toBeNull();
  });

  it("A の名前で枠を作ろうとすると拒否", async () => {
    const { error } = await B.client.from("budget_frames").insert({ user_id: A.id, name: "乗っ取り", monthly_limit: 1, sort_order: 0 });
    expect(error).not.toBeNull();
  });

  it("未ログインは select もエラー", async () => {
    for (const t of ["budget_frames", "budget_rules"]) {
      expect((await anonClient().from(t).select("*").limit(1)).error).not.toBeNull();
    }
  });

  it("社長が API で他人の枠を指す対応表を作ると 404", async () => {
    process.env.OWNER_USER_IDS = `${A.id},${B.id}`;
    asB();
    await getBudget("2026-10"); // B の初期データ
    const res = await rules.POST(jsonRequest("POST", "/api/v1/budget/rules", { memo_keyword: "x", frame_id: aFrame }));
    expect(res.status).toBe(404);
    asA();
    const res2 = await ruleOne.PUT(jsonRequest("PUT", "/api/v1/budget/rules/x", { frame_id: null }), params(
      (await adminSql<{ id: string }>("SELECT id FROM budget_rules WHERE user_id = $1 LIMIT 1", [B.id]))[0].id
    ));
    expect(res2.status).toBe(404);
  });
});
