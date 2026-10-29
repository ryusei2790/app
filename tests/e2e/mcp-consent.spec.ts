/**
 * @file tests/e2e/mcp-consent.spec.ts
 * @description AI 接続（mywork#882）の画面の流れ（スマホ幅 375px、ローカルの Supabase だけ・データは作り物）。
 *   MC1 AI が認可を始める → 未ログインならログイン画面 → ログイン後に同意画面へ戻る → 接続先と「できること」が出る
 *       →「許可する」→ AI の戻り先にコードが渡る → トークンで /api/mcp の add_expense が動き、source='api' で入る
 *   MC2「許可しない」→ AI の戻り先に access_denied
 *   MC3 設定 →「AI との接続」に許可した AI が出る →「解除」→ そのトークンは 401
 *
 * Supabase は同意画面の場所を site_url（http://127.0.0.1:3000）＋/oauth/consent にしているので、
 * 認可の開始（/oauth/authorize の 302）は Node 側で行い、返ってきた同意画面の URL をこのテストのサーバー（localhost:3100）に付け替えて開く
 * （Playwright はリダイレクトの先を横取りできないため）。AI の戻り先（127.0.0.1:9）へのリクエストは URL だけ記録する。
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createUser, localSupabase } from "./helpers";
import { exchangeCode, pkce, registerClient, startAuthorization, TEST_REDIRECT_URI, type OAuthClient, type Pkce } from "../helpers/oauth";

const SITE = "http://127.0.0.1:3000";
const BASE = "http://localhost:3100";

/** AI の戻り先へのリクエストの URL を記録する（リダイレクトで行く場合も page.on("request") には出る） */
async function wire(page: Page) {
  const captured: string[] = [];
  const origin = new URL(TEST_REDIRECT_URI).origin;
  page.on("request", (req) => {
    if (req.url().startsWith(origin)) captured.push(req.url());
  });
  await page.route(`${origin}/**`, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "AI のアプリに戻りました（テスト）" }));
  return captured;
}

/** AI が認可を始めたときに Supabase が送る同意画面の URL（このテストのサーバーに付け替え） */
async function consentUrl(apiUrl: string, client: OAuthClient, p: Pkce) {
  const url = await startAuthorization(apiUrl, client, p, "e2e");
  expect(url.startsWith(`${SITE}/oauth/consent?authorization_id=`)).toBe(true);
  return url.replace(SITE, BASE);
}

async function mcpClient(token: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

test("MC1 ログイン → 同意画面 → 許可 → AI から支出を記録できる", async ({ page }) => {
  const sb = localSupabase();
  const user = await createUser("mc1");
  const client = await registerClient(sb.apiUrl, "E2E の AI");
  const p = pkce();
  const captured = await wire(page);

  // 1. AI がブラウザで認可を始める（未ログイン → ログイン画面。戻り先に同意画面が付いている）
  await page.goto(await consentUrl(sb.apiUrl, client, p));
  await page.waitForURL(/\/login\?next=/);
  await page.getByLabel("メールアドレス").fill(user.email);
  await page.getByLabel("パスワード").fill(user.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  // 2. 同意画面: 名前・接続先・できること・データが送られることの注意
  await expect(page.getByRole("heading", { name: "「E2E の AI」に家計簿の利用を許可しますか？" })).toBeVisible();
  await expect(page.getByText("127.0.0.1:9", { exact: true })).toBeVisible();
  await expect(page.getByText("支出を1件ずつ記録する")).toBeVisible();
  await expect(page.getByText(/接続先の AI のサービスへ送られます/)).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/882/consent-375.png", fullPage: true });

  // 3. 許可 → AI の戻り先にコード
  await page.getByRole("button", { name: "許可する" }).click();
  await expect.poll(() => captured.length).toBe(1);
  const back = new URL(captured[0]);
  expect(back.searchParams.get("state")).toBe("e2e");
  const code = back.searchParams.get("code");
  expect(code).toBeTruthy();

  // 4. トークンで MCP の道具を使う（作り物の金額）
  const tokens = await exchangeCode(sb.apiUrl, client, p, code!);
  const mcp = await mcpClient(tokens.access_token);
  const r = (await mcp.callTool({ name: "add_expense", arguments: { amount: 850, category: "外食", note: "E2E の昼ごはん" } })) as {
    isError?: boolean;
    structuredContent?: { account: string };
  };
  expect(r.isError).toBeFalsy();
  expect(r.structuredContent?.account).toBe("現金");
  await mcp.close();

  // 画面の API でも見える（同じ利用者の家計簿に入った）
  const today = new Date(Date.now() + 9 * 3600_000);
  const list = await (await page.request.get(`/api/v1/transactions?year=${today.getUTCFullYear()}&month=${today.getUTCMonth() + 1}`)).json();
  const row = (list.data as Array<{ note: string; source: string }>).find((t) => t.note === "E2E の昼ごはん");
  expect(row?.source).toBe("api");
});

test("MC2 許可しない → AI の戻り先に access_denied", async ({ page }) => {
  const sb = localSupabase();
  const user = await createUser("mc2");
  const client = await registerClient(sb.apiUrl, "断られる AI");
  const captured = await wire(page);

  await page.goto(`/login`);
  await page.getByLabel("メールアドレス").fill(user.email);
  await page.getByLabel("パスワード").fill(user.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.waitForURL("**/calendar");

  await page.goto(await consentUrl(sb.apiUrl, client, pkce()));
  await page.getByRole("button", { name: "許可しない" }).click();
  await expect.poll(() => captured.length).toBe(1);
  expect(new URL(captured[0]).searchParams.get("error")).toBe("access_denied");
});

test("MC3 設定の「AI との接続」で解除するとトークンが使えなくなる", async ({ page }) => {
  const sb = localSupabase();
  const user = await createUser("mc3");
  const client = await registerClient(sb.apiUrl, "解除される AI");
  const p = pkce();
  const captured = await wire(page);

  await page.goto(await consentUrl(sb.apiUrl, client, p));
  await page.waitForURL(/\/login\?next=/);
  await page.getByLabel("メールアドレス").fill(user.email);
  await page.getByLabel("パスワード").fill(user.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("button", { name: "許可する" }).click();
  await expect.poll(() => captured.length).toBe(1);
  const tokens = await exchangeCode(sb.apiUrl, client, p, new URL(captured[0]).searchParams.get("code")!);

  await page.goto("/settings#ai");
  await expect(page.getByLabel("AI に登録する URL")).toHaveValue(`${BASE}/api/mcp`);
  await expect(page.getByText("解除される AI")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/882/settings-ai-375.png", fullPage: true });
  await page.getByRole("button", { name: "解除" }).click();
  await page.getByRole("button", { name: "本当に解除する" }).click();
  await expect(page.getByText("まだありません。")).toBeVisible();

  const res = await page.request.post(`${BASE}/api/mcp`, {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(res.status()).toBe(401);
});
