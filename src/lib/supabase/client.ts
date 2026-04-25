/**
 * @file lib/supabase/client.ts
 * @description ブラウザ（クライアントサイド）用 Supabase クライアント。
 * `createBrowserClient` を使うことで Cookie ベースのセッション管理が自動で行われる。
 * React コンポーネント・カスタムフックから import して使う。
 */

import { createBrowserClient } from "@supabase/ssr";

/**
 * ブラウザ用 Supabase クライアントを生成する。
 * 毎回 new するのではなく、必要な箇所で呼び出す（SSR との整合性を保つため）。
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
