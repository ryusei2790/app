/**
 * @file tests/helpers/oauth.ts
 * @description ローカル Supabase の OAuth 2.1 サーバーから、本物の「AI 用アクセストークン」をブラウザ無しで取る（mywork#882）。
 * AI（Claude・ChatGPT）が実際にたどる手順と同じ:
 *   1. 動的クライアント登録（DCR）  POST /auth/v1/oauth/clients/register
 *   2. 認可の開始（PKCE）            GET  /auth/v1/oauth/authorize → 302 で同意画面 /oauth/consent?authorization_id=…
 *   3. 利用者が許可                  supabase-js の auth.oauth.approveAuthorization（同意画面の「許可する」と同じ API）
 *   4. コードをトークンに交換        POST /auth/v1/oauth/token
 * 同意画面（画面の操作）そのものは E2E（tests/e2e/mcp-consent.spec.ts）で別に確かめる。
 * ローカル（127.0.0.1 / localhost）以外には繋がない。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

export const TEST_REDIRECT_URI = "http://127.0.0.1:9/oauth-test-callback";

function assertLocal(apiUrl: string) {
  const host = new URL(apiUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("ローカル以外の Supabase には繋ぎません");
}

export interface OAuthClient {
  clientId: string;
  redirectUri: string;
}

/** 1. DCR（AI のアプリが自分を登録するのと同じ） */
export async function registerClient(apiUrl: string, name = "テスト用 AI", redirectUri = TEST_REDIRECT_URI): Promise<OAuthClient> {
  assertLocal(apiUrl);
  const res = await fetch(`${apiUrl}/auth/v1/oauth/clients/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (res.status !== 201) throw new Error(`クライアント登録に失敗: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { client_id: string };
  return { clientId: json.client_id, redirectUri };
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function pkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** 2. 認可を始めて、Supabase が同意画面へ送る URL を返す（リダイレクトは追わない） */
export async function startAuthorization(apiUrl: string, client: OAuthClient, p: Pkce, state = "test-state"): Promise<string> {
  assertLocal(apiUrl);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state,
  });
  const res = await fetch(`${apiUrl}/auth/v1/oauth/authorize?${q}`, { redirect: "manual" });
  const location = res.headers.get("location");
  if (res.status !== 302 || !location) throw new Error(`認可の開始に失敗: ${res.status}`);
  return location;
}

/** 4. コード → トークン */
export async function exchangeCode(apiUrl: string, client: OAuthClient, p: Pkce, code: string) {
  assertLocal(apiUrl);
  const res = await fetch(`${apiUrl}/auth/v1/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: client.redirectUri, client_id: client.clientId, code_verifier: p.verifier }),
  });
  if (!res.ok) throw new Error(`トークン交換に失敗: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
}

/** メモリにだけセッションを持つ supabase-js（解除・許可など「ログイン中の本人」の操作に使う） */
export function memoryClient(apiUrl: string, anonKey: string): SupabaseClient {
  const m = new Map<string, string>();
  return createClient(apiUrl, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) },
    },
  });
}

/**
 * 1〜4 を通して AI 用のアクセストークンを取る。
 * @param user その利用者としてログイン済みの supabase-js（memoryClient でログインしたもの）
 */
export async function obtainOAuthToken(apiUrl: string, user: SupabaseClient, name = "テスト用 AI") {
  const client = await registerClient(apiUrl, name);
  const p = pkce();
  const consentUrl = await startAuthorization(apiUrl, client, p);
  const authorizationId = new URL(consentUrl).searchParams.get("authorization_id");
  if (!authorizationId) throw new Error("authorization_id がありません");
  // 同意画面と同じく、先に中身を読む（ここで Supabase が申請とログイン中の利用者を結び付ける。読まずに許可すると not found）
  const details = await user.auth.oauth.getAuthorizationDetails(authorizationId);
  if (details.error) throw details.error;
  const { data, error } = await user.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (error || !data) throw error ?? new Error("許可に失敗");
  const code = new URL(data.redirect_url).searchParams.get("code");
  if (!code) throw new Error("code がありません");
  const tokens = await exchangeCode(apiUrl, client, p, code);
  return { ...tokens, clientId: client.clientId };
}
