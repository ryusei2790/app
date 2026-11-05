/**
 * @file app/(dashboard)/entry/page.tsx
 * @description 標準機能①「手入力」（mywork#1150）。中身はカレンダー・収支一覧と同じ TransactionForm。
 */

import { ManualEntry } from "@/components/entry/ManualEntry";

export default function EntryPage() {
  return <ManualEntry />;
}
