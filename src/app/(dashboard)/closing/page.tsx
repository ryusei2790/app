/**
 * @file app/(dashboard)/closing/page.tsx
 * @description 標準機能③「今月の決算」（mywork#1150）。第2弾で提案ボット（集計→Sonnet 5.5→Markdown を HTML 表示）が入った。
 * 中身はクライアントの ClosingView（決算日の設定・作る・保存した提案を読む）。
 */

import { ClosingView } from "@/components/closing/ClosingView";

export default function ClosingPage() {
  return <ClosingView />;
}
