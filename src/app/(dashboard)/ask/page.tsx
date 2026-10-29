/**
 * @file app/(dashboard)/ask/page.tsx
 * @description 「質問して集計」の画面（mywork#500 第3弾）。AskView（Client Component）を返す薄いラッパー。
 * 初期画面の固定5つには入れず、機能カタログ（lib/menu/catalog.ts）から本人がマイメニューに置く（#573）。
 */

import { AskView } from "@/components/ask/AskView";

export default function AskPage() {
  return <AskView />;
}
