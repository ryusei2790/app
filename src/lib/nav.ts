/**
 * @file lib/nav.ts
 * @description サイドバーのメニュー項目。社長専用の項目（予算台帳）は社長にだけ出す（S6）。
 * 画面で隠すのは見た目のためで、守りの本体は API（requireOwner）と画面の notFound()。
 */

import { DEFINITIONS_PATH } from "@/lib/aggregate/definitions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const COMMON_ITEMS: NavItem[] = [
  { href: "/calendar", label: "カレンダー", icon: "📅" },
  { href: "/dashboard", label: "ダッシュボード", icon: "📊" },
  { href: "/receipts/new", label: "レシート", icon: "📷" },
  { href: "/transactions", label: "収支一覧", icon: "📋" },
  { href: "/review", label: "要確認", icon: "🔍" },
  { href: "/import", label: "CSVインポート", icon: "📥" },
  { href: "/fixed-costs", label: "定期の収入・支出", icon: "🔁" },
  { href: DEFINITIONS_PATH, label: "数字の定義", icon: "📖" },
  { href: "/settings", label: "設定", icon: "⚙️" },
];

const OWNER_ITEMS: NavItem[] = [{ href: "/budget", label: "予算台帳", icon: "📒" }];

export function navItemsFor({ isOwner }: { isOwner: boolean }): NavItem[] {
  return isOwner ? [...COMMON_ITEMS, ...OWNER_ITEMS] : COMMON_ITEMS;
}
