/**
 * @file app/(dashboard)/calendar/page.tsx
 * @description カレンダー画面（Server Component）。
 * CalendarView（Client Component）を読み込んで表示する。
 * Server Component として認証チェックは (dashboard)/layout.tsx で済んでいる。
 */

import { CalendarView } from "@/components/calendar/CalendarView";

export default function CalendarPage() {
  return <CalendarView />;
}
