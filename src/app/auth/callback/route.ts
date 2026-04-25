/**
 * @file app/auth/callback/route.ts
 * @description Supabase Auth のコールバックエンドポイント。
 * Google OAuth やメール確認後にリダイレクトされる。
 * code を exchangeCodeForSession に渡してセッションを確立する。
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/calendar";

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
