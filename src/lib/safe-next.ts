/**
 * @file lib/safe-next.ts
 * @description ログイン後の戻り先（?next=）を、このサイトの中のパスだけに絞る（mywork#882）。
 *
 * AI 接続の同意画面（/oauth/consent?authorization_id=…）は、未ログインならログイン画面を経て戻ってくる。
 * そのとき ?next= をそのまま使うと、「https://悪いサイト」や「//悪いサイト」「@悪いサイト」を渡されて
 * ログイン直後に外へ飛ばされる（オープンリダイレクト。フィッシングの踏み台）。
 * ここでは「/ で始まり、// や /\ で始まらず、制御文字を含まない」パスだけを通し、それ以外は既定の戻り先にする。
 */

export const DEFAULT_NEXT = "/calendar";

export function safeNextPath(next: string | null | undefined, fallback = DEFAULT_NEXT): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2000) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  // URL として組み直さず原文を返す（"/..//x" を組み直すと "//x" になり外へ出る形に化けるため。原文なら同じサイトのパスのまま）
  return next;
}
