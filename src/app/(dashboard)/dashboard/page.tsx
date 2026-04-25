/**
 * @file app/(dashboard)/dashboard/page.tsx
 * @description ダッシュボード画面（Server Component）。
 * DashboardView（Client Component）を返す薄いラッパー。
 */

import { DashboardView } from "@/components/dashboard/DashboardView";

export default function DashboardPage() {
  return <DashboardView />;
}
