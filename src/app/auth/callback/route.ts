/**
 * @file app/auth/callback/route.ts
 * @description Supabase Auth のコールバックエンドポイント。
 * Google OAuth やメール確認後にリダイレクトされる。
 * code を exchangeCodeForSession に渡してセッションを確立する。
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-next";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // 戻り先はこのサイトの中のパスだけ（"@evil.example" などで外へ飛ばされないように。mywork#882）
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // エラーの場合はログインページへ
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
