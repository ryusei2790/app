/**
 * @file api/waitlist/route.ts
 * @description メールだけの事前登録（mywork#878 Q1=A）。ログイン不要。確認メールは送らない。
 * UTM は cookie kb_utm（着地ページで保存した最初の広告）から一緒に保存する。
 * 同じアドレスでも画面の返事は同じ（他人のアドレスが登録済みか分からないように）。
 * 連打対策: 同じ visitor で 1 分 5 回まで（表の件数で判定）。visitor cookie が無い送信は受け付けない。
 */

import { cookies } from "next/headers";
import { error, ok, readJsonBody } from "@/lib/api-helpers";
import { countRecentWaitlistByVisitor, insertWaitlistSignup } from "@/lib/admin-db";
import { UTM_COOKIE, VISITOR_COOKIE, isVisitorId, normalizeEmail, parseUtmCookie } from "@/lib/lp/utm";

/** POST /api/waitlist  body: { email, agree: true } */
export async function POST(request: Request) {
  const { body, response } = await readJsonBody(request);
  if (response) return response;
  const email = normalizeEmail(body.email);
  if (!email) return error("VALIDATION_ERROR", "メールアドレスの形が正しくありません", 422);
  if (body.agree !== true) return error("VALIDATION_ERROR", "利用規約とプライバシーへの同意が必要です", 422);

  const jar = await cookies();
  const visitorId = jar.get(VISITOR_COOKIE)?.value;
  if (!isVisitorId(visitorId)) return error("VALIDATION_ERROR", "ページを開き直してから送ってください", 422);
  if ((await countRecentWaitlistByVisitor(visitorId, new Date())) >= 5) {
    return error("RATE_LIMITED", "少し時間をおいてから送ってください", 429);
  }
  await insertWaitlistSignup({ email, visitorId, utm: parseUtmCookie(jar.get(UTM_COOKIE)?.value) });
  return ok({ ok: true });
}
