/**
 * @file app/(dashboard)/receipts/new/page.tsx
 * @description レシートで登録する画面（撮影 → 確認 → 保存）。中身は ReceiptFlow（Client Component）。
 */

import { ReceiptFlow } from "@/components/receipts/ReceiptFlow";

export default function NewReceiptPage() {
  return <ReceiptFlow />;
}
