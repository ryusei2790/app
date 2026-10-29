/**
 * @file lib/mcp/metadata.ts
 * @description AI エージェントが「どこでログインすればいいか」を見つけるための案内（mywork#882）。
 *
 * MCP の認可の決まり（OAuth 2.0 Protected Resource Metadata, RFC 9728）どおりに:
 *   - トークン無しで /api/mcp に来たら 401 と WWW-Authenticate: Bearer resource_metadata="<案内の URL>" を返す
 *   - 案内（/.well-known/oauth-protected-resource）には「この窓口の認可サーバーは Supabase Auth」と書く
 * AI はそこから Supabase の認可サーバーの情報を読み、クライアント登録 → ログイン・同意 → トークン取得 を自分で進める。
 * URL はリクエストの origin から作る（本番・プレビュー・ローカルのどれでも、その場の URL が正しく入る）。
 */

// このファイルは import を持たない（設定画面＝ブラウザ側からも MCP_PATH を読むため。DB の部品を巻き込まない）

/** このアプリの Supabase Auth の発行元（iss）＝認可サーバー。例: https://<ref>.supabase.co/auth/v1 */
export function expectedIssuer(supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

/**
 * AI が実際につないだ origin（https://ホスト）。request.url はフレームワークが組み直した値で、
 * 127.0.0.1 が localhost になるなどずれることがあるので、Host（Vercel では x-forwarded-host）から作る。
 * resource の値が AI の登録した URL とずれると、AI 側の検証で接続が止まるため。
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
  // ホスト名に使えない文字が来たら request.url の方を使う（見出しの書き換えで変な URL を作らない）
  if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(host) || !/^https?$/.test(proto)) return url.origin;
  return `${proto}://${host}`;
}

/** MCP の窓口のパス */
export const MCP_PATH = "/api/mcp";

/** この窓口の識別子（resource）。AI が登録した URL と同じもの */
export function resourceUrl(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

/** 案内の URL（RFC 9728 のパス挿入形: /.well-known/oauth-protected-resource/api/mcp） */
export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/** 案内の中身 */
export function protectedResourceMetadata(origin: string, supabaseUrl?: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [expectedIssuer(supabaseUrl)],
    bearer_methods_supported: ["header"],
    resource_name: "カレンダー家計簿",
    resource_documentation: `${origin}/settings#ai`,
  };
}

/** 401 に付ける WWW-Authenticate。トークンが駄目だったときは error="invalid_token" も付ける */
export function wwwAuthenticate(origin: string, invalidToken = false): string {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl(origin)}"`];
  // HTTP の見出しは ASCII だけ（日本語を入れると送れない）。日本語の説明は本文の JSON に入れる
  if (invalidToken) parts.push(`error="invalid_token"`, `error_description="The access token is invalid, expired or revoked"`);
  return parts.join(", ");
}

/**
 * ブラウザ上の MCP クライアント（MCP Inspector など）からも呼べるようにする CORS の見出し。
 * 認証は Cookie ではなく Authorization ヘッダーだけなので、どの origin からでも許してよい
 * （Cookie を送らせない＝credentials は許可しない）。
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "600",
};
