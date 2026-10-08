/**
 * @file proxy.ts
 * @description Next.js 16 の Proxy（旧: middleware）。
 * 全リクエストで Supabase セッションを更新し、
 * 未認証ユーザーを /login にリダイレクトする。
 * App Router の Server Component でセッションが取れるよう
 * Cookie を確実に更新することが主な役割。
 *
 * Next.js 16 から middleware.ts → proxy.ts に名称変更。
 * エクスポート関数名も `middleware` → `proxy` に変更。
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // リクエスト側の Cookie を更新
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // レスポンス側の Cookie も更新（これをしないとセッションが消える）
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // セッションを取得（これにより Cookie が更新される）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 未認証ユーザーが保護ルートにアクセスした場合はログインへ
  const isProtectedRoute =
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/calendar") ||
    request.nextUrl.pathname.startsWith("/transactions") ||
    request.nextUrl.pathname.startsWith("/import") ||
    request.nextUrl.pathname.startsWith("/fixed-costs") ||
    request.nextUrl.pathname.startsWith("/settings") ||
    request.nextUrl.pathname.startsWith("/receipts") ||
    request.nextUrl.pathname.startsWith("/budget");

  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 認証済みユーザーが /login や /signup にアクセスした場合はカレンダーへ
  const isAuthRoute =
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/signup";

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/calendar";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * 以下を除く全パスに適用:
     * - _next/static（静的ファイル）
     * - _next/image（画像最適化）
     * - favicon.ico
     * - sw.js・manifest.webmanifest（PWA。ログイン前でも取れる必要がある）
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
