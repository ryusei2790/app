/**
 * @file lib/errors/screen.ts
 * @description エラー画面・見つからない画面の言葉（mywork#764 ③）。画面とテストで同じものを使う。
 */

export const SCREEN_ERROR = {
  title: "うまく表示できませんでした",
  message:
    "サーバーか通信で一時的な問題が起きました。入力したデータは消えていません。「もう一度」を押すか、少し待ってから開き直してください。",
} as const;

export const NOT_FOUND = {
  title: "ページが見つかりません",
  message: "URL が違うか、ページが無くなりました。ホームから開き直してください。",
} as const;
