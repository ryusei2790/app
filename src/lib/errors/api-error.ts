/**
 * @file lib/errors/api-error.ts
 * @description API・通信が失敗したときに、画面へ出す日本語の言葉を決める（mywork#764 ③）。
 *
 * なぜ要るか: API の中で DB が落ちると Next は中身の無い 500 を返す。画面が res.json() をそのまま読むと
 * 「Unexpected end of JSON input」のような英語が出て、何をすればよいか分からない。
 * ここで「何が起きたか＋次にどうするか」の言葉にそろえる。
 */

export const MESSAGES = {
  network: "通信できませんでした。電波の良いところで「もう一度」を押してください",
  server: "サーバーで問題が起きました。少し待ってから「もう一度」を押してください。続くときはデータは消えていないので時間をおいてください",
  unauthorized: "ログインが切れました。もう一度ログインしてください",
  forbidden: "この操作はできません",
  notFound: "見つかりませんでした。消されたか、URL が違う可能性があります",
  tooMany: "短い時間に操作が多すぎました。1分ほど待ってからもう一度試してください",
} as const;

/** 失敗した応答から画面に出す言葉を作る。API が日本語の message を返していればそれを使う（入力の誤りなど） */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => null);
  const apiMessage: unknown = json?.error?.message;
  if (res.status === 401) return MESSAGES.unauthorized;
  if (res.status >= 500) return MESSAGES.server;
  if (typeof apiMessage === "string" && apiMessage) return apiMessage;
  if (res.status === 403) return MESSAGES.forbidden;
  if (res.status === 404) return MESSAGES.notFound;
  if (res.status === 429) return MESSAGES.tooMany;
  return fallback;
}

/** catch した例外を言葉にする。fetch 自体の失敗（圏外など）と JSON の読み違いは英語を出さない */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof TypeError) return MESSAGES.network; // fetch の失敗は TypeError（Failed to fetch / Load failed）
  if (e instanceof SyntaxError) return MESSAGES.server; // 応答が JSON でない＝サーバー側の失敗
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
