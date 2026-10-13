/**
 * @file lib/features.ts
 * @description 社長専用機能（予算台帳など）を使えるかの判定（S6）。
 *
 * 判定は環境変数 OWNER_USER_IDS（社長の Supabase ユーザー ID。カンマ区切りで複数可）だけで行う。
 * - 値はコードに書かない（公開リポのため）。Vercel / .env.local に設定する
 * - メールアドレスでは判定しない。メール確認の設定次第で他人が同じアドレスで登録できる余地があり、
 *   ユーザー ID（auth.users.id）の方が取り違えようがないため
 * - 未設定・空なら誰も社長でない（設定漏れで機能が開いてしまう事故を防ぐ）
 */

export function parseOwnerIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isOwner(
  user: { id: string; email?: string } | null | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!user || !user.id) return false;
  return parseOwnerIds(env.OWNER_USER_IDS).includes(user.id);
}
