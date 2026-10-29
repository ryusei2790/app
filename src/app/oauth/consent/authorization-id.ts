/**
 * @file oauth/consent/authorization-id.ts
 * @description Supabase の OAuth が同意画面に渡す authorization_id の形の確認（mywork#882）。
 * Supabase に渡す前・URL に入れる前に、英数字と - _ だけ・200文字までに絞る（URL の組み立てに変な文字を混ぜない）。
 */

export function isAuthorizationId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
}
