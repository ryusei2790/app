/**
 * @file .well-known/oauth-protected-resource/[[...resource]]/route.ts
 * @description AI エージェント向けの案内（OAuth 2.0 Protected Resource Metadata, RFC 9728。mywork#882）。
 * /api/mcp の 401 が指す URL（/.well-known/oauth-protected-resource/api/mcp）と、
 * パス無しの /.well-known/oauth-protected-resource の両方で同じ中身を返す（クライアントによって見に行く方が違うため）。
 * 中身は「この窓口の認可サーバーは Supabase Auth」という公開情報だけ。ログイン不要。
 */

import { CORS_HEADERS, MCP_PATH, protectedResourceMetadata, requestOrigin } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ resource?: string[] }> }) {
  // パス挿入形は /api/mcp のものだけ（他のパスの案内は出さない）
  const { resource } = await ctx.params;
  if (resource && resource.join("/") !== MCP_PATH.slice(1)) return new Response("Not Found", { status: 404 });
  const origin = requestOrigin(request);
  return Response.json(protectedResourceMetadata(origin), {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
