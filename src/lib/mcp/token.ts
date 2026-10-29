/**
 * @file lib/mcp/token.ts
 * @description /api/mcp（利用者の AI エージェントの窓口）に来た Bearer トークンを確かめる（mywork#882）。
 *
 * トークンは Supabase Auth の OAuth 2.1 サーバーが AI（Claude・ChatGPT）に渡した、その人専用・1時間のアクセストークン。
 * 確かめ方は2段:
 *   1. 手元で形だけ見る（prefilterToken）: JWT の形・期限・発行元（iss）・client_id の有無。
 *      でたらめな文字列で Supabase に問い合わせを飛ばさせない（問い合わせの増幅を防ぐ）ための足切りで、
 *      ここを通っても「本物」とはまだ言えない
 *   2. Supabase Auth に問い合わせる（verifyAccessToken）: auth.getUser(token)。署名・期限に加えて
 *      セッションが生きているか（利用者が「接続を解除」したら即座に効く）まで Supabase が確かめる。
 *      JWKS だけで手元検証すると、解除しても期限（1時間）まで使えてしまうので、毎回問い合わせる方を選んだ
 *
 * client_id が無いトークン（＝画面のログインのセッション）は受け付けない。
 * AI の窓口は OAuth の同意を経たトークンだけにして、「誰が・どの AI に許可したか」を必ず残すため。
 */

import { createClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/db";
import { expectedIssuer } from "./metadata";

/** 確かめ終わった利用者（DB には userId だけを使う） */
export interface McpPrincipal {
  userId: string;
  email: string;
  /** 接続した AI の OAuth クライアント ID（Supabase が発行。呼び出し記録に残す） */
  clientId: string;
}

/** Authorization ヘッダーから Bearer トークンを取り出す。無い・形が違えば null */
export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

/** JWT の本体（署名は見ない）。base64url を読めなければ null */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

export type Prefilter =
  | { ok: true; sub: string; clientId: string }
  | { ok: false; reason: "malformed" | "expired" | "issuer" | "not_oauth" };

/**
 * 1段目の足切り（ネットワークに出ない）。
 * @param nowSec テスト用（本番は省略＝いま）
 */
export function prefilterToken(token: string, issuer = expectedIssuer(), nowSec = Math.floor(Date.now() / 1000)): Prefilter {
  const p = decodeJwtPayload(token);
  if (!p || !isUuid(p.sub)) return { ok: false, reason: "malformed" };
  if (typeof p.exp !== "number" || p.exp <= nowSec) return { ok: false, reason: "expired" };
  if (p.iss !== issuer) return { ok: false, reason: "issuer" };
  if (p.role !== "authenticated") return { ok: false, reason: "malformed" };
  if (typeof p.client_id !== "string" || p.client_id.length === 0 || p.client_id.length > 200) {
    return { ok: false, reason: "not_oauth" };
  }
  return { ok: true, sub: p.sub, clientId: p.client_id };
}

/**
 * 2段目: Supabase Auth に本物か問い合わせる。駄目なら null。
 * サーバーの Cookie（画面のセッション）は使わない専用のクライアントで問い合わせる。
 */
export async function verifyAccessToken(token: string): Promise<McpPrincipal | null> {
  const pre = prefilterToken(token);
  if (!pre.ok) return null;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  // 念のため、Supabase が返した利用者と JWT の sub が同じことを確かめる
  if (data.user.id !== pre.sub) return null;
  return { userId: data.user.id, email: data.user.email ?? "", clientId: pre.clientId };
}
