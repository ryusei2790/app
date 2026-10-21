/**
 * @file lib/nav.ts
 * @description サイドバー・スマホのメニューの形（mywork#573 から、中身は lib/menu/catalog.ts の固定5つ＋本人のマイメニュー）。
 * 社長専用の項目（予算台帳）は社長にだけ出す（S6）。画面で隠すのは見た目のためで、
 * 守りの本体は API（requireOwner）と画面の notFound()。
 */

import type { MenuItem } from "@/lib/menu/layout";

export type NavItem = MenuItem;

export interface NavMenu {
  fixed: NavItem[];
  mine: NavItem[];
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
