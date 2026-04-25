/**
 * @file lib/supabase/server.ts
 * @description サーバーサイド（API Route・Server Component）用 Supabase クライアント。
 * Next.js の cookies() を使い、リクエストごとにセッションを取得する。
 * クライアントサイドの `client.ts` と使い分けること。
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * サーバー用 Supabase クライアントを生成する。
 * API Route や Server Component 内で呼び出す。
 * cookies() は非同期なので await が必要。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component から呼ばれた場合は set できないが問題なし
          }
        },
      },
    }
  );
}
