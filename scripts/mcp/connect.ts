/**
 * @file scripts/mcp/connect.ts
 * @description 家計簿の /api/mcp に、Claude Code（CLI）を「本人のアカウント」でつなぐための設定を作る（mywork#882）。
 * 経理部が月次決算を Claude Code から行うとき（docs: kakebo_next/docs/2026-10-28_MCPで月次決算をする手順.md）に使う。
 *
 * やること（公式 MCP SDK の OAuth クライアントで、Claude・ChatGPT と同じ手順をたどる）:
 *   1. /api/mcp の 401 → 案内（/.well-known/oauth-protected-resource）→ Supabase の認可サーバーを見つける
 *   2. クライアント登録（DCR）→ 認可の URL を画面に出す
 *   3. 本人がその URL をブラウザで開き、家計簿にログインして「許可する」を押す（本人の操作はこれだけ）
 *   4. 手元の受け口（127.0.0.1 の空いているポート）でコードを受け取り、トークンに交換
 *   5. Claude Code の --mcp-config に渡す JSON を書き出す（トークンは1時間で切れる。権限 600・git に入れない場所に）
 * パスワードやトークンは画面に出さない。
 *
 * 使い方: npx --yes tsx@4.23.15 scripts/mcp/connect.ts <家計簿の URL（例: https://kakebo-omega.vercel.app）> <書き出す mcp-config.json>
 */

import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/** 認可のコードを1回だけ受け取る受け口（127.0.0.1 だけで待つ。5分で諦める） */
async function startCallbackServer(): Promise<{ redirectUrl: string; code: Promise<string>; close: () => void }> {
  let resolve!: (code: string) => void;
  let reject!: (e: Error) => void;
  const code = new Promise<string>((res, rej) => ((resolve = res), (reject = rej)));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") return void res.writeHead(404).end();
    const c = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(c ? "接続できました。この画面は閉じてかまいません。" : `接続できませんでした（${err ?? "不明"}）。`);
    if (c) resolve(c);
    else reject(new Error(`許可されませんでした: ${err ?? "不明"}`));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const timer = setTimeout(() => reject(new Error("5分待っても許可されませんでした")), 5 * 60_000);
  return { redirectUrl: `http://127.0.0.1:${port}/callback`, code, close: () => (clearTimeout(timer), server.close()) };
}

/** SDK に渡す「クライアントの記憶」（このプロセスのメモリだけ） */
class MemoryProvider implements OAuthClientProvider {
  private info?: OAuthClientInformationMixed;
  private saved?: OAuthTokens;
  private verifier = "";
  constructor(private readonly redirect: string) {}
  get redirectUrl() {
    return this.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Claude Code（経理部の月次決算）",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(i: OAuthClientInformationMixed) {
    this.info = i;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(t: OAuthTokens) {
    this.saved = t;
  }
  redirectToAuthorization(url: URL) {
    console.log("\n次の URL をブラウザで開き、家計簿にログインして「許可する」を押してください:\n");
    console.log(url.toString());
    console.log("");
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

async function main() {
  const [appUrl, outPath] = process.argv.slice(2);
  if (!appUrl || !outPath) throw new Error("使い方: connect.ts <家計簿の URL> <書き出す mcp-config.json>");
  const serverUrl = new URL("/api/mcp", appUrl).toString();

  const cb = await startCallbackServer();
  try {
    const provider = new MemoryProvider(cb.redirectUrl);
    const first = await auth(provider, { serverUrl });
    if (first !== "AUTHORIZED") {
      const code = await cb.code;
      const second = await auth(provider, { serverUrl, authorizationCode: code });
      if (second !== "AUTHORIZED") throw new Error("トークンを受け取れませんでした");
    }
    const tokens = provider.tokens();
    if (!tokens) throw new Error("トークンがありません");
    const config = { mcpServers: { kakebo: { type: "http", url: serverUrl, headers: { Authorization: `Bearer ${tokens.access_token}` } } } };
    await writeFile(outPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log(`つながりました。${outPath} に Claude Code 用の設定を書きました（${Math.round((tokens.expires_in ?? 3600) / 60)}分有効）。`);
  } finally {
    cb.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
