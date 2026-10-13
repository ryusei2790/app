/**
 * @file tests/e2e/helpers.ts
 * @description E2E（Playwright）の道具。ローカルの Supabase だけを相手にする。
 * - createUser: Auth の管理 API でメール確認済みのユーザーを作る（画面の新規登録は W6 で別に試す）
 * - login: 画面からログインしてカレンダーまで進む
 * - api: ログイン中のブラウザの Cookie で API を呼ぶ（前提データ＝口座の用意など）
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export function localSupabase() {
  const raw = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  for (const u of [json.API_URL, json.DB_URL]) {
    const host = new URL(u).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("ローカル以外の Supabase には繋ぎません");
  }
  return { apiUrl: json.API_URL as string, anonKey: json.ANON_KEY as string, serviceRoleKey: json.SERVICE_ROLE_KEY as string, dbUrl: json.DB_URL as string };
}

/** E2E の社長アカウントの id（playwright.config.ts の OWNER_USER_IDS と同じ）。本物の社長の id ではない */
export const E2E_OWNER_ID = "00000000-0000-4000-8000-00000000e2e0";

/**
 * メール確認済みのユーザーを作る。id を渡すとその id で作る（前回の実行で残っていれば消してから作る）
 */
export async function createUser(label = "e2e", id?: string) {
  const env = localSupabase();
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const headers = { apikey: env.serviceRoleKey, authorization: `Bearer ${env.serviceRoleKey}`, "content-type": "application/json" };
  if (id) await fetch(`${env.apiUrl}/auth/v1/admin/users/${id}`, { method: "DELETE", headers });
  const res = await fetch(`${env.apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true, ...(id ? { id } : {}) }),
  });
  if (!res.ok) throw new Error(`ユーザー作成に失敗: ${res.status}`);
  return { email, password };
}

export async function login(page: Page, u: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(u.email);
  await page.getByLabel("パスワード").fill(u.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.waitForURL("**/calendar");
}

/** ログイン中の Cookie で口座を1つ作る */
export async function createAccount(page: Page, name = "財布") {
  const res = await page.request.post("/api/v1/accounts", { data: { name, type: "cash" } });
  expect(res.status()).toBe(201);
  return (await res.json()).data.id as string;
}

/** JST の今日 */
export function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
