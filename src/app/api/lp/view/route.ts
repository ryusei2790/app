/**
 * @file api/lp/view/route.ts
 * @description 着地ページを開いた数を数える（mywork#878）。ログイン不要。
 * 着地ページの部品から1回だけ呼ばれ、ここで cookie を書く（Server Component からは書けないため）:
 *   - kb_vid: ランダムな visitor ID（無ければ発行）
 *   - kb_utm: クエリの UTM（既にあれば上書きしない）
 * ボットの UA と、同じ visitor の 30 分以内の重複は数えない。IP・UA の全文は保存しない。
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { recordLpView } from "@/lib/admin-db";
import {
  COOKIE_MAX_AGE, UTM_COOKIE, VISITOR_COOKIE,
  isBotUserAgent, isVisitorId, nextUtmCookie, parseUtmCookie, pickUtm, referrerHost,
} from "@/lib/lp/utm";

/** POST /api/lp/view  body: { utm_source?, utm_medium?, utm_campaign?, utm_content?, referrer? } */
export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    const b = await request.json();
    if (b && typeof b === "object" && !Array.isArray(b)) body = b;
  } catch {
    // 空の本文でも数える
  }
  const jar = await cookies();
  const res = NextResponse.json({ data: { ok: true } });
  const opts = { maxAge: COOKIE_MAX_AGE, httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

  let visitorId = jar.get(VISITOR_COOKIE)?.value;
  if (!isVisitorId(visitorId)) {
    visitorId = crypto.randomUUID();
    res.cookies.set(VISITOR_COOKIE, visitorId, opts);
  }
  const existing = parseUtmCookie(jar.get(UTM_COOKIE)?.value);
  const incoming = pickUtm(body);
  const next = nextUtmCookie(existing, incoming);
  if (next) res.cookies.set(UTM_COOKIE, next, opts);

  if (!isBotUserAgent(request.headers.get("user-agent"))) {
    // 数える UTM は cookie と同じ「最初に来た広告」
    const utm = next ? incoming : existing;
    await recordLpView({ visitorId, utm, referrerHost: referrerHost(body.referrer as string | undefined), now: new Date() });
  }
  return res;
}
