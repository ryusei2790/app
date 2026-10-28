/**
 * @file api/mcp/route.ts
 * @description 利用者の AI エージェント（Claude・ChatGPT など）がつなぐ窓口（リモート MCP、mywork#882）。
 *
 * 流れ:
 *   1. Authorization: Bearer <OAuth のアクセストークン> を確かめる（lib/mcp/token.ts）。
 *      無い・駄目なら 401 ＋ WWW-Authenticate（どこでログインすればよいかの案内の URL）。
 *      AI はそれを読んで Supabase の OAuth（ログイン → 同意画面 /oauth/consent）に利用者を案内する
 *   2. その利用者1人分の MCP サーバーを作り（lib/mcp/server.ts）、公式 SDK の Streamable HTTP（状態なし・JSON 応答）で1回答える
 * 画面の API（/api/v1/*）は Cookie のセッションだけを見るので、このトークンでは使えない（逆も同じ）。
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CORS_HEADERS, requestOrigin, wwwAuthenticate } from "@/lib/mcp/metadata";
import { readBearer, verifyAccessToken } from "@/lib/mcp/token";
import { createKakeboMcpServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
// Prisma（pg）を使うので Node.js で動かす
export const runtime = "nodejs";

/** 応答に CORS の見出しを足す */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function unauthorized(origin: string, invalidToken: boolean): Response {
  return withCors(
    new Response(
      JSON.stringify({ error: invalidToken ? "invalid_token" : "unauthorized", error_description: "家計簿へのログインと接続の許可が必要です" }),
      { status: 401, headers: { "content-type": "application/json", "WWW-Authenticate": wwwAuthenticate(origin, invalidToken) } }
    )
  );
}

async function handle(request: Request): Promise<Response> {
  const origin = requestOrigin(request);

  // 1. 認証（トークンが無ければ Supabase に問い合わせもしない）
  const token = readBearer(request.headers.get("authorization"));
  if (!token) return unauthorized(origin, false);
  const who = await verifyAccessToken(token);
  if (!who) return unauthorized(origin, true);

  // 2. MCP の1往復（リクエストごとに作って捨てる）
  const server = createKakeboMcpServer(who);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(request, {
      authInfo: { token, clientId: who.clientId, scopes: [], extra: { userId: who.userId } },
    });
    return withCors(res);
  } catch (e) {
    // 中身（トークン・金額）はログに出さない
    console.error("[mcp] 応答に失敗", e instanceof Error ? e.name : "unknown");
    return withCors(
      new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "サーバーでエラーが起きました" }, id: null }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

/** ブラウザ上のクライアントの事前確認（CORS） */
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
