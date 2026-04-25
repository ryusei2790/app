/**
 * @file app/(dashboard)/transactions/page.tsx
 * @description 収支一覧・手動入力画面（Server Component）。
 * TransactionList（Client Component）を返す薄いラッパー。
 */

import { TransactionList } from "@/components/transactions/TransactionList";

export default function TransactionsPage() {
  return <TransactionList />;
}
