/**
 * @file tests/api/mcp-api.test.ts
 * @description /api/mcp（利用者の AI エージェントの窓口、mywork#882）の結合テスト。
 * 偽物を使わない: ローカル Supabase の OAuth サーバーが発行した本物のトークンで、
 * 公式 MCP SDK のクライアントから route handler を（HTTP サーバー無しで）呼ぶ。DB も本物（RLS 有効）。
 *
 * 確かめること:
 *   M1 トークン無し → 401 と案内（WWW-Authenticate の resource_metadata）
 *   M2 画面のログインのトークン（client_id 無し）・でたらめ → 401
 *   M3 道具は7つ。書く道具は2つだけ（編集・削除は無い）
 *   M4 支出の追加 → DB に source='api' で1件、集計・一覧に出る
 *   M5 取り消しは AI が足した直前の1件だけ（画面で入れた取引・他人の取引・古いものは消せない）
 *   M6 他人のデータは見えない（B のトークンで A の取引は出ない）
 *   M7 カテゴリが1つに決まらなければ書かずに候補を返す
 *   M8 1分60回の上限
 *   M9 接続を解除したトークンはすぐ 401
 *   M10 呼び出し記録（mcp_calls）は道具名・成否だけで、金額やメモは残さない
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as mcpRoute from "@/app/api/mcp/route";
import { prisma } from "@/lib/prisma";
import { todayJst } from "@/lib/date/jst";
import { adminSql, closeAdminSql, createTestUser, seedAccount, seedTransaction, type TestUser } from "../helpers/local-supabase";
import { obtainOAuthToken } from "../helpers/oauth";

const MCP_URL = "http://localhost:3000/api/mcp";
const apiUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;

/** route handler を fetch の代わりに呼ぶ（SDK のクライアントはこれを通して HTTP をしゃべる） */
async function routeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  switch (req.method) {
    case "POST":
      return mcpRoute.POST(req);
    case "GET":
      return mcpRoute.GET(req);
    case "DELETE":
      return mcpRoute.DELETE(req);
    default:
      return mcpRoute.OPTIONS();
  }
}

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "vitest", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: routeFetch,
  });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as CallToolResult & { structuredContent?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

let A: TestUser;
let B: TestUser;
let tokenA: string;
let tokenB: string;
let clientIdA: string;
let a: Client;
let b: Client;
let aManualTx: string;

beforeAll(async () => {
  A = await createTestUser("mcp-a");
  B = await createTestUser("mcp-b");
  const accA = await seedAccount(A.id, "Aの財布");
  aManualTx = await seedTransaction(A.id, accA, { amount: 3333, date: todayJst() });
  const tA = await obtainOAuthToken(apiUrl(), A.client, "Claude（テスト）");
  const tB = await obtainOAuthToken(apiUrl(), B.client, "ChatGPT（テスト）");
  tokenA = tA.access_token;
  clientIdA = tA.clientId;
  tokenB = tB.access_token;
  a = await connect(tokenA);
  b = await connect(tokenB);
});

afterAll(async () => {
  await a?.close();
  await b?.close();
  await closeAdminSql();
  await prisma.$disconnect();
});

describe("M1・M2 認証", () => {
  it("M1 トークン無しは 401 と案内の URL", async () => {
    const res = await mcpRoute.POST(new Request(MCP_URL, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"');
  });

  it("M2 画面のログインのトークン（client_id 無し）は 401（AI の窓口は OAuth の同意を経たものだけ）", async () => {
    const { data } = await A.client.auth.getSession();
    const res = await mcpRoute.POST(
      new Request(MCP_URL, { method: "POST", headers: { authorization: `Bearer ${data.session!.access_token}`, "content-type": "application/json" }, body: "{}" })
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("M2 でたらめ・署名の違うトークンは 401", async () => {
    const [h, p] = tokenA.split(".");
    for (const bad of ["abc", `${h}.${p}.forged-signature`]) {
      const res = await mcpRoute.POST(
        new Request(MCP_URL, { method: "POST", headers: { authorization: `Bearer ${bad}`, "content-type": "application/json" }, body: "{}" })
      );
      expect(res.status).toBe(401);
    }
  });
});

describe("M3 道具の一覧", () => {
  it("7つで、書く道具は add_expense と undo_last_added だけ", async () => {
    const { tools } = await a.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["add_expense", "category_summary", "list_categories", "list_fixed_costs", "list_recent", "monthly_summary", "undo_last_added"].sort()
    );
    const writes = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name).sort();
    expect(writes).toEqual(["add_expense", "undo_last_added"]);
  });
});

describe("M4〜M7 支出の追加・取り消し・分離", () => {
  it("M4 追加すると source='api' の1件になり、集計と一覧に出る", async () => {
    const r = await call(a, "add_expense", { amount: 850, category: "外食", note: "昼ごはん" });
    expect(r.isError).toBeFalsy();
    const id = r.structuredContent.id as string;
    const rows = await adminSql<{ user_id: string; source: string; amount: string; note: string; type: string }>(
      "SELECT user_id, source, amount, note, type FROM transactions WHERE id = $1",
      [id]
    );
    expect(rows[0]).toMatchObject({ user_id: A.id, source: "api", note: "昼ごはん", type: "expense" });
    expect(Number(rows[0].amount)).toBe(850);

    const sum = await call(a, "monthly_summary", {});
    // 画面で入れた 3333 円＋AI の 850 円（同じ定義で数える）
    expect(sum.structuredContent.expense.total).toBe(3333 + 850);
    expect(sum.structuredContent.by_category.find((c: { name: string }) => c.name === "外食").amount).toBe(850);

    const recent = await call(a, "list_recent", { limit: 5 });
    expect(recent.structuredContent.items.map((t: { id: string }) => t.id)).toContain(id);
  });

  it("M5 取り消しは AI が足した直前の1件だけ。画面で入れた取引は残る", async () => {
    const first = await call(a, "add_expense", { amount: 100, category: "日用品" });
    const second = await call(a, "add_expense", { amount: 200, category: "日用品" });
    // 直前ではない id を指定 → 消さない
    const wrong = await call(a, "undo_last_added", { id: first.structuredContent.id });
    expect(wrong.isError).toBe(true);
    // 直前の1件
    const ok = await call(a, "undo_last_added", { id: second.structuredContent.id });
    expect(ok.isError).toBeFalsy();
    const rows = await adminSql<{ id: string; deleted_at: Date | null }>(
      "SELECT id, deleted_at FROM transactions WHERE id = ANY($1::uuid[])",
      [[first.structuredContent.id, second.structuredContent.id, aManualTx]]
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.deleted_at]));
    expect(byId[second.structuredContent.id]).not.toBeNull();
    expect(byId[first.structuredContent.id]).toBeNull();
    expect(byId[aManualTx]).toBeNull();
  });

  it("M5 24時間より前に AI が足したものは取り消せない", async () => {
    const r = await call(b, "add_expense", { amount: 500 });
    await adminSql("UPDATE transactions SET created_at = now() - interval '25 hours' WHERE id = $1", [r.structuredContent.id]);
    const u = await call(b, "undo_last_added", {});
    expect(u.isError).toBe(true);
    const rows = await adminSql<{ deleted_at: Date | null }>("SELECT deleted_at FROM transactions WHERE id = $1", [r.structuredContent.id]);
    expect(rows[0].deleted_at).toBeNull();
  });

  it("M6 B のトークンでは A の取引は見えず、A の記録も取り消せない", async () => {
    const r = await call(a, "add_expense", { amount: 777, note: "Aだけの記録" });
    const recent = await call(b, "list_recent", { limit: 200 });
    expect(JSON.stringify(recent.structuredContent)).not.toContain("Aだけの記録");
    expect(r.isError).toBeFalsy();
  });

  it("M6 B の集計は B の分だけ（A の金額が混ざらない）", async () => {
    const sum = await call(b, "monthly_summary", {});
    // B の分は M5 の 500 円の1件だけ（作成日を古くしただけで、取引日は今日）
    expect(sum.structuredContent.expense.total).toBe(500);
    const u = await call(b, "undo_last_added", {});
    expect(u.isError).toBe(true); // B に取り消せるものは無い（A の直前の1件は B からは見えない）
  });

  it("M7 カテゴリが1つに決まらなければ書かずに候補を返す", async () => {
    const before = await adminSql<{ n: string }>("SELECT count(*) AS n FROM transactions WHERE user_id = $1", [A.id]);
    const r = await call(a, "add_expense", { amount: 300, category: "食" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("食費");
    expect(text(r)).toContain("外食");
    const after = await adminSql<{ n: string }>("SELECT count(*) AS n FROM transactions WHERE user_id = $1", [A.id]);
    expect(after[0].n).toBe(before[0].n);
  });

  it("M7 入力の検証（0円・小数・存在しない日付）は書かない", async () => {
    for (const args of [{ amount: 0 }, { amount: 1.5 }, { amount: 100, date: "2026-02-30" }]) {
      const r = await call(a, "add_expense", args);
      expect(r.isError).toBe(true);
    }
  });

  it("口座が1つも無い人は「現金」を作ってそこに入れる", async () => {
    const r = await call(b, "add_expense", { amount: 120 });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.account).toBe("現金");
    // M5 で B が初めて記録したときに作った1つだけ（呼ぶたびに増えない）
    const accs = await adminSql<{ name: string }>("SELECT name FROM accounts WHERE user_id = $1", [B.id]);
    expect(accs.map((x) => x.name)).toEqual(["現金"]);
  });
});

describe("M8〜M10 上限・解除・記録", () => {
  it("M10 記録は道具名・成否だけ（金額やメモの列は無い）で、A の client_id で残る", async () => {
    const rows = await adminSql<Record<string, unknown>>("SELECT * FROM mcp_calls WHERE user_id = $1 ORDER BY created_at", [A.id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]).sort()).toEqual(["client_id", "created_at", "id", "is_write", "ok", "tool", "user_id"]);
    expect(rows.every((r) => r.client_id === clientIdA)).toBe(true);
    expect(rows.some((r) => r.tool === "add_expense" && r.is_write === true)).toBe(true);
  });

  it("M8 1分に60回を超えると実行しない", async () => {
    const C = await createTestUser("mcp-c");
    const t = await obtainOAuthToken(apiUrl(), C.client);
    await adminSql(
      "INSERT INTO mcp_calls (user_id, client_id, tool) SELECT $1, $2, 'list_categories' FROM generate_series(1, 60)",
      [C.id, t.clientId]
    );
    const c = await connect(t.access_token);
    const r = await call(c, "add_expense", { amount: 100 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("1分に60回");
    const rows = await adminSql<{ n: string }>("SELECT count(*) AS n FROM transactions WHERE user_id = $1", [C.id]);
    expect(Number(rows[0].n)).toBe(0);
    await c.close();
  });

  it("M9 本人が接続を解除したら、そのトークンはすぐ 401", async () => {
    const D = await createTestUser("mcp-d");
    const t = await obtainOAuthToken(apiUrl(), D.client);
    const d = await connect(t.access_token);
    expect((await call(d, "list_categories")).isError).toBeFalsy();
    const { error } = await D.client.auth.oauth.revokeGrant({ clientId: t.clientId });
    expect(error).toBeNull();
    const res = await mcpRoute.POST(
      new Request(MCP_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${t.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    );
    expect(res.status).toBe(401);
    await d.close();
  });
});
